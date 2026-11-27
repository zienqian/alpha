/** ADK plugin for Claude Code + Codex style persistent memory (cache-stable & Worker-safe). */
import type { JsonObject, Plugin, Tool, ToolContext, ToolInfo } from "@alpha/adk/core";
import {
  memoryScopeKey,
  memoryTypes,
  type MemoryPluginHandle,
  type MemoryPluginOptions,
  type MemoryScope,
  type MemoryScopeType,
  type MemoryType,
} from "./contracts";
import { defaultMaxIndexBytes, defaultMaxIndexLines, slugifyTopic, truncateIndexMarkdown } from "./frontmatter";
import { assertSafeRelativeMemoryPath, sanitizeMemoryText } from "./sanitizer";

const maxReadBytes = 16 * 1024;
const maxTopicBodyChars = 8000;
const maxNameChars = 120;
const maxDescChars = 240;
const maxHistorySnippetChars = 400;

function defineMemoryTool<C>(spec: {
  readonly name: string;
  readonly description: string;
  readonly effect: ToolInfo["effect"];
  readonly inputSchema: JsonObject;
  readonly validate: (raw: JsonObject) => JsonObject;
  readonly execute: (args: JsonObject, ctx: ToolContext<C>) => Promise<string> | string;
}): Tool<C> {
  const info: ToolInfo = Object.freeze({
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema,
    effect: spec.effect,
  });
  return Object.freeze({
    info,
    prepare(raw: JsonObject, signal: AbortSignal) {
      if (signal.aborted) throw Object.assign(new Error("TOOL_INPUT_INVALID"), { code: "TOOL_INPUT_INVALID" });
      const validated = spec.validate(raw);
      return Object.freeze({
        arguments: validated,
        execute: (ctx: ToolContext<C>) => spec.execute(validated, ctx),
      });
    },
  });
}

function asString(value: unknown, maxLen: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw Object.assign(new Error("TOOL_INPUT_INVALID"), { code: "TOOL_INPUT_INVALID" });
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLen) throw Object.assign(new Error("TOOL_INPUT_INVALID"), { code: "TOOL_INPUT_INVALID" });
  return trimmed;
}

function asRequiredString(value: unknown, maxLen: number): string {
  const parsed = asString(value, maxLen);
  if (!parsed) throw Object.assign(new Error("TOOL_INPUT_INVALID"), { code: "TOOL_INPUT_INVALID" });
  return parsed;
}

function findScope(scopes: readonly MemoryScope[], requestedType?: string): MemoryScope | undefined {
  if (!scopes.length) return undefined;
  if (!requestedType) return scopes[0];
  return scopes.find(s => s.type === (requestedType as MemoryScopeType));
}

function formatScopeHeader(scope: MemoryScope): string {
  if (scope.type === "user") return "### Scope: user (global preferences & feedback)";
  if (scope.type === "bot") return `### Scope: bot (${scope.id} — Bot private memory)`;
  return `### Scope: project (${scope.id} — workspace shared memory)`;
}

function buildInjectedMemoryBlock(
  entries: readonly { readonly scope: MemoryScope; readonly content: string; readonly truncated: boolean }[],
  writeMode: MemoryPluginOptions["writeMode"],
  hasHistorySearch: boolean,
  maxTotalBytes: number,
): string {
  const modeRule = writeMode === "direct"
    ? "Use memory_write to save durable user preferences, feedback corrections, non-derivable project decisions, or external references. Never save code facts derivable from files/git or secrets."
    : writeMode === "propose_only"
      ? "You have READ-ONLY access to active memory. Use memory_propose only if you uncover a durable project pitfall or convention for the user/Router to review."
      : "You have READ-ONLY access to persistent memory.";

  const readHint = hasHistorySearch
    ? "Call memory_read(scope, path), memory_search(query), or memory_history_search(query) to inspect linked topic files, rollout summaries, or archived past sessions on demand."
    : "Call memory_read(scope, path) or memory_search(query) to inspect linked topic files or rollout summaries on demand.";

  const headerLines = [
    "<auto_memory>",
    "Persistent cross-session memory pointer index (frozen at session start for prompt-cache stability).",
    "IMPORTANT: Memory entries may become outdated. ALWAYS verify file paths, symbols, and behavior against the current codebase before acting on a remembered claim.",
    `${readHint} ${modeRule}`,
  ];

  if (!entries.length) {
    headerLines.push("", "(No memory entries saved yet.)", "</auto_memory>");
    return headerLines.join("\n");
  }

  const encoder = new TextEncoder();
  const header = headerLines.join("\n");
  const parts: string[] = [header];
  let totalBytes = encoder.encode(header).length + 32;

  for (const entry of entries) {
    const sectionHead = `\n\n${formatScopeHeader(entry.scope)}\n`;
    const headBytes = encoder.encode(sectionHead).length;
    const remaining = maxTotalBytes - totalBytes - headBytes;
    if (remaining <= 64) break;
    const clipped = truncateIndexMarkdown(entry.content, defaultMaxIndexLines, remaining);
    const suffix = clipped.truncated || entry.truncated ? "\n<!-- ... truncated to budget; use memory_search / memory_read for more -->" : "";
    const chunk = `${sectionHead}${clipped.content}${suffix}`;
    parts.push(chunk);
    totalBytes += encoder.encode(chunk).length;
  }

  parts.push("\n</auto_memory>");
  return parts.join("");
}

export function createMemoryPlugin<C = undefined>(options: MemoryPluginOptions): MemoryPluginHandle<C> {
  const maxLines = options.maxIndexLines ?? defaultMaxIndexLines;
  const maxBytes = options.maxIndexBytes ?? defaultMaxIndexBytes;
  const readScopes = [...options.readScopes];
  const writableScopes = options.writableScopes?.length
    ? [...options.writableScopes]
    : options.writeScope
      ? [options.writeScope]
      : [];
  const defaultWriteScope = options.writeScope ?? writableScopes[0];
  const messageId = `memory-index:${globalThis.crypto.randomUUID()}`;

  // Frozen at session start so LLM KV Prompt Cache & @alpha/adk-context checkpoint fingerprint never churn mid-session.
  let frozenContent: string | undefined;
  let loaded = false;
  let wroteInRun = false;
  let used = false;

  async function ensureLoaded(): Promise<string> {
    if (loaded) return frozenContent ?? "";
    loaded = true;
    const entries: { scope: MemoryScope; content: string; truncated: boolean }[] = [];
    for (const scope of readScopes) {
      const raw = await options.store.readIndex(scope).catch(() => undefined);
      if (!raw || !raw.trim()) continue;
      const clipped = truncateIndexMarkdown(raw, maxLines, maxBytes);
      if (clipped.content.trim()) {
        entries.push({ scope, content: clipped.content, truncated: clipped.truncated });
      }
    }
    frozenContent = buildInjectedMemoryBlock(entries, options.writeMode, Boolean(options.historySearcher), maxBytes);
    return frozenContent;
  }

  const readTool = defineMemoryTool<C>({
    name: "memory_read",
    description: "Read a persistent memory file (MEMORY.md, topics/<slug>.md, or rollouts/<slug>.md) within allowed scopes.",
    effect: "read",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: readScopes.map(s => s.type), description: "Target memory scope (user, project, or bot)." },
        path: { type: "string", description: "Relative file path inside the scope, e.g. 'MEMORY.md' or 'topics/bun-baseline.md'." },
      },
      required: ["path"],
    },
    validate(raw) {
      const scopeType = asString(raw.scope, 32);
      const path = assertSafeRelativeMemoryPath(asRequiredString(raw.path, 200));
      return { ...(scopeType ? { scope: scopeType } : {}), path };
    },
    async execute(args) {
      const targetScope = findScope(readScopes, typeof args.scope === "string" ? args.scope : undefined);
      if (!targetScope) return JSON.stringify({ ok: false, code: "MEMORY_SCOPE_FORBIDDEN" });
      const file = await options.store.readFile(targetScope, String(args.path), maxReadBytes);
      if (!file) return JSON.stringify({ ok: false, code: "MEMORY_NOT_FOUND", scope: memoryScopeKey(targetScope), path: String(args.path) });
      return JSON.stringify({ ok: true, scope: memoryScopeKey(targetScope), ...file });
    },
  });

  const searchTool = defineMemoryTool<C>({
    name: "memory_search",
    description: "Search across persistent cross-session memory topics and rollout summaries using lexical + CJK keyword matching.",
    effect: "read",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keywords (English, Chinese, identifiers, or paths)." },
        scope: { type: "string", enum: readScopes.map(s => s.type), description: "Optional single scope filter." },
        limit: { type: "number", description: "Max results (1..20, default 8)." },
      },
      required: ["query"],
    },
    validate(raw) {
      const query = asRequiredString(raw.query, 300);
      const scopeType = asString(raw.scope, 32);
      const limit = raw.limit === undefined ? 8 : Math.min(20, Math.max(1, Math.floor(Number(raw.limit) || 8)));
      return { query, ...(scopeType ? { scope: scopeType } : {}), limit };
    },
    async execute(args) {
      const scopes = typeof args.scope === "string"
        ? readScopes.filter(s => s.type === args.scope)
        : readScopes;
      if (!scopes.length) return JSON.stringify({ ok: true, hits: [] });
      const hits = await options.store.search(String(args.query), scopes, Number(args.limit ?? 8));
      return JSON.stringify({
        ok: true,
        hits: hits.map(hit => ({
          scope: hit.scope.type,
          path: hit.path,
          kind: hit.kind,
          type: hit.memType,
          owner: hit.owner,
          name: hit.name,
          description: hit.description,
          snippet: hit.snippet,
        })),
      });
    },
  });

  const historySearcher = options.historySearcher;
  const historySearchTool = historySearcher
    ? defineMemoryTool<C>({
      name: "memory_history_search",
      description: "Search archived past conversation sessions within this workspace/bot for earlier decisions, commands, or context not yet captured in MEMORY.md.",
      effect: "read",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search keywords or phrase (English, Chinese, identifiers, or paths)." },
          limit: { type: "number", description: "Max results (1..20, default 8)." },
        },
        required: ["query"],
      },
      validate(raw) {
        const query = asRequiredString(raw.query, 300);
        const limit = raw.limit === undefined ? 8 : Math.min(20, Math.max(1, Math.floor(Number(raw.limit) || 8)));
        return { query, limit };
      },
      async execute(args, ctx) {
        const limit = Number(args.limit ?? 8);
        const hits = await historySearcher(String(args.query), { limit, signal: ctx.signal });
        return JSON.stringify({
          ok: true,
          hits: hits.slice(0, limit).map(hit => {
            const cleanTitle = sanitizeMemoryText(hit.title).text.trim().slice(0, 120);
            const cleanSnippet = sanitizeMemoryText(hit.snippet).text.trim();
            const snippet = cleanSnippet.length > maxHistorySnippetChars
              ? `${cleanSnippet.slice(0, maxHistorySnippetChars - 1)}…`
              : cleanSnippet;
            return {
              sessionId: hit.sessionId,
              title: cleanTitle,
              role: hit.role,
              ...(hit.messageId ? { messageId: hit.messageId } : {}),
              snippet,
              updatedAt: hit.updatedAt,
            };
          }),
        });
      },
    })
    : undefined;

  const writeTool = options.writeMode === "direct" && defaultWriteScope
    ? defineMemoryTool<C>({
      name: "memory_write",
      description: "Save, update, or delete a persistent topic memory file and refresh MEMORY.md. Refuses to overwrite user-locked topics. Never store secrets or derivable code facts.",
      effect: "write",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["upsert", "delete"], description: "Default 'upsert'." },
          scope: { type: "string", enum: writableScopes.map(s => s.type), description: `Target writable scope (default '${defaultWriteScope.type}').` },
          slug: { type: "string", description: "Short kebab-case topic filename slug (without .md)." },
          name: { type: "string", description: "Short human-readable memory title." },
          description: { type: "string", description: "One-line summary shown in MEMORY.md pointer index." },
          type: { type: "string", enum: [...memoryTypes], description: "Memory category: user, feedback, project, or reference." },
          body: { type: "string", description: "Concise durable Markdown content (include Why / How to apply for feedback)." },
        },
        required: ["slug"],
      },
      validate(raw) {
        const action = raw.action === "delete" ? "delete" : "upsert";
        const scopeType = asString(raw.scope, 32);
        const slug = slugifyTopic(asRequiredString(raw.slug, 120));
        if (action === "delete") {
          return { action, ...(scopeType ? { scope: scopeType } : {}), slug };
        }
        const name = asRequiredString(raw.name, maxNameChars);
        const description = asRequiredString(raw.description, maxDescChars);
        const type = asRequiredString(raw.type, 32);
        if (!memoryTypes.includes(type as MemoryType)) {
          throw Object.assign(new Error("TOOL_INPUT_INVALID"), { code: "TOOL_INPUT_INVALID" });
        }
        const body = asRequiredString(raw.body, maxTopicBodyChars);
        return { action, ...(scopeType ? { scope: scopeType } : {}), slug, name, description, type, body };
      },
      async execute(args) {
        const targetScope = findScope(writableScopes, typeof args.scope === "string" ? args.scope : undefined) ?? defaultWriteScope;
        if (!targetScope) return JSON.stringify({ ok: false, code: "MEMORY_WRITE_FORBIDDEN" });
        const slug = String(args.slug);
        if (args.action === "delete") {
          try {
            const deleted = await options.store.deleteTopic(targetScope, slug, { actor: "agent" });
            if (!deleted) return JSON.stringify({ ok: false, code: "MEMORY_NOT_FOUND", slug });
            await options.store.rebuildIndex(targetScope, { maxLines, maxBytes });
            wroteInRun = true;
            await options.onWrite?.({ scope: targetScope, path: `topics/${slug}.md`, action: "delete" });
            return JSON.stringify({ ok: true, action: "delete", scope: memoryScopeKey(targetScope), path: `topics/${slug}.md` });
          } catch (error) {
            const code = (error as { code?: string }).code ?? "MEMORY_WRITE_FAILED";
            return JSON.stringify({ ok: false, code, message: code === "MEMORY_LOCKED_BY_USER" ? "This memory is locked by the user and cannot be deleted by the agent." : String(error) });
          }
        }
        const cleanName = sanitizeMemoryText(String(args.name));
        const cleanDesc = sanitizeMemoryText(String(args.description));
        const cleanBody = sanitizeMemoryText(String(args.body));
        const redactedCount = cleanName.redactedCount + cleanDesc.redactedCount + cleanBody.redactedCount;
        try {
          const saved = await options.store.writeTopic(targetScope, {
            slug,
            name: cleanName.text,
            description: cleanDesc.text,
            type: args.type as MemoryType,
            owner: "agent",
            body: cleanBody.text,
          }, { actor: "agent" });
          await options.store.rebuildIndex(targetScope, { maxLines, maxBytes });
          wroteInRun = true;
          await options.onWrite?.({ scope: targetScope, path: saved.path, action: "upsert" });
          return JSON.stringify({
            ok: true,
            action: "upsert",
            scope: memoryScopeKey(targetScope),
            path: saved.path,
            redactedSecrets: redactedCount,
          });
        } catch (error) {
          const code = (error as { code?: string }).code ?? "MEMORY_WRITE_FAILED";
          return JSON.stringify({ ok: false, code, message: code === "MEMORY_LOCKED_BY_USER" ? "This memory is owned/locked by the user and cannot be overwritten by the agent." : String(error) });
        }
      },
    })
    : undefined;

  const proposeTool = options.writeMode === "propose_only" && defaultWriteScope
    ? defineMemoryTool<C>({
      name: "memory_propose",
      description: "Propose a durable project/bot memory into the isolated pending/ review folder. Proposals are never injected into active memory until approved.",
      effect: "write",
      inputSchema: {
        type: "object",
        properties: {
          slug: { type: "string", description: "Short kebab-case slug." },
          name: { type: "string", description: "Short title." },
          description: { type: "string", description: "One-line summary." },
          type: { type: "string", enum: [...memoryTypes], description: "Memory category." },
          body: { type: "string", description: "Concise rationale and evidence." },
        },
        required: ["slug", "name", "description", "type", "body"],
      },
      validate(raw) {
        const slug = slugifyTopic(asRequiredString(raw.slug, 120));
        const name = asRequiredString(raw.name, maxNameChars);
        const description = asRequiredString(raw.description, maxDescChars);
        const type = asRequiredString(raw.type, 32);
        if (!memoryTypes.includes(type as MemoryType)) {
          throw Object.assign(new Error("TOOL_INPUT_INVALID"), { code: "TOOL_INPUT_INVALID" });
        }
        const body = asRequiredString(raw.body, maxTopicBodyChars);
        return { slug, name, description, type, body };
      },
      async execute(args) {
        const cleanName = sanitizeMemoryText(String(args.name));
        const cleanDesc = sanitizeMemoryText(String(args.description));
        const cleanBody = sanitizeMemoryText(String(args.body));
        const saved = await options.store.writeProposal(defaultWriteScope, {
          slug: String(args.slug),
          name: cleanName.text,
          description: cleanDesc.text,
          type: args.type as MemoryType,
          owner: "agent",
          proposedBy: options.proposedBy ?? "worker",
          body: cleanBody.text,
        });
        await options.onWrite?.({ scope: defaultWriteScope, path: saved.path, action: "propose" });
        return JSON.stringify({
          ok: true,
          status: "proposed",
          scope: memoryScopeKey(defaultWriteScope),
          path: saved.path,
          note: "Saved to pending/ quarantine for user or Router review.",
        });
      },
    })
    : undefined;

  const plugin: Plugin<C> = {
    id: "adk/memory",
    apiVersion: 1,
    setup(api) {
      if (used) throw Object.assign(new Error("PLUGIN_ALREADY_USED"), { code: "PLUGIN_ALREADY_USED" });
      used = true;
      api.addTool(readTool);
      api.addTool(searchTool);
      if (historySearchTool) api.addTool(historySearchTool);
      if (writeTool) api.addTool(writeTool);
      if (proposeTool) api.addTool(proposeTool);
      api.observe(event => {
        if (event.type === "run.start") wroteInRun = false;
      });
      api.hook("beforeModel", async messages => {
        const content = await ensureLoaded();
        if (!content) return messages;
        return [{ id: messageId, role: "user", content }, ...messages];
      });
    },
    async start() {
      await ensureLoaded();
    },
    dispose() {
      frozenContent = undefined;
      loaded = false;
    },
  };

  return {
    plugin,
    wroteInLastRun: () => wroteInRun,
    resetRunFlag: () => { wroteInRun = false; },
  };
}
