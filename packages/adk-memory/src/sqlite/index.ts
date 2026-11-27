/** Codex-style 3-table SQLite coordinator & derived FTS5 search index (bun:sqlite WAL). */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  IndexedMemoryFile,
  MemoryCoordinatorStore,
  MemoryFileKind,
  MemoryJob,
  MemoryJobKind,
  MemoryJobStatus,
  MemoryOwner,
  MemoryScope,
  MemoryScopeType,
  MemorySearchHit,
  MemoryType,
  Stage1Output,
} from "../contracts";
import { tokenizeCjkBigrams, tokenizeLexical } from "../frontmatter";

interface JobRow {
  job_key: string;
  kind: string;
  scope_key: string;
  status: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  watermark: string | null;
  retry_count: number;
  last_run_at: string | null;
  last_error: string | null;
  updated_at: string;
}

interface Stage1Row {
  session_key: string;
  scope_key: string;
  session_revision: number;
  rollout_path: string;
  raw_takeaways: string;
  skipped_reason: string | null;
  consumed_by_dream_at: string | null;
  created_at: string;
  updated_at: string;
}

interface FtsResultRow {
  path: string;
  scope_key: string;
  kind: string;
  mem_type: string | null;
  owner: string;
  name: string;
  description: string;
  rank: number;
}

function parseScopeKey(scopeKey: string): MemoryScope {
  const idx = scopeKey.indexOf(":");
  const type = (idx > 0 ? scopeKey.slice(0, idx) : "user") as MemoryScopeType;
  const id = idx > 0 ? scopeKey.slice(idx + 1) : "default";
  return { type, id };
}

function mapJob(row: JobRow): MemoryJob {
  return {
    jobKey: row.job_key,
    kind: row.kind as MemoryJobKind,
    scopeKey: row.scope_key,
    status: row.status as MemoryJobStatus,
    ...(row.lease_owner ? { leaseOwner: row.lease_owner } : {}),
    ...(row.lease_expires_at ? { leaseExpiresAt: row.lease_expires_at } : {}),
    ...(row.watermark ? { watermark: row.watermark } : {}),
    retryCount: row.retry_count,
    ...(row.last_run_at ? { lastRunAt: row.last_run_at } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
    updatedAt: row.updated_at,
  };
}

function mapStage1(row: Stage1Row): Stage1Output {
  return {
    sessionKey: row.session_key,
    scopeKey: row.scope_key,
    sessionRevision: row.session_revision,
    rolloutPath: row.rollout_path,
    rawTakeaways: row.raw_takeaways,
    ...(row.skipped_reason ? { skippedReason: row.skipped_reason } : {}),
    ...(row.consumed_by_dream_at ? { consumedByDreamAt: row.consumed_by_dream_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildFtsMatchQuery(rawQuery: string): string | undefined {
  const lexTerms = tokenizeLexical(rawQuery)
    .toLowerCase()
    .split(/\s+/)
    .map(t => t.replace(/[^a-z0-9]/g, ""))
    .filter(t => t.length >= 2);
  const cjkGrams = tokenizeCjkBigrams(rawQuery)
    .split(/\s+/)
    .filter(Boolean);

  const clauses: string[] = [];
  if (lexTerms.length) {
    clauses.push(`tokens_lex:(${[...new Set(lexTerms)].slice(0, 8).map(t => `"${t}"`).join(" OR ")})`);
  }
  if (cjkGrams.length) {
    clauses.push(`tokens_cjk:(${[...new Set(cjkGrams)].slice(0, 12).map(g => `"${g}"`).join(" OR ")})`);
  }
  return clauses.length ? clauses.join(" OR ") : undefined;
}

export function createSqliteMemoryStore(filename: string): MemoryCoordinatorStore {
  if (filename !== ":memory:") {
    mkdirSync(dirname(filename), { recursive: true });
  }
  const db = new Database(filename, { create: true });
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS memory_jobs (
      job_key TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      status TEXT NOT NULL,
      lease_owner TEXT,
      lease_expires_at TEXT,
      watermark TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_run_at TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stage1_outputs (
      session_key TEXT PRIMARY KEY,
      scope_key TEXT NOT NULL,
      session_revision INTEGER NOT NULL,
      rollout_path TEXT NOT NULL,
      raw_takeaways TEXT NOT NULL,
      skipped_reason TEXT,
      consumed_by_dream_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stage1_pending ON stage1_outputs(scope_key, consumed_by_dream_at);

    CREATE TABLE IF NOT EXISTS memory_files (
      path TEXT PRIMARY KEY,
      scope_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      mem_type TEXT,
      owner TEXT NOT NULL DEFAULT 'agent',
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      content_sha256 TEXT NOT NULL,
      mtime_ms INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_files_scope ON memory_files(scope_key, kind);

    CREATE VIRTUAL TABLE IF NOT EXISTS memory_files_fts USING fts5(
      path UNINDEXED,
      scope_key UNINDEXED,
      tokens_lex,
      tokens_cjk,
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `);

  const claimTx = db.transaction((input: {
    readonly jobKey: string;
    readonly kind: MemoryJobKind;
    readonly scopeKey: string;
    readonly leaseOwner: string;
    readonly leaseExpiresAt: string;
    readonly nowIso: string;
  }): boolean => {
    const existing = db.query("SELECT * FROM memory_jobs WHERE job_key = ?").get(input.jobKey) as JobRow | null;
    if (!existing) {
      db.query(
        "INSERT INTO memory_jobs(job_key, kind, scope_key, status, lease_owner, lease_expires_at, retry_count, updated_at) VALUES (?, ?, ?, 'running', ?, ?, 0, ?)",
      ).run(input.jobKey, input.kind, input.scopeKey, input.leaseOwner, input.leaseExpiresAt, input.nowIso);
      return true;
    }
    const activeLease = existing.status === "running"
      && existing.lease_owner !== input.leaseOwner
      && existing.lease_expires_at !== null
      && existing.lease_expires_at > input.nowIso;
    if (activeLease) return false;
    db.query(
      "UPDATE memory_jobs SET status = 'running', lease_owner = ?, lease_expires_at = ?, updated_at = ? WHERE job_key = ?",
    ).run(input.leaseOwner, input.leaseExpiresAt, input.nowIso, input.jobKey);
    return true;
  });

  const syncScopeTx = db.transaction((scopeKey: string, files: readonly IndexedMemoryFile[]) => {
    const existingRows = db.query("SELECT path, content_sha256 FROM memory_files WHERE scope_key = ?").all(scopeKey) as { path: string; content_sha256: string }[];
    const existingHashes = new Map(existingRows.map(r => [r.path, r.content_sha256]));
    const nextPaths = new Set(files.map(f => f.path));

    for (const oldPath of existingHashes.keys()) {
      if (!nextPaths.has(oldPath)) {
        db.query("DELETE FROM memory_files WHERE path = ?").run(oldPath);
        db.query("DELETE FROM memory_files_fts WHERE path = ?").run(oldPath);
      }
    }

    for (const file of files) {
      if (existingHashes.get(file.path) === file.contentSha256) continue;
      db.query(`
        INSERT INTO memory_files(path, scope_key, kind, mem_type, owner, name, description, content_sha256, mtime_ms, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
          kind = excluded.kind,
          mem_type = excluded.mem_type,
          owner = excluded.owner,
          name = excluded.name,
          description = excluded.description,
          content_sha256 = excluded.content_sha256,
          mtime_ms = excluded.mtime_ms,
          updated_at = excluded.updated_at
      `).run(
        file.path,
        file.scopeKey,
        file.kind,
        file.memType ?? null,
        file.owner,
        file.name,
        file.description,
        file.contentSha256,
        file.mtimeMs,
        file.updatedAt,
      );
      db.query("DELETE FROM memory_files_fts WHERE path = ?").run(file.path);
      if (file.kind === "topic" || file.kind === "rollout") {
        const text = `${file.name}\n${file.description}\n${file.body}`;
        db.query("INSERT INTO memory_files_fts(path, scope_key, tokens_lex, tokens_cjk) VALUES (?, ?, ?, ?)").run(
          file.path,
          file.scopeKey,
          tokenizeLexical(text),
          tokenizeCjkBigrams(text),
        );
      }
    }
  });

  return {
    claimJob(input) {
      const nowIso = input.nowIso ?? new Date().toISOString();
      const leaseExpiresAt = new Date(Date.parse(nowIso) + Math.max(1000, input.leaseTtlMs)).toISOString();
      return claimTx({ ...input, nowIso, leaseExpiresAt });
    },

    completeJob(jobKey, leaseOwner, options) {
      const nowIso = options?.nowIso ?? new Date().toISOString();
      db.query(`
        UPDATE memory_jobs
        SET status = 'done',
            lease_owner = NULL,
            lease_expires_at = NULL,
            watermark = COALESCE(?, watermark),
            retry_count = 0,
            last_run_at = ?,
            last_error = NULL,
            updated_at = ?
        WHERE job_key = ? AND (lease_owner = ? OR lease_owner IS NULL)
      `).run(options?.watermark ?? null, nowIso, nowIso, jobKey, leaseOwner);
    },

    failJob(jobKey, leaseOwner, error, nowIso = new Date().toISOString()) {
      db.query(`
        UPDATE memory_jobs
        SET status = 'failed',
            lease_owner = NULL,
            lease_expires_at = NULL,
            retry_count = retry_count + 1,
            last_error = ?,
            updated_at = ?
        WHERE job_key = ? AND (lease_owner = ? OR lease_owner IS NULL)
      `).run(error.slice(0, 500), nowIso, jobKey, leaseOwner);
    },

    getJob(jobKey) {
      const row = db.query("SELECT * FROM memory_jobs WHERE job_key = ?").get(jobKey) as JobRow | null;
      return row ? mapJob(row) : undefined;
    },

    saveStage1Output(output) {
      const nowIso = output.nowIso ?? new Date().toISOString();
      db.query(`
        INSERT INTO stage1_outputs(session_key, scope_key, session_revision, rollout_path, raw_takeaways, skipped_reason, consumed_by_dream_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_key) DO UPDATE SET
          scope_key = excluded.scope_key,
          session_revision = excluded.session_revision,
          rollout_path = excluded.rollout_path,
          raw_takeaways = excluded.raw_takeaways,
          skipped_reason = excluded.skipped_reason,
          consumed_by_dream_at = excluded.consumed_by_dream_at,
          updated_at = excluded.updated_at
      `).run(
        output.sessionKey,
        output.scopeKey,
        output.sessionRevision,
        output.rolloutPath,
        output.rawTakeaways,
        output.skippedReason ?? null,
        output.consumedByDreamAt ?? null,
        nowIso,
        nowIso,
      );
      const saved = this.getStage1Output(output.sessionKey);
      if (!saved) throw new Error("STAGE1_SAVE_FAILED");
      return saved;
    },

    getStage1Output(sessionKey) {
      const row = db.query("SELECT * FROM stage1_outputs WHERE session_key = ?").get(sessionKey) as Stage1Row | null;
      return row ? mapStage1(row) : undefined;
    },

    listPendingStage1(scopeKey, limit = 50) {
      const rows = db.query(`
        SELECT * FROM stage1_outputs
        WHERE scope_key = ? AND consumed_by_dream_at IS NULL AND skipped_reason IS NULL
        ORDER BY created_at ASC
        LIMIT ?
      `).all(scopeKey, limit) as Stage1Row[];
      return rows.map(mapStage1);
    },

    markStage1Consumed(sessionKeys, nowIso = new Date().toISOString()) {
      if (!sessionKeys.length) return;
      const update = db.transaction((keys: readonly string[]) => {
        for (const key of keys) {
          db.query("UPDATE stage1_outputs SET consumed_by_dream_at = ?, updated_at = ? WHERE session_key = ?").run(nowIso, nowIso, key);
        }
      });
      update(sessionKeys);
    },

    syncScopeFiles(scopeKey, files) {
      syncScopeTx(scopeKey, files);
    },

    searchFts(query, scopeKeys, limit = 8) {
      if (!scopeKeys.length) return [];
      const matchQuery = buildFtsMatchQuery(query);
      if (!matchQuery) return [];
      const placeholders = scopeKeys.map(() => "?").join(", ");
      try {
        const rows = db.query(`
          SELECT f.path, f.scope_key, f.kind, f.mem_type, f.owner, f.name, f.description, bm25(memory_files_fts) AS rank
          FROM memory_files_fts
          JOIN memory_files f ON f.path = memory_files_fts.path
          WHERE memory_files_fts MATCH ? AND f.scope_key IN (${placeholders}) AND f.kind IN ('topic', 'rollout')
          ORDER BY (CASE WHEN f.owner = 'user' THEN -1.0 ELSE 0.0 END) + rank ASC
          LIMIT ?
        `).all(matchQuery, ...scopeKeys, limit) as FtsResultRow[];

        return rows.map((row): MemorySearchHit => {
          const scope = parseScopeKey(row.scope_key);
          const prefix = `${row.scope_key}/`;
          const relPath = row.path.startsWith(prefix) ? row.path.slice(prefix.length) : row.path;
          return {
            scope,
            path: relPath,
            kind: row.kind as MemoryFileKind,
            ...(row.mem_type ? { memType: row.mem_type as MemoryType } : {}),
            owner: (row.owner === "user" ? "user" : "agent") as MemoryOwner,
            name: row.name,
            description: row.description,
            snippet: row.description,
            score: Math.max(0.01, 1 / (1 + Math.abs(row.rank))),
          };
        });
      } catch {
        return [];
      }
    },

    close() {
      db.close();
    },
  };
}
