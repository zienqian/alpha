import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parentPort } from "node:worker_threads";
import type {
  TraceListOptions,
  TraceScope,
  TraceSnapshot,
  TraceSummary,
} from "../contracts";
import { failure, interrupt, validateScope } from "../internal";

let db: Database | undefined;
let owner = "",
  retentionDays = 7,
  maxBytes = 1024 * 1024 * 1024,
  lastPruned = 0;
function connection(): Database {
  if (!db) throw failure("TRACE_STORE_CLOSED");
  return db;
}
const scopeValues = (scope: TraceScope): [string, string] => {
  validateScope(scope);
  return [scope.namespace, scope.sessionId ?? ""];
};
function write(snapshot: TraceSnapshot) {
  const database = connection(),
    s = snapshot.summary;
  database
    .query(
      `INSERT INTO trace_runs(trace_id,namespace,session_id,started_at,status,revision,summary,body,bytes)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(trace_id) DO UPDATE SET status=excluded.status,revision=excluded.revision,
    summary=excluded.summary,body=excluded.body,bytes=excluded.bytes WHERE trace_runs.revision<=excluded.revision`,
    )
    .run(
      s.traceId,
      s.namespace,
      s.sessionId ?? "",
      s.startedAtMs,
      s.runStatus,
      s.revision,
      JSON.stringify(s),
      JSON.stringify(snapshot),
      new TextEncoder().encode(JSON.stringify(snapshot)).length,
    );
}
function prune() {
  if (Date.now() - lastPruned < 60000) return;
  lastPruned = Date.now();
  const database = connection();
  database
    .query("DELETE FROM trace_runs WHERE status!='running' AND started_at<?")
    .run(Date.now() - retentionDays * 86400000);
  let bytes = (
    database
      .query("SELECT COALESCE(SUM(bytes),0) AS size FROM trace_runs")
      .get() as { size: number }
  ).size;
  if (bytes <= maxBytes) return;
  for (const row of database
    .query(
      "SELECT trace_id,bytes FROM trace_runs WHERE status!='running' ORDER BY started_at",
    )
    .all() as { trace_id: string; bytes: number }[]) {
    database.query("DELETE FROM trace_runs WHERE trace_id=?").run(row.trace_id);
    bytes -= row.bytes;
    if (bytes <= maxBytes) break;
  }
}
function init(args: {
  filename: string;
  retentionDays?: number;
  maxBytes?: number;
}) {
  retentionDays = args.retentionDays ?? 7;
  maxBytes = args.maxBytes ?? 1024 * 1024 * 1024;
  if (
    !Number.isFinite(retentionDays) ||
    retentionDays <= 0 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1024
  )
    throw failure("TRACE_CONFIG_INVALID");
  mkdirSync(dirname(args.filename), { recursive: true });
  db = new Database(args.filename, { create: true, strict: true });
  db.exec(
    "PRAGMA busy_timeout=2000; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL",
  );
  const version = db.query("PRAGMA user_version").values()[0]?.[0];
  if (version !== 0 && version !== 1) throw failure("TRACE_SCHEMA_UNSUPPORTED");
  if (
    version === 0 &&
    db
      .query("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
      .all().length
  )
    throw failure("TRACE_SCHEMA_UNSUPPORTED");
  db.transaction(() => {
    db!.exec(`CREATE TABLE IF NOT EXISTS trace_runs (
      trace_id TEXT PRIMARY KEY, namespace TEXT NOT NULL, session_id TEXT NOT NULL,
      started_at REAL NOT NULL,status TEXT NOT NULL,revision INTEGER NOT NULL,
      summary TEXT NOT NULL,body TEXT NOT NULL,bytes INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS trace_scope ON trace_runs(namespace,session_id,started_at DESC,trace_id DESC);
      CREATE TABLE IF NOT EXISTS trace_owner (id INTEGER PRIMARY KEY CHECK(id=1),pid INTEGER NOT NULL,token TEXT NOT NULL);
      PRAGMA user_version=1;`);
    const previous = db!
      .query("SELECT pid FROM trace_owner WHERE id=1")
      .get() as { pid: number } | null;
    if (previous) {
      let alive = true;
      try {
        process.kill(previous.pid, 0);
      } catch (error) {
        if ((error as { code?: string }).code === "ESRCH") alive = false;
      }
      if (alive) throw failure("TRACE_STORE_IN_USE");
    }
    owner = crypto.randomUUID();
    db!
      .query("INSERT OR REPLACE INTO trace_owner(id,pid,token) VALUES(1,?,?)")
      .run(process.pid, owner);
    for (const row of db!
      .query("SELECT body FROM trace_runs WHERE status='running'")
      .all() as { body: string }[])
      write(interrupt(JSON.parse(row.body) as TraceSnapshot));
  }).immediate();
  prune();
}
function handle(op: string, args: unknown): unknown {
  if (op === "init") return init(args as Parameters<typeof init>[0]);
  const database = connection();
  if (op === "write") {
    database
      .transaction(() => {
        for (const snapshot of args as TraceSnapshot[]) write(snapshot);
        prune();
      })
      .immediate();
    return;
  }
  if (op === "read") {
    const { scope, traceId } = args as { scope: TraceScope; traceId: string };
    const row = database
      .query(
        "SELECT body FROM trace_runs WHERE namespace=? AND session_id=? AND trace_id=?",
      )
      .get(...scopeValues(scope), traceId) as { body: string } | null;
    return row ? JSON.parse(row.body) : undefined;
  }
  if (op === "findByReply") {
    const { scope, replyId } = args as { scope: TraceScope; replyId: string };
    const row = database
      .query(
        `SELECT summary FROM trace_runs WHERE namespace=? AND session_id=? AND (
      EXISTS(SELECT 1 FROM json_each(trace_runs.body,'$.spans') s WHERE json_extract(s.value,'$.kind')='model'
        AND (json_extract(s.value,'$.modelCallId')=? OR json_extract(s.value,'$.assistantId')=?))
      OR EXISTS(SELECT 1 FROM json_each(trace_runs.body,'$.messages') m WHERE json_extract(m.value,'$.role')='assistant' AND json_extract(m.value,'$.messageId')=?)
    ) ORDER BY started_at DESC LIMIT 1`,
      )
      .get(...scopeValues(scope), replyId, replyId, replyId) as {
      summary: string;
    } | null;
    return row ? JSON.parse(row.summary) : undefined;
  }
  if (op === "list") {
    const { scope, options = {} } = args as {
      scope: TraceScope;
      options?: TraceListOptions;
    };
    const limit = options.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200)
      throw failure("TRACE_LIMIT_INVALID");
    let cursor: [number, string] | undefined;
    if (options.cursor) {
      try {
        cursor = JSON.parse(decodeURIComponent(options.cursor));
      } catch {
        throw failure("TRACE_CURSOR_INVALID");
      }
      if (
        !Array.isArray(cursor) ||
        cursor.length !== 2 ||
        !Number.isFinite(cursor[0]) ||
        typeof cursor[1] !== "string"
      )
        throw failure("TRACE_CURSOR_INVALID");
    }
    const query = `SELECT summary FROM trace_runs WHERE namespace=? AND session_id=? ${cursor ? "AND (started_at<? OR (started_at=? AND trace_id<?))" : ""} ORDER BY started_at DESC,trace_id DESC LIMIT ?`;
    const rows = database
      .query(query)
      .all(
        ...scopeValues(scope),
        ...(cursor ? [cursor[0], cursor[0], cursor[1]] : []),
        limit + 1,
      ) as { summary: string }[];
    const items = rows
        .slice(0, limit)
        .map((r) => JSON.parse(r.summary) as TraceSummary),
      last = items.at(-1);
    return {
      items,
      ...(last && rows.length > limit
        ? {
            cursor: encodeURIComponent(
              JSON.stringify([last.startedAtMs, last.traceId]),
            ),
          }
        : {}),
    };
  }
  if (op === "deleteSession") {
    database
      .query("DELETE FROM trace_runs WHERE namespace=? AND session_id=?")
      .run(...scopeValues(args as TraceScope));
    return;
  }
  if (op === "close") {
    database.query("DELETE FROM trace_owner WHERE token=?").run(owner);
    database.close();
    db = undefined;
    return;
  }
  throw failure("TRACE_OPERATION_INVALID");
}
parentPort!.on("message", (data: { id: number; op: string; args: unknown }) => {
  try {
    parentPort!.postMessage({ id: data.id, value: handle(data.op, data.args) });
  } catch (error) {
    const code = (error as { code?: string }).code;
    parentPort!.postMessage({
      id: data.id,
      error: code?.startsWith("TRACE_") ? code : "TRACE_STORE_UNAVAILABLE",
    });
    if (data.op === "init") {
      db?.close();
      db = undefined;
    }
  }
});
