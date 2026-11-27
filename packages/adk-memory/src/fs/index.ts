/** Local filesystem Markdown store for ~/.alphacode/memory/{user,projects/<id>,bots/<id>}/. */
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  memoryScopeKey,
  type IndexedMemoryFile,
  type MemoryCoordinatorStore,
  type MemoryFileKind,
  type MemoryOwner,
  type MemoryRollout,
  type MemoryScope,
  type MemorySearchHit,
  type MemoryStore,
  type MemoryTopicInput,
  type MemoryTopicMeta,
} from "../contracts";
import {
  buildIndexMarkdown,
  defaultMaxIndexBytes,
  defaultMaxIndexLines,
  parseTopicMarkdown,
  serializeTopicMarkdown,
  slugifyTopic,
} from "../frontmatter";
import { assertSafeRelativeMemoryPath, sanitizeMemoryText, sanitizeScopeSegment } from "../sanitizer";

const maxSnapshotsPerScope = 10;

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function scopeRelativeDir(scope: MemoryScope): string {
  if (scope.type === "user") return "user";
  const segment = sanitizeScopeSegment(scope.id);
  return scope.type === "bot" ? join("bots", segment) : join("projects", segment);
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(tempPath, content, { encoding: "utf8", mode: 0o600 });
  await rename(tempPath, filePath);
}

async function readIfExists(filePath: string): Promise<{ readonly content: string; readonly mtimeMs: number } | undefined> {
  try {
    const [content, info] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
    if (!info.isFile()) return undefined;
    return { content, mtimeMs: Math.floor(info.mtimeMs) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter(e => e.isFile() && e.name.endsWith(".md")).map(e => e.name).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function extractMarkdownTitle(content: string, fallback: string): string {
  const heading = /^#\s+(.+)$/m.exec(content);
  return heading?.[1]?.trim() || fallback;
}

export function createFsMemoryStore(
  rootDir: string,
  options: { readonly coordinator?: MemoryCoordinatorStore } = {},
): MemoryStore {
  const resolvedRoot = resolve(rootDir);

  function resolveScopeDir(scope: MemoryScope): string {
    return resolve(resolvedRoot, scopeRelativeDir(scope));
  }

  function resolveSafeFile(scope: MemoryScope, relativePath: string): { readonly rel: string; readonly abs: string } {
    const rel = assertSafeRelativeMemoryPath(relativePath);
    const scopeDir = resolveScopeDir(scope);
    const abs = resolve(scopeDir, rel);
    if (abs !== scopeDir && !abs.startsWith(`${scopeDir}${join("/", "").slice(0, 1)}`) && !abs.startsWith(`${scopeDir}\\`)) {
      throw Object.assign(new Error("MEMORY_PATH_INVALID"), { code: "MEMORY_PATH_INVALID" });
    }
    return { rel, abs };
  }

  async function collectScopeIndexedFiles(scope: MemoryScope): Promise<IndexedMemoryFile[]> {
    const scopeKey = memoryScopeKey(scope);
    const scopeDir = resolveScopeDir(scope);
    const files: IndexedMemoryFile[] = [];

    const idx = await readIfExists(join(scopeDir, "MEMORY.md"));
    if (idx) {
      files.push({
        path: `${scopeKey}/MEMORY.md`,
        scopeKey,
        kind: "index",
        owner: "agent",
        name: "MEMORY.md",
        description: extractMarkdownTitle(idx.content, "Memory Index"),
        body: idx.content,
        contentSha256: sha256(idx.content),
        mtimeMs: idx.mtimeMs,
        updatedAt: new Date(idx.mtimeMs).toISOString(),
      });
    }

    for (const [subDir, kind] of [["topics", "topic"], ["pending", "pending"]] as const) {
      const names = await listMarkdownFiles(join(scopeDir, subDir));
      for (const fileName of names) {
        const slug = fileName.slice(0, -3);
        const rel = `${subDir}/${fileName}`;
        const loaded = await readIfExists(join(scopeDir, subDir, fileName));
        if (!loaded) continue;
        const parsed = parseTopicMarkdown(loaded.content, {
          scope,
          slug,
          path: rel,
          updatedAt: new Date(loaded.mtimeMs).toISOString().slice(0, 10),
        });
        files.push({
          path: `${scopeKey}/${rel}`,
          scopeKey,
          kind,
          memType: parsed.type,
          owner: parsed.owner,
          name: parsed.name,
          description: parsed.description,
          body: parsed.body,
          contentSha256: sha256(loaded.content),
          mtimeMs: loaded.mtimeMs,
          updatedAt: parsed.updatedAt,
        });
      }
    }

    const rollouts = await listMarkdownFiles(join(scopeDir, "rollouts"));
    for (const fileName of rollouts) {
      const rel = `rollouts/${fileName}`;
      const loaded = await readIfExists(join(scopeDir, "rollouts", fileName));
      if (!loaded) continue;
      const title = extractMarkdownTitle(loaded.content, fileName.slice(0, -3));
      files.push({
        path: `${scopeKey}/${rel}`,
        scopeKey,
        kind: "rollout",
        owner: "agent",
        name: title,
        description: title,
        body: loaded.content,
        contentSha256: sha256(loaded.content),
        mtimeMs: loaded.mtimeMs,
        updatedAt: new Date(loaded.mtimeMs).toISOString(),
      });
    }

    return files;
  }

  async function syncScope(scope: MemoryScope): Promise<void> {
    if (!options.coordinator) return;
    const files = await collectScopeIndexedFiles(scope);
    options.coordinator.syncScopeFiles(memoryScopeKey(scope), files);
  }

  async function listTopicDir(scope: MemoryScope, subDir: "topics" | "pending"): Promise<MemoryTopicMeta[]> {
    const scopeDir = resolveScopeDir(scope);
    const names = await listMarkdownFiles(join(scopeDir, subDir));
    const items: MemoryTopicMeta[] = [];
    for (const fileName of names) {
      const slug = fileName.slice(0, -3);
      const rel = `${subDir}/${fileName}`;
      const loaded = await readIfExists(join(scopeDir, subDir, fileName));
      if (!loaded) continue;
      const parsed = parseTopicMarkdown(loaded.content, {
        scope,
        slug,
        path: rel,
        updatedAt: new Date(loaded.mtimeMs).toISOString().slice(0, 10),
      });
      const { body: _ignored, ...meta } = parsed;
      void _ignored;
      items.push(meta);
    }
    return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  return {
    rootDir: resolvedRoot,

    async readIndex(scope) {
      const loaded = await readIfExists(join(resolveScopeDir(scope), "MEMORY.md"));
      return loaded?.content;
    },

    async writeIndex(scope, content) {
      await atomicWrite(join(resolveScopeDir(scope), "MEMORY.md"), content);
      await syncScope(scope);
    },

    listTopics(scope) {
      return listTopicDir(scope, "topics");
    },

    async readTopic(scope, slug) {
      const safeSlug = slugifyTopic(slug);
      const rel = `topics/${safeSlug}.md`;
      const { abs } = resolveSafeFile(scope, rel);
      const loaded = await readIfExists(abs);
      if (!loaded) return undefined;
      return parseTopicMarkdown(loaded.content, {
        scope,
        slug: safeSlug,
        path: rel,
        updatedAt: new Date(loaded.mtimeMs).toISOString().slice(0, 10),
      });
    },

    async writeTopic(scope, input: MemoryTopicInput, writeOptions) {
      const safeSlug = slugifyTopic(input.slug);
      const rel = `topics/${safeSlug}.md`;
      const { abs } = resolveSafeFile(scope, rel);
      const existing = await readIfExists(abs);
      if (existing) {
        const parsed = parseTopicMarkdown(existing.content, {
          scope,
          slug: safeSlug,
          path: rel,
          updatedAt: new Date(existing.mtimeMs).toISOString().slice(0, 10),
        });
        const actor = writeOptions?.actor ?? input.owner ?? "agent";
        if (parsed.owner === "user" && actor !== "user" && !writeOptions?.allowOverwriteLocked) {
          throw Object.assign(new Error("MEMORY_LOCKED_BY_USER"), { code: "MEMORY_LOCKED_BY_USER" });
        }
      }
      const owner: MemoryOwner = writeOptions?.actor === "user" ? "user" : (input.owner ?? "agent");
      const updatedAt = input.updatedAt ?? new Date().toISOString().slice(0, 10);
      const cleanName = sanitizeMemoryText(input.name).text.trim();
      const cleanDesc = sanitizeMemoryText(input.description).text.trim();
      const cleanBody = sanitizeMemoryText(input.body).text.trim();
      const markdown = serializeTopicMarkdown({
        name: cleanName,
        description: cleanDesc,
        type: input.type,
        owner,
        updatedAt,
        proposedBy: input.proposedBy,
        body: cleanBody,
      });
      await atomicWrite(abs, markdown);
      await syncScope(scope);
      return {
        scope,
        slug: safeSlug,
        path: rel,
        name: cleanName,
        description: cleanDesc,
        type: input.type,
        owner,
        updatedAt,
        ...(input.proposedBy ? { proposedBy: input.proposedBy } : {}),
        body: cleanBody,
      };
    },

    async deleteTopic(scope, slug, deleteOptions) {
      const safeSlug = slugifyTopic(slug);
      const rel = `topics/${safeSlug}.md`;
      const { abs } = resolveSafeFile(scope, rel);
      const existing = await readIfExists(abs);
      if (!existing) return false;
      const parsed = parseTopicMarkdown(existing.content, {
        scope,
        slug: safeSlug,
        path: rel,
        updatedAt: new Date(existing.mtimeMs).toISOString().slice(0, 10),
      });
      const actor = deleteOptions?.actor ?? "agent";
      if (parsed.owner === "user" && actor !== "user" && !deleteOptions?.allowDeleteLocked) {
        throw Object.assign(new Error("MEMORY_LOCKED_BY_USER"), { code: "MEMORY_LOCKED_BY_USER" });
      }
      await rm(abs, { force: true });
      await syncScope(scope);
      return true;
    },

    async writeProposal(scope, input) {
      const safeSlug = slugifyTopic(input.slug);
      const rel = `pending/${safeSlug}.md`;
      const { abs } = resolveSafeFile(scope, rel);
      const updatedAt = input.updatedAt ?? new Date().toISOString().slice(0, 10);
      const cleanName = sanitizeMemoryText(input.name).text.trim();
      const cleanDesc = sanitizeMemoryText(input.description).text.trim();
      const cleanBody = sanitizeMemoryText(input.body).text.trim();
      const markdown = serializeTopicMarkdown({
        name: cleanName,
        description: cleanDesc,
        type: input.type,
        owner: "agent",
        updatedAt,
        proposedBy: input.proposedBy ?? "worker",
        body: cleanBody,
      });
      await atomicWrite(abs, markdown);
      await syncScope(scope);
      return {
        scope,
        slug: safeSlug,
        path: rel,
        name: cleanName,
        description: cleanDesc,
        type: input.type,
        owner: "agent",
        updatedAt,
        proposedBy: input.proposedBy ?? "worker",
        body: cleanBody,
      };
    },

    listProposals(scope) {
      return listTopicDir(scope, "pending");
    },

    async writeRollout(scope, input): Promise<MemoryRollout> {
      const safeSlug = slugifyTopic(input.slug);
      const rel = `rollouts/${safeSlug}.md`;
      const { abs } = resolveSafeFile(scope, rel);
      const createdAt = input.createdAt ?? new Date().toISOString();
      const cleanBody = sanitizeMemoryText(input.body).text.trim();
      await atomicWrite(abs, `${cleanBody}\n`);
      await syncScope(scope);
      return {
        scope,
        slug: safeSlug,
        path: rel,
        sessionId: input.sessionId,
        title: input.title,
        body: cleanBody,
        createdAt,
      };
    },

    async listRollouts(scope, limit = 20) {
      const scopeDir = resolveScopeDir(scope);
      const names = await listMarkdownFiles(join(scopeDir, "rollouts"));
      const items: { slug: string; path: string; title: string; updatedAt: string }[] = [];
      for (const fileName of names) {
        const loaded = await readIfExists(join(scopeDir, "rollouts", fileName));
        if (!loaded) continue;
        const slug = fileName.slice(0, -3);
        items.push({
          slug,
          path: `rollouts/${fileName}`,
          title: extractMarkdownTitle(loaded.content, slug),
          updatedAt: new Date(loaded.mtimeMs).toISOString(),
        });
      }
      return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
    },

    async readFile(scope, relativePath, maxBytes = 16 * 1024) {
      const { rel, abs } = resolveSafeFile(scope, relativePath);
      const loaded = await readIfExists(abs);
      if (!loaded) return undefined;
      const buf = Buffer.from(loaded.content, "utf8");
      const truncated = buf.byteLength > maxBytes;
      const content = truncated ? buf.subarray(0, maxBytes).toString("utf8") : loaded.content;
      return { path: rel, content, truncated };
    },

    async rebuildIndex(scope, rebuildOptions) {
      const topics = await listTopicDir(scope, "topics");
      const rollouts = await this.listRollouts(scope, 12);
      const content = buildIndexMarkdown(scope, topics, rollouts, {
        maxLines: rebuildOptions?.maxLines ?? defaultMaxIndexLines,
        maxBytes: rebuildOptions?.maxBytes ?? defaultMaxIndexBytes,
      });
      await atomicWrite(join(resolveScopeDir(scope), "MEMORY.md"), content);
      await syncScope(scope);
      return content;
    },

    async search(query, scopes, limit = 8) {
      if (!query.trim() || !scopes.length) return [];
      if (options.coordinator) {
        // Ensure disk index is synced before FTS5 search so hand-edited Markdown files are always found.
        for (const scope of scopes) await syncScope(scope);
        const hits = options.coordinator.searchFts(query, scopes.map(memoryScopeKey), limit);
        if (hits.length) return hits;
      }
      // Pure filesystem fallback when SQLite coordinator is absent or query has punctuation.
      const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const results: MemorySearchHit[] = [];
      for (const scope of scopes) {
        const files = await collectScopeIndexedFiles(scope);
        for (const file of files) {
          if (file.kind === "index" || file.kind === "pending") continue;
          const hay = `${file.name}\n${file.description}\n${file.body}`.toLowerCase();
          let score = 0;
          if (hay.includes(query.trim().toLowerCase())) score += 2;
          for (const term of terms) {
            if (hay.includes(term)) score += 1;
          }
          if (score <= 0) continue;
          const relPath = file.path.slice(`${memoryScopeKey(scope)}/`.length);
          results.push({
            scope,
            path: relPath,
            kind: file.kind as MemoryFileKind,
            name: file.name,
            description: file.description,
            ...(file.memType ? { memType: file.memType } : {}),
            owner: file.owner,
            snippet: file.description || file.body.slice(0, 180),
            score: score + (file.owner === "user" ? 0.5 : 0),
          });
        }
      }
      return results.sort((a, b) => b.score - a.score).slice(0, limit);
    },

    async snapshotScope(scope) {
      const scopeDir = resolveScopeDir(scope);
      const snapshotId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 6)}`;
      const snapDir = join(scopeDir, ".snapshots", snapshotId);
      await mkdir(snapDir, { recursive: true });
      const idx = await readIfExists(join(scopeDir, "MEMORY.md"));
      if (idx) await writeFile(join(snapDir, "MEMORY.md"), idx.content, "utf8");
      const topicsDir = join(scopeDir, "topics");
      try {
        if ((await stat(topicsDir)).isDirectory()) {
          await cp(topicsDir, join(snapDir, "topics"), { recursive: true });
        }
      } catch { /* No topics dir yet. */ }
      // Prune old snapshots beyond retention cap.
      const snapshotsRoot = join(scopeDir, ".snapshots");
      try {
        const dirs = (await readdir(snapshotsRoot, { withFileTypes: true }))
          .filter(d => d.isDirectory())
          .map(d => d.name)
          .sort()
          .reverse();
        for (const stale of dirs.slice(maxSnapshotsPerScope)) {
          await rm(join(snapshotsRoot, stale), { recursive: true, force: true });
        }
      } catch { /* Ignore cleanup errors. */ }
      return snapshotId;
    },

    async restoreSnapshot(scope, snapshotId) {
      const safeSnap = sanitizeScopeSegment(basename(snapshotId));
      const scopeDir = resolveScopeDir(scope);
      const snapDir = join(scopeDir, ".snapshots", safeSnap);
      const info = await stat(snapDir).catch(() => undefined);
      if (!info?.isDirectory()) throw Object.assign(new Error("MEMORY_SNAPSHOT_NOT_FOUND"), { code: "MEMORY_SNAPSHOT_NOT_FOUND" });
      const snapIdx = await readIfExists(join(snapDir, "MEMORY.md"));
      if (snapIdx) await atomicWrite(join(scopeDir, "MEMORY.md"), snapIdx.content);
      await rm(join(scopeDir, "topics"), { recursive: true, force: true });
      const snapTopics = join(snapDir, "topics");
      if ((await stat(snapTopics).catch(() => undefined))?.isDirectory()) {
        await cp(snapTopics, join(scopeDir, "topics"), { recursive: true });
      }
      await syncScope(scope);
    },

    async listSnapshots(scope) {
      const snapshotsRoot = join(resolveScopeDir(scope), ".snapshots");
      try {
        return (await readdir(snapshotsRoot, { withFileTypes: true }))
          .filter(d => d.isDirectory())
          .map(d => d.name)
          .sort()
          .reverse();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
    },

    async syncIndex(scopes) {
      if (!options.coordinator || !scopes) return;
      for (const scope of scopes) await syncScope(scope);
    },
  };
}
