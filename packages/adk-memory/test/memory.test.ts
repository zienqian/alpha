import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgent, type AgentOptions } from "@alpha/adk/core";
import {
  assertSafeRelativeMemoryPath,
  buildIndexMarkdown,
  createMemoryPlugin,
  parseTopicMarkdown,
  runStage1Extraction,
  runStage2Dream,
  sanitizeMemoryText,
  serializeTopicMarkdown,
  truncateIndexMarkdown,
  type MemoryScope,
} from "../src/index";
import { createFsMemoryStore } from "../src/fs/index";
import { createSqliteMemoryStore } from "../src/sqlite/index";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "alpha-memory-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

type MockModel = NonNullable<AgentOptions<undefined>["model"]>;

function createMockModel(
  handler: (input: Parameters<MockModel["stream"]>[0], callIndex: number) => {
    text?: string;
    toolCalls?: { id: string; name: string; arguments: Record<string, unknown> }[];
  },
): MockModel {
  let index = 0;
  return {
    provider: "mock",
    modelId: "mock-1",
    async generate() { throw new Error("Kernel should use stream"); },
    async *stream(input) {
      const response = handler(input, index++);
      const calls = response.toolCalls ?? [];
      if (response.text) {
        yield { type: "text-delta", text: response.text };
      }
      yield {
        type: "finish",
        result: {
          outcome: calls.length ? "tool_calls" : "completed",
          text: response.text ?? "",
          toolCalls: calls.map(c => ({ id: c.id, name: c.name, arguments: c.arguments })),
          finishReason: calls.length ? "tool_calls" : "stop",
        },
      };
    },
  };
}

describe("@alpha/adk-memory", () => {
  test("sanitizes secrets and rejects path traversal", () => {
    const raw = [
      "Use OPENAI_API_KEY=sk-proj-1234567890abcdef1234567890",
      "Token: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456",
      "AWS AKIAIOSFODNN7EXAMPLE and github ghp_123456789012345678901234",
    ].join("\n");
    const clean = sanitizeMemoryText(raw);
    expect(clean.redactedCount).toBeGreaterThanOrEqual(4);
    expect(clean.text).not.toContain("sk-proj-");
    expect(clean.text).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(clean.text).not.toContain("ghp_");
    expect(clean.text).toContain("[REDACTED]");

    expect(assertSafeRelativeMemoryPath("MEMORY.md")).toBe("MEMORY.md");
    expect(assertSafeRelativeMemoryPath("topics/bun-baseline.md")).toBe("topics/bun-baseline.md");
    expect(() => assertSafeRelativeMemoryPath("../AGENTS.md")).toThrow("MEMORY_PATH_INVALID");
    expect(() => assertSafeRelativeMemoryPath("/etc/passwd")).toThrow("MEMORY_PATH_INVALID");
    expect(() => assertSafeRelativeMemoryPath("topics/nested/a.md")).toThrow("MEMORY_PATH_INVALID");
  });

  test("enforces 200-line / byte cap on MEMORY.md and round-trips frontmatter", () => {
    const manyLines = Array.from({ length: 260 }, (_, i) => `- [Item ${i}](topics/item-${i}.md) — desc ${i}`).join("\n");
    const clipped = truncateIndexMarkdown(manyLines, 200, 12 * 1024);
    expect(clipped.truncated).toBe(true);
    expect(clipped.content.split("\n").length).toBeLessThanOrEqual(200);

    const md = serializeTopicMarkdown({
      name: "Bun: Offline Tests",
      description: "Always run offline bun:test fixtures",
      type: "feedback",
      owner: "user",
      updatedAt: "2026-11-27",
      body: "Use offline mocks for unit tests.",
    });
    const parsed = parseTopicMarkdown(md, {
      scope: { type: "project", id: "alpha" },
      slug: "bun-offline",
      path: "topics/bun-offline.md",
      updatedAt: "2026-11-27",
    });
    expect(parsed.name).toBe("Bun: Offline Tests");
    expect(parsed.type).toBe("feedback");
    expect(parsed.owner).toBe("user");
    expect(parsed.body).toBe("Use offline mocks for unit tests.");
  });

  test("FS + SQLite FTS5 supports CJK + code search, user lock, and snapshots", async () => {
    const dir = await makeTempDir();
    const coordinator = createSqliteMemoryStore(join(dir, "memory.db"));
    const store = createFsMemoryStore(join(dir, "memory"), { coordinator });
    const projectScope: MemoryScope = { type: "project", id: "alpha" };

    try {
      await store.writeTopic(projectScope, {
        slug: "context-fingerprint",
        name: "上下文压缩检查点校验",
        description: "beforeModel 注入变化会导致 adkContext fingerprint 失效",
        type: "project",
        owner: "user",
        body: "保持首轮 MEMORY.md 冻结不变，保护压缩检查点与 KV Cache。",
      }, { actor: "user" });

      await store.rebuildIndex(projectScope);

      // Agent must not overwrite or delete user-locked topic.
      await expect(store.writeTopic(projectScope, {
        slug: "context-fingerprint",
        name: "Overwritten",
        description: "bad",
        type: "project",
        body: "bad",
      }, { actor: "agent" })).rejects.toThrow("MEMORY_LOCKED_BY_USER");

      await expect(store.deleteTopic(projectScope, "context-fingerprint", { actor: "agent" }))
        .rejects.toThrow("MEMORY_LOCKED_BY_USER");

      // CJK phrase search via 2-gram FTS5.
      const cjkHits = await store.search("压缩检查点", [projectScope], 5);
      expect(cjkHits.length).toBe(1);
      expect(cjkHits[0]?.path).toBe("topics/context-fingerprint.md");

      // CamelCase identifier search via lexical FTS5.
      const codeHits = await store.search("adkContext", [projectScope], 5);
      expect(codeHits.length).toBe(1);
      expect(codeHits[0]?.owner).toBe("user");

      // Snapshot + restore
      const snapId = await store.snapshotScope(projectScope);
      await store.writeTopic(projectScope, {
        slug: "temp-topic",
        name: "Temporary",
        description: "temp",
        type: "project",
        body: "temp body",
      }, { actor: "agent" });
      expect((await store.listTopics(projectScope)).length).toBe(2);
      await store.restoreSnapshot(projectScope, snapId);
      expect((await store.listTopics(projectScope)).length).toBe(1);
    } finally {
      coordinator.close();
    }
  });

  test("plugin freezes initial MEMORY.md across turns and isolates Worker writes to pending/", async () => {
    const dir = await makeTempDir();
    const coordinator = createSqliteMemoryStore(join(dir, "memory.db"));
    const store = createFsMemoryStore(join(dir, "memory"), { coordinator });
    const projectScope: MemoryScope = { type: "project", id: "alpha" };
    const botScope: MemoryScope = { type: "bot", id: "bot_1" };

    try {
      await store.writeTopic(projectScope, {
        slug: "baseline",
        name: "Bun Baseline",
        description: "Use Bun 1.4.4",
        type: "project",
        owner: "user",
        body: "Monorepo uses Bun 1.4.4.",
      }, { actor: "user" });
      await store.rebuildIndex(projectScope);

      // 1. Direct mode (Router / Session)
      const injectedSnapshots: string[] = [];
      const directHandle = createMemoryPlugin({
        store,
        readScopes: [projectScope, botScope],
        writeScope: botScope,
        writableScopes: [botScope, projectScope],
        writeMode: "direct",
      });
      const directModel = createMockModel((input, callIdx) => {
        const memMsg = input.messages.find(m => m.role === "user" && m.content.includes("<auto_memory>"));
        if (memMsg && memMsg.role === "user") injectedSnapshots.push(memMsg.content);
        if (callIdx === 0) {
          return {
            toolCalls: [{
              id: "c1",
              name: "memory_write",
              arguments: {
                scope: "bot",
                slug: "router-rule",
                name: "Router Rule",
                description: "Never edit code directly",
                type: "feedback",
                body: "Always dispatch coding tasks via Worktree workers.",
              },
            }],
          };
        }
        return { text: "Saved." };
      });

      const directAgent = await createAgent({
        model: directModel,
        instructions: "Test agent",
        plugins: [directHandle.plugin],
      });
      await directAgent.prompt("Remember my router rule");
      expect(directHandle.wroteInLastRun()).toBe(true);
      expect(await store.readTopic(botScope, "router-rule")).toBeDefined();

      // Second prompt must still receive the EXACT same frozen initial snapshot bytes (KV cache & checkpoint safe).
      await directAgent.prompt("Second turn");
      expect(injectedSnapshots.length).toBeGreaterThanOrEqual(2);
      expect(injectedSnapshots[0]).toBe(injectedSnapshots[injectedSnapshots.length - 1]);
      await directAgent.close();

      // 2. Propose-only mode (Bot Worker firewall)
      const seenWorkerTools: string[] = [];
      const workerHandle = createMemoryPlugin({
        store,
        readScopes: [projectScope, botScope],
        writeScope: botScope,
        writeMode: "propose_only",
        proposedBy: "Worker tsk_abc",
      });
      const workerModel = createMockModel((input, callIdx) => {
        if (callIdx === 0) {
          seenWorkerTools.push(...(input.tools ?? []).map(t => t.name));
          return {
            toolCalls: [{
              id: "w1",
              name: "memory_propose",
              arguments: {
                slug: "worker-finding",
                name: "Worker Finding",
                description: "Important repo pitfall",
                type: "project",
                body: "Avoid recursive exclude on node_modules in pwsh.",
              },
            }],
          };
        }
        return { text: "Proposed." };
      });

      const workerAgent = await createAgent({
        model: workerModel,
        instructions: "Worker agent",
        plugins: [workerHandle.plugin],
      });
      await workerAgent.prompt("Investigate");
      await workerAgent.close();

      expect(seenWorkerTools).toContain("memory_read");
      expect(seenWorkerTools).toContain("memory_search");
      expect(seenWorkerTools).toContain("memory_propose");
      expect(seenWorkerTools).not.toContain("memory_write");
      // Active topics remain untouched; proposal lands in pending/ only.
      expect(await store.readTopic(botScope, "worker-finding")).toBeUndefined();
      const proposals = await store.listProposals(botScope);
      expect(proposals.length).toBe(1);
      expect(proposals[0]?.proposedBy).toBe("Worker tsk_abc");
    } finally {
      coordinator.close();
    }
  });

  test("Stage 1 extraction & Stage 2 Auto-Dream consolidate rollouts while preserving user-locked topics", async () => {
    const dir = await makeTempDir();
    const coordinator = createSqliteMemoryStore(join(dir, "memory.db"));
    const store = createFsMemoryStore(join(dir, "memory"), { coordinator });
    const projectScope: MemoryScope = { type: "project", id: "alpha" };

    try {
      await store.writeTopic(projectScope, {
        slug: "user-sacred",
        name: "User Sacred Rule",
        description: "Must never be overwritten by Dream",
        type: "feedback",
        owner: "user",
        body: "Original user content.",
      }, { actor: "user" });

      // Skip when main agent already wrote in this run
      const skipped = await runStage1Extraction({
        store,
        coordinator,
        scope: projectScope,
        sessionKey: "alpha:s0",
        sessionId: "s0",
        sessionRevision: 1,
        messages: [{ id: "m1", role: "user", content: "Remember to use bun instead of npm in this repo." }],
        leaseOwner: "worker-a",
        alreadyWroteInRun: true,
        runModel: async () => { throw new Error("should not call model"); },
        signal: new AbortController().signal,
      });
      expect(skipped.status).toBe("skipped");
      expect(skipped.reason).toBe("main_agent_already_wrote");

      // Normal Stage 1 extraction with secret scrubbing
      let receivedPrompt = "";
      const extracted = await runStage1Extraction({
        store,
        coordinator,
        scope: projectScope,
        sessionKey: "alpha:s1",
        sessionId: "s1",
        sessionRevision: 3,
        messages: [
          { id: "m1", role: "user", content: "Never commit .env with OPENAI_API_KEY=sk-proj-1234567890abcdef1234567890; always run bun run i18n:check before release." },
        ],
        leaseOwner: "worker-a",
        runModel: async prompt => {
          receivedPrompt = prompt;
          return JSON.stringify({
            skip: false,
            slug: "release-i18n-check",
            title: "Release i18n check requirement",
            takeaways: [
              { type: "feedback", summary: "Always run bun run i18n:check before release", detail: "Prevents missing locale keys." },
            ],
          });
        },
        signal: new AbortController().signal,
        nowIso: "2026-11-27T12:00:00.000Z",
      });
      expect(extracted.status).toBe("extracted");
      expect(receivedPrompt).not.toContain("sk-proj-");

      // Re-running with same revision is idempotent
      const dup = await runStage1Extraction({
        store,
        coordinator,
        scope: projectScope,
        sessionKey: "alpha:s1",
        sessionId: "s1",
        sessionRevision: 3,
        messages: [{ id: "m1", role: "user", content: "same" }],
        leaseOwner: "worker-a",
        runModel: async () => { throw new Error("should not re-run"); },
        signal: new AbortController().signal,
      });
      expect(dup.status).toBe("skipped");
      expect(dup.reason).toBe("already_extracted");

      // Stage 2 Dream respects rollout gate unless forced
      const gated = await runStage2Dream({
        store,
        coordinator,
        scope: projectScope,
        leaseOwner: "worker-a",
        minNewRollouts: 5,
        runModel: async () => { throw new Error("should be gated"); },
        signal: new AbortController().signal,
      });
      expect(gated.status).toBe("skipped");
      expect(gated.reason).toBe("below_rollout_threshold");

      // Force Dream: model maliciously tries to overwrite AND delete user-sacred topic; engine must block both!
      const dream = await runStage2Dream({
        store,
        coordinator,
        scope: projectScope,
        leaseOwner: "worker-a",
        force: true,
        runModel: async () => JSON.stringify({
          upserts: [
            {
              slug: "user-sacred",
              name: "Hijacked",
              description: "bad",
              type: "feedback",
              body: "Hijacked body",
            },
            {
              slug: "release-checklist",
              name: "Release Checklist",
              description: "Run bun run i18n:check before every release",
              type: "feedback",
              body: "Always execute bun run i18n:check before release.",
            },
          ],
          deletes: ["user-sacred"],
        }),
        signal: new AbortController().signal,
        nowIso: "2026-11-27T18:00:00.000Z",
      });

      expect(dream.status).toBe("completed");
      expect(dream.consumedRollouts).toBe(1);
      expect(dream.upsertedTopics).toEqual(["release-checklist"]);
      expect(dream.skippedLockedTopics).toContain("user-sacred");
      expect(dream.snapshotId).toBeDefined();

      // Verify user-locked topic is untouched and new topic + MEMORY.md are persisted.
      const sacred = await store.readTopic(projectScope, "user-sacred");
      expect(sacred?.body).toBe("Original user content.");
      const idx = await store.readIndex(projectScope);
      expect(idx).toContain("Release Checklist");
      expect(idx).toContain("User Sacred Rule");
      expect(coordinator.listPendingStage1("project:alpha").length).toBe(0);
    } finally {
      coordinator.close();
    }
  });

  test("buildIndexMarkdown puts user-owned entries ahead of agent entries", () => {
    const md = buildIndexMarkdown(
      { type: "user", id: "default" },
      [
        { scope: { type: "user", id: "default" }, slug: "a", path: "topics/a.md", name: "Agent Note", description: "a", type: "feedback", owner: "agent", updatedAt: "2026-11-27" },
        { scope: { type: "user", id: "default" }, slug: "u", path: "topics/u.md", name: "User Lock", description: "u", type: "feedback", owner: "user", updatedAt: "2026-11-01" },
      ],
    );
    expect(md.indexOf("User Lock")).toBeLessThan(md.indexOf("Agent Note"));
  });

  test("memory_history_search invokes historySearcher, scrubs secrets, and is omitted when unconfigured", async () => {
    const dir = await makeTempDir();
    const coordinator = createSqliteMemoryStore(join(dir, "memory.db"));
    const store = createFsMemoryStore(join(dir, "memory"), { coordinator });
    const projectScope: MemoryScope = { type: "project", id: "alpha" };

    try {
      const queries: { query: string; limit: number }[] = [];
      let toolResultJson = "";
      const handle = createMemoryPlugin({
        store,
        readScopes: [projectScope],
        writeScope: projectScope,
        writeMode: "direct",
        historySearcher: async (query, opts) => {
          queries.push({ query, limit: opts.limit });
          return [
            {
              sessionId: "sess-past-1",
              title: "Past release run",
              role: "user",
              messageId: "m-42",
              snippet: `We decided to pin Bun 1.4.4 (never expose OPENAI_API_KEY=sk-proj-1234567890abcdef1234567890). ${"x".repeat(500)}`,
              updatedAt: "2026-11-26T10:00:00.000Z",
            },
          ];
        },
      });

      const model = createMockModel((input, callIdx) => {
        if (callIdx === 0) {
          expect((input.tools ?? []).map(t => t.name)).toContain("memory_history_search");
          return {
            toolCalls: [{
              id: "h1",
              name: "memory_history_search",
              arguments: { query: "Bun 1.4.4", limit: 3 },
            }],
          };
        }
        const toolMsg = input.messages.find(m => m.role === "tool");
        if (toolMsg && toolMsg.role === "tool") toolResultJson = toolMsg.content;
        return { text: "Found past decision." };
      });

      const agent = await createAgent({ model, instructions: "Test", plugins: [handle.plugin] });
      await agent.prompt("What did we decide about Bun?");
      await agent.close();

      expect(queries).toEqual([{ query: "Bun 1.4.4", limit: 3 }]);
      const parsed = JSON.parse(toolResultJson) as { ok: boolean; hits: { sessionId: string; snippet: string }[] };
      expect(parsed.ok).toBe(true);
      expect(parsed.hits).toHaveLength(1);
      expect(parsed.hits[0]?.sessionId).toBe("sess-past-1");
      expect(parsed.hits[0]?.snippet).not.toContain("sk-proj-");
      expect(parsed.hits[0]?.snippet).toContain("[REDACTED]");
      expect((parsed.hits[0]?.snippet.length ?? 0)).toBeLessThanOrEqual(400);

      // Without historySearcher, the tool must not be registered.
      const seenWithout: string[] = [];
      const plainHandle = createMemoryPlugin({
        store,
        readScopes: [projectScope],
        writeMode: "readonly",
      });
      const plainModel = createMockModel(input => {
        seenWithout.push(...(input.tools ?? []).map(t => t.name));
        return { text: "ok" };
      });
      const plainAgent = await createAgent({ model: plainModel, instructions: "Test", plugins: [plainHandle.plugin] });
      await plainAgent.prompt("hi");
      await plainAgent.close();
      expect(seenWithout).not.toContain("memory_history_search");
    } finally {
      coordinator.close();
    }
  });
});
