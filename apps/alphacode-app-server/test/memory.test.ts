import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteSessionStore } from "@alpha/adk-session/sqlite";
import type { LanguageModel } from "@alpha/provider";
import { parseGlobalConfig, updateMemorySettings } from "../src/global-config";
import { createSessionHistorySearcher } from "../src/memory/history-search";
import { createMemoryService } from "../src/memory/service";
import { createRuntime, sessionNamespace } from "../src/runtime/create-runtime";
import { startServer } from "../src/server/server";
import { textResponse, type RequestBody } from "./helpers";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "alphacode-memory-srv-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("Memory global config and server toggle", () => {
  test("parses and atomically updates memory.enabled in config.yaml (default false)", async () => {
    const dir = await makeTempDir();
    expect(parseGlobalConfig("", "config.yaml").memory).toBeUndefined();

    const enabled = await updateMemorySettings(dir, { enabled: true });
    expect(enabled.enabled).toBe(true);
    expect(enabled.autoExtract).toBe(true);
    expect(enabled.autoDream).toBe(true);

    const raw = await readFile(join(dir, "config.yaml"), "utf8");
    const parsed = parseGlobalConfig(raw, "config.yaml");
    expect(parsed.memory?.enabled).toBe(true);

    const disabled = await updateMemorySettings(dir, { enabled: false, autoDream: false });
    expect(disabled.enabled).toBe(false);
    expect(disabled.autoDream).toBe(false);
  });

  test("exposes GET/PATCH /api/settings/memory and Bot memoryMode toggle", async () => {
    const dir = await makeTempDir();
    const projectDir = await makeTempDir();
    const server = await startServer({
      databasePath: join(dir, "sessions.db"),
      directory: join(dir, "server"),
      botsConfigDirectory: dir,
      token: "test-token",
    });

    try {
      const auth = { Authorization: "Bearer test-token", "Content-Type": "application/json" };

      // Defaults to disabled (opt-in)
      const get1 = await fetch(`${server.origin}/api/settings/memory`, { headers: auth });
      expect(get1.status).toBe(200);
      const body1 = await get1.json() as { enabled: boolean; memoryDir: string };
      expect(body1.enabled).toBe(false);
      expect(body1.memoryDir).toBe(join(dir, "memory"));

      // Toggle on
      const patch1 = await fetch(`${server.origin}/api/settings/memory`, {
        method: "PATCH",
        headers: auth,
        body: JSON.stringify({ enabled: true }),
      });
      expect(patch1.status).toBe(200);
      expect((await patch1.json() as { enabled: boolean }).enabled).toBe(true);

      // Verify persisted on subsequent GET
      const get2 = await fetch(`${server.origin}/api/settings/memory`, { headers: auth });
      expect((await get2.json() as { enabled: boolean }).enabled).toBe(true);

      // Invalid payload rejected
      const bad = await fetch(`${server.origin}/api/settings/memory`, {
        method: "PATCH",
        headers: auth,
        body: JSON.stringify({ enabled: "yes" }),
      });
      expect(bad.status).toBe(400);

      // Register project & create Bot with memoryMode = "off", then toggle to "alphacode"
      const connect = await fetch(`${server.origin}/api/connect`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          config: {
            workspaceRoot: projectDir,
            databasePath: join(dir, "sessions.db"),
            modelId: "mock-model",
            baseURL: "http://127.0.0.1:9999/v1",
            apiKeyEnv: "OPENAI_API_KEY",
            noAuth: true,
          },
        }),
      });
      expect(connect.status).toBe(200);
      const sessionView = await connect.json() as { session: { projectId: string } };
      const projectId = sessionView.session.projectId;

      const createdRes = await fetch(`${server.origin}/api/bots`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ name: "Mem Bot", projectId, memoryMode: "off" }),
      });
      expect(createdRes.status).toBe(201);
      const { bot: created } = await createdRes.json() as { bot: { id: string; memoryMode: string } };
      expect(created.memoryMode).toBe("off");

      const updatedRes = await fetch(`${server.origin}/api/bots/${created.id}`, {
        method: "PATCH",
        headers: auth,
        body: JSON.stringify({ memoryMode: "alphacode" }),
      });
      expect(updatedRes.status).toBe(200);
      expect((await updatedRes.json() as { bot: { memoryMode: string } }).bot.memoryMode).toBe("alphacode");
    } finally {
      await server.close();
    }
  });

  test("MemoryService writes user-locked topic via rememberExplicit", async () => {
    const dir = await makeTempDir();
    const svc = createMemoryService({
      instanceId: "inst-1",
      databasePath: join(dir, "sessions.db"),
      configDirectory: dir,
    });
    try {
      expect(await svc.isEnabled()).toBe(false);
      await svc.updateSettings({ enabled: true });
      expect(await svc.isEnabled()).toBe(true);

      const saved = await svc.rememberExplicit({ type: "project", id: "alpha" }, "Always use bun:test offline fixtures.");
      expect(saved.owner).toBe("user");
      const index = await svc.store.readIndex({ type: "project", id: "alpha" });
      expect(index).toContain("Always use bun:test offline fixtures");
    } finally {
      await svc.close();
    }
  });

  test("createRuntime gates memory on global enabled switch and supports /remember + /memory", async () => {
    const dir = await makeTempDir();
    const projectDir = await makeTempDir();
    const svc = createMemoryService({
      instanceId: "inst-rt",
      databasePath: join(dir, "sessions.db"),
      configDirectory: dir,
    });
    const baseConfig = {
      workspaceRoot: projectDir,
      databasePath: join(dir, "sessions.db"),
      configDirectory: dir,
      modelId: "mock-model",
      baseURL: "http://127.0.0.1:1/v1",
      apiKeyEnv: "OPENAI_API_KEY",
      noAuth: true,
    };

    try {
      // Disabled by default -> /remember explains how to enable
      const rt1 = await createRuntime(baseConfig, { memory: { service: svc } });
      try {
        const resOff = await rt1.send("/remember Never auto push");
        expect(resOff.localText).toContain("disabled");
      } finally {
        await rt1.close();
      }

      // Enable switch -> /remember persists user-locked topic and /memory reports count
      await svc.updateSettings({ enabled: true });
      const rt2 = await createRuntime(baseConfig, { memory: { service: svc } });
      try {
        const resOn = await rt2.send("/remember Never auto push without asking");
        expect(resOn.localText).toContain("Remembered (project)");
        const status = await rt2.send("/memory");
        expect(status.localText).toContain("Memory: enabled");
        expect(status.localText).toContain("1 project");
      } finally {
        await rt2.close();
      }
    } finally {
      await svc.close();
    }
  });

  test("MemoryService honors dedicated memory.model and memory.provider for background Stage 1", async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, "config.yaml"), [
      "memory:",
      "  enabled: true",
      "  autoExtract: true",
      "  autoDream: false",
      "  model:",
      "    id: gpt-4o-mini-mem",
      "    maxOutputTokens: 512",
      "  provider:",
      "    adapter: openai-completions",
      "    options:",
      "      baseURL: https://memory-only.invalid/v1",
      "      apiKey:",
      "        none: true",
      "",
    ].join("\n"), "utf8");

    const parsed = parseGlobalConfig(await readFile(join(dir, "config.yaml"), "utf8"), "config.yaml");
    expect(parsed.memory?.model?.modelId).toBe("gpt-4o-mini-mem");
    expect(parsed.memory?.model?.baseURL).toBe("https://memory-only.invalid/v1");
    expect(parsed.memory?.model?.noAuth).toBe(true);
    expect(parsed.memory?.model?.maxOutputTokens).toBe(512);

    const svc = createMemoryService({
      instanceId: "inst-model",
      databasePath: join(dir, "sessions.db"),
      configDirectory: dir,
    });

    const fallbackModel: LanguageModel = {
      provider: "fallback",
      modelId: "expensive-main-model",
      async generate() { throw new Error("Fallback model should not be used when memory.model is configured"); },
      stream() {
        return {
          [Symbol.asyncIterator]() {
            return {
              async next(): Promise<IteratorResult<never>> {
                throw new Error("Fallback model should not be used when memory.model is configured");
              },
            };
          },
        };
      },
    };

    const seenRequests: { url: string; model: string; maxTokens?: number }[] = [];
    try {
      svc.scheduleStage1({
        scope: { type: "project", id: "alpha" },
        sessionKey: "alpha:s1",
        sessionId: "s1",
        sessionRevision: 1,
        messages: [
          { id: "u1", role: "user", content: "Always verify i18n keys via bun run i18n:check before merging." },
        ],
        alreadyWroteInRun: false,
        model: fallbackModel,
        connection: {
          baseURL: "https://main-endpoint.invalid/v1",
          noAuth: true,
          providerOptions: {
            fetch: async (url, init) => {
              const body = JSON.parse(String(init?.body)) as RequestBody & { max_tokens?: number; max_completion_tokens?: number };
              seenRequests.push({
                url: String(url),
                model: body.model,
                maxTokens: body.max_tokens ?? body.max_completion_tokens,
              });
              return textResponse(JSON.stringify({
                skip: false,
                slug: "i18n-gate",
                title: "i18n check before merge",
                takeaways: [{ type: "feedback", summary: "Run bun run i18n:check before merging" }],
              }));
            },
          },
        },
      });

      await svc.whenIdle();
      expect(seenRequests).toHaveLength(1);
      expect(seenRequests[0]?.url).toContain("https://memory-only.invalid/v1");
      expect(seenRequests[0]?.model).toBe("gpt-4o-mini-mem");
      expect(seenRequests[0]?.maxTokens).toBeLessThanOrEqual(512);

      const rollouts = await svc.store.listRollouts({ type: "project", id: "alpha" });
      expect(rollouts).toHaveLength(1);
      expect(rollouts[0]?.slug).toContain("i18n-gate");
    } finally {
      await svc.close();
    }
  });

  test("createSessionHistorySearcher scopes results by namespace, supports CJK, and scrubs secrets", async () => {
    const dir = await makeTempDir();
    const store = await createSqliteSessionStore({ filename: join(dir, "sessions.db") });

    try {
      const saveSession = async (namespace: string, id: string, title: string, userText: string, updatedAt: string) => {
        const inputHash = "a".repeat(64);
        const base = {
          formatVersion: 1 as const,
          id,
          agentKey: "alphacode-v2:test",
          title,
          metadata: {},
          createdAt: updatedAt,
          updatedAt,
          pending: null,
          turns: [],
        };
        const created = await store.create({ namespace, id }, base);
        const admitted = await store.compareAndSet({ namespace, id }, created.revision, {
          ...base,
          pending: { requestId: `req-${id}`, inputHash, token: `tok-${id}`, startedAt: updatedAt },
        });
        expect(admitted.applied).toBe(true);
        const nextRev = admitted.applied ? admitted.revision : 0;
        const committed = await store.compareAndSet({ namespace, id }, nextRev, {
          ...base,
          turns: [{
            requestId: `req-${id}`,
            inputHash,
            run: { runId: `run-${id}`, status: "completed", text: "Understood." },
            messages: [
              { id: `u-${id}`, role: "user", content: userText },
              { id: `a-${id}`, role: "assistant", outcome: "completed", text: "Understood.", toolCalls: [], finishReason: "stop" },
            ],
            historyStatus: "ready",
            committedAt: updatedAt,
            committedRevision: nextRev + 1,
          }],
        });
        expect(committed.applied).toBe(true);
      };

      await saveSession(
        "project-a",
        "sess-a1",
        "灰度发布讨论",
        "灰度发布策略要求先放量 10% 并观察错误率，绝不能硬编码 OPENAI_API_KEY=sk-proj-1234567890abcdef1234567890。",
        "2026-11-26T10:00:00.000Z",
      );
      await saveSession(
        "project-b",
        "sess-b1",
        "Other project",
        "灰度发布策略 in project B must stay isolated from project A.",
        "2026-11-27T10:00:00.000Z",
      );

      const searcher = createSessionHistorySearcher({ store, namespaces: ["project-a"] });
      const hits = await searcher("灰度发布策略", { limit: 5, signal: new AbortController().signal });
      expect(hits).toHaveLength(1);
      expect(hits[0]?.sessionId).toBe("sess-a1");
      expect(hits[0]?.snippet).toContain("灰度发布策略");
      expect(hits[0]?.snippet).not.toContain("sk-proj-");
      expect(hits[0]?.snippet).toContain("[REDACTED]");
    } finally {
      await store.close();
    }
  });

  test("pre-compaction flush triggers Stage 1 extraction on /compact via onBeforeCompact", async () => {
    const dir = await makeTempDir();
    const projectDir = await makeTempDir();
    await writeFile(join(dir, "config.yaml"), [
      "memory:",
      "  enabled: true",
      "  autoExtract: true",
      "  autoDream: false",
      "  model:",
      "    id: light-extractor",
      "",
    ].join("\n"), "utf8");

    const svc = createMemoryService({
      instanceId: "inst-compact",
      databasePath: join(dir, "sessions.db"),
      configDirectory: dir,
    });

    const extractorModels: string[] = [];
    const summaryJson = JSON.stringify({
      objective: ["Track pre-compaction workflow"],
      constraints: ["Always run bun:test offline"],
      decisions: [],
      completed: [],
      inProgress: [],
      failures: [],
      validation: [],
      nextSteps: [],
      evidence: [],
    });

    const rt = await createRuntime({
      workspaceRoot: projectDir,
      databasePath: join(dir, "sessions.db"),
      configDirectory: dir,
      modelId: "main-chat-model",
      contextWindow: 32000,
      maxOutputTokens: 1024,
      baseURL: "https://offline.invalid/v1",
      apiKeyEnv: "OPENAI_API_KEY",
      noAuth: true,
    }, {
      memory: { service: svc },
      provider: {
        fetch: async (_url, init) => {
          const body = JSON.parse(String(init?.body)) as RequestBody;
          if (body.model === "light-extractor") {
            extractorModels.push(body.model);
            return textResponse(JSON.stringify({
              skip: false,
              slug: "compact-preserved-rule",
              title: "Pre-compaction preserved rule",
              takeaways: [{ type: "feedback", summary: "Always run bun:test offline before release" }],
            }));
          }
          if (!body.stream) {
            const firstContent = body.messages[0]?.content ?? "";
            if (firstContent.includes("Summarize the session work state")) {
              return Response.json({ choices: [{ message: { content: summaryJson }, finish_reason: "stop" }] });
            }
            return Response.json({ choices: [{ message: { content: "Compaction test" }, finish_reason: "stop" }] });
          }
          return textResponse("Acknowledged your rule.");
        },
      },
    });

    try {
      // Turn 1 (large enough that /compact strictly shrinks context) and Turn 2 so lastEnd > 0.
      const res1 = await rt.send(`Always run bun:test offline before release. ${"Detailed engineering context note. ".repeat(80)}`);
      expect(res1.status).toBe("completed");
      await svc.whenIdle();

      const res2 = await rt.send("Second short turn.");
      expect(res2.status).toBe("completed");
      await svc.whenIdle();

      const beforeCompactPending = svc.coordinator.listPendingStage1(`project:${sessionNamespace(rt.workspaceRoot)}`);
      const compactRes = await rt.send("/compact");
      expect(compactRes.status).toBe("completed");
      expect(compactRes.localResult?.kind).toBe("compact");
      await svc.whenIdle();

      const afterCompactPending = svc.coordinator.listPendingStage1(`project:${sessionNamespace(rt.workspaceRoot)}`);
      const compactOutput = afterCompactPending.find(item => item.sessionKey.includes(":compact:"));
      expect(compactOutput).toBeDefined();
      expect(afterCompactPending.length).toBeGreaterThan(beforeCompactPending.length);
      expect(extractorModels).toContain("light-extractor");
    } finally {
      await rt.close();
      await svc.close();
    }
  });
});
