import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { AppConfig } from "../src/config";
import type {
  BotDeleteResult,
  BotDetailStateView,
  BotMessageReceipt,
  BotSummaryView,
  BotTaskApplyResult,
  BotTaskDiffView,
  BotsGlobalConfigView,
  BotsIndexSnapshot,
} from "../src/bots/contracts";
import { createBotManager } from "../src/bots/manager";
import type { BotWorkerSessionSnapshot } from "../src/bots/worker-pool";
import { runGit } from "../src/bots/worktree-manager";
import { createClient } from "../src/server/transport";
import { startServer } from "../src/server/server";
import { createRegistry, serverPaths } from "../src/server/storage";
import { controlledStream, textResponse, toolResponse, waitFor, type RequestBody } from "./helpers";

const gitEnv = {
  GIT_AUTHOR_NAME: "Test User",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test User",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

async function initGitRepo(dir: string, fileName = "app.ts", content = "export const version = 1;\n") {
  await mkdir(dir, { recursive: true });
  expect((await runGit(dir, ["init"])).exitCode).toBe(0);
  await writeFile(join(dir, fileName), content);
  expect((await runGit(dir, ["add", "."])).exitCode).toBe(0);
  expect((await runGit(dir, ["commit", "-m", "init"], { env: gitEnv })).exitCode).toBe(0);
}

async function botsFixture(
  onModel: (role: "router" | "worker", botId: string, body: RequestBody, count: number) => Response,
  options: { permissionMode?: "ask" | "auto" | "full" } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "alphacode-bots-test-"));
  const repoA = join(root, "repo-alpha");
  const repoB = join(root, "repo-beta");
  const configDir = join(root, "config");
  await initGitRepo(repoA, "app.ts", "export const version = 1;\n");
  await initGitRepo(repoB, "auth.ts", "export const mode = 'v1';\n");
  await mkdir(configDir, { recursive: true });
  const paths = await serverPaths(join(root, "sessions.db"));

  const routerCalls: { botId: string; body: RequestBody }[] = [];
  const workerCalls: { botId: string; body: RequestBody }[] = [];

  const serverOptions = {
    databasePath: paths.database,
    directory: paths.directory,
    idleMs: 60000,
    botsConfigDirectory: configDir,
    botsProvider: (role: "router" | "worker", _config: AppConfig, botId: string) => ({
      fetch: async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as RequestBody;
        if (!body.stream) {
          return Response.json({ choices: [{ message: { content: "Task title" }, finish_reason: "stop" }] });
        }
        if (role === "router") {
          routerCalls.push({ botId, body });
          const botCount = routerCalls.filter(c => c.botId === botId).length;
          return onModel("router", botId, body, botCount);
        }
        workerCalls.push({ botId, body });
        const botCount = workerCalls.filter(c => c.botId === botId).length;
        return onModel("worker", botId, body, botCount);
      },
    }),
  };

  let server = await startServer(serverOptions);
  const client = () => createClient(server);

  const mkConfig = (workspaceRoot: string, projectName: string): AppConfig => ({
    workspaceRoot,
    projectName,
    databasePath: paths.database,
    configDirectory: configDir,
    modelId: "global-default-model",
    baseURL: "https://offline.invalid/v1",
    apiKeyEnv: "UNUSED",
    noAuth: true,
    permissionMode: options.permissionMode ?? "full",
    skills: { sharedDirectories: false, claudeDirectories: false, trustedProjects: [], disabledNames: [] },
  });

  const connA = await client().request<{ session: { projectId: string } }>("/api/connect", { config: mkConfig(repoA, "repo-alpha") });
  const connB = await client().request<{ session: { projectId: string } }>("/api/connect", { config: mkConfig(repoB, "repo-beta") });

  async function reqRaw(method: string, path: string, body?: unknown) {
    return fetch(`${server.origin}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${server.token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  return {
    root,
    repoA,
    repoB,
    configDir,
    projectA: connA.session.projectId,
    projectB: connB.session.projectId,
    routerCalls,
    workerCalls,
    client,
    reqRaw,
    async patch<T>(path: string, body: unknown): Promise<T> {
      const res = await reqRaw("PATCH", path, body);
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      return await res.json() as T;
    },
    async del<T>(path: string): Promise<{ status: number; data: T }> {
      const res = await reqRaw("DELETE", path);
      return { status: res.status, data: await res.json() as T };
    },
    get server() { return server; },
    async restart() {
      await server.close();
      server = await startServer(serverOptions);
    },
    async dispose() {
      await server.close();
      if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("alphacode-bots-test-")) {
        throw new Error("Unsafe fixture cleanup");
      }
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

test("multi-bot lifecycle, 3-tier model inheritance, hot-swap without losing permanent chat, single-project rebinding & project_missing guard", async () => {
  const prevAdk = process.env.ADK_MODEL;
  const prevRouter = process.env.ALPHACODE_BOTS_ROUTER_MODEL;
  const prevWorker = process.env.ALPHACODE_BOTS_WORKER_MODEL;
  delete process.env.ADK_MODEL;
  delete process.env.ALPHACODE_BOTS_ROUTER_MODEL;
  delete process.env.ALPHACODE_BOTS_WORKER_MODEL;

  const fixture = await botsFixture((role, _botId, _body, count) => {
    if (role === "router") return textResponse(`bot reply #${count}`);
    return textResponse("worker ok");
  });

  try {
    // 1. Create two independent bots bound to projectA and projectB
    const createdA = await fixture.client().request<{ bot: BotSummaryView }>("/api/bots", {
      name: "Alpha Core",
      instructions: "Own alpha backend.",
      projectId: fixture.projectA,
      appearance: { shape: "orbit", color: "blue" },
    });
    const createdB = await fixture.client().request<{ bot: BotSummaryView }>("/api/bots", {
      name: "Beta Security",
      instructions: "Audit repo-beta.",
      projectId: fixture.projectB,
      routerModel: { modelId: "bot-b-router" },
      workerModel: { modelId: "bot-b-worker" },
    });
    const botA = createdA.bot;
    const botB = createdB.bot;
    expect(botA.projectId).toBe(fixture.projectA);
    expect(botA.effectiveRouterModel?.modelId).toBe("global-default-model");
    expect(botA.effectiveRouterModel?.source).toBe("inherited");
    expect(botB.effectiveRouterModel?.modelId).toBe("bot-b-router");
    expect(botB.effectiveRouterModel?.source).toBe("bot");
    expect(botB.effectiveWorkerModel?.modelId).toBe("bot-b-worker");

    // 2. Reorder bots and verify persistence
    const reordered = await fixture.patch<BotsIndexSnapshot>("/api/bots/order", { botIds: [botB.id, botA.id] });
    expect(reordered.bots.map(b => b.id)).toEqual([botB.id, botA.id]);

    // 3. Global bots defaults apply to inherited bots (botA) without overriding bot-level models (botB)
    const defaults = await fixture.patch<{ defaults: BotsGlobalConfigView }>("/api/bots/defaults", {
      maxConcurrentWorkers: 6,
      perBotMaxWorkers: 2,
      router: { modelId: "global-bots-router" },
      worker: { modelId: "global-bots-worker" },
    });
    expect(defaults.defaults.maxConcurrentWorkers).toBe(6);
    expect(defaults.defaults.router?.modelId).toBe("global-bots-router");

    const stateA1 = await fixture.client().request<BotDetailStateView>(`/api/bots/${botA.id}/state`);
    expect(stateA1.bot.effectiveRouterModel?.modelId).toBe("global-bots-router");
    expect(stateA1.bot.effectiveRouterModel?.source).toBe("global_bots");

    // 4. Send message to botA (idempotent), then switch botA router model & rebind project while idle -> continuous history kept!
    const r1 = await fixture.client().request<BotMessageReceipt>(`/api/bots/${botA.id}/messages`, {
      requestId: "req-1",
      input: "Remember alpha architecture",
    });
    expect(r1.status).toBe("accepted");
    const r1Dup = await fixture.client().request<BotMessageReceipt>(`/api/bots/${botA.id}/messages`, {
      requestId: "req-1",
      input: "Remember alpha architecture",
    });
    expect(r1Dup.status).toBe("duplicate");
    expect(r1Dup.triggerId).toBe(r1.triggerId);

    await waitFor(async () => {
      const s = await fixture.client().request<BotDetailStateView>(`/api/bots/${botA.id}/state`);
      return !s.router.busy && s.router.messages.some(m => m.text.includes("bot reply #1"));
    });
    expect(fixture.routerCalls.find(c => c.botId === botA.id)?.body.model).toBe("global-bots-router");

    // Switch botA to custom model + rebind to projectB while idle
    const updatedA = await fixture.patch<{ bot: BotSummaryView }>(`/api/bots/${botA.id}`, {
      projectId: fixture.projectB,
      routerModel: { modelId: "bot-a-custom-router" },
    });
    expect(updatedA.bot.projectId).toBe(fixture.projectB);
    expect(updatedA.bot.effectiveRouterModel?.modelId).toBe("bot-a-custom-router");

    await fixture.client().request<BotMessageReceipt>(`/api/bots/${botA.id}/messages`, {
      requestId: "req-2",
      input: "Continue after rebind and model change",
    });
    await waitFor(async () => {
      const s = await fixture.client().request<BotDetailStateView>(`/api/bots/${botA.id}/state`);
      return !s.router.busy && s.router.messages.some(m => m.text.includes("bot reply #2"));
    });
    const botACalls = fixture.routerCalls.filter(c => c.botId === botA.id);
    expect(botACalls[1]?.body.model).toBe("bot-a-custom-router");
    expect(JSON.stringify(botACalls[1]?.body.messages)).toContain("Remember alpha architecture");

    // 5. Unregistering projectB puts bots bound to projectB into project_missing protection state
    const delProj = await fixture.del(`/api/projects/${encodeURIComponent(fixture.projectB)}`);
    expect(delProj.status).toBe(200);

    const missingState = await fixture.client().request<BotDetailStateView>(`/api/bots/${botB.id}/state`);
    expect(missingState.bot.projectMissing).toBe(true);
    expect(missingState.bot.status).toBe("attention_error");
    expect(missingState.bot.statusDetail).toBe("project_missing");

    const blockedRes = await fixture.reqRaw("POST", `/api/bots/${botB.id}/messages`, {
      requestId: "blocked-1",
      input: "Should fail because project is gone",
    });
    expect(blockedRes.status).toBe(409);
    const blockedJson = await blockedRes.json() as { code: string };
    expect(blockedJson.code).toBe("BOT_PROJECT_UNAVAILABLE");

    // Archive and unarchive botB
    const archived = await fixture.client().request<{ bot: BotSummaryView }>(`/api/bots/${botB.id}/archive`, { archived: true });
    expect(archived.bot.archivedAt).toBeTruthy();
    const activeOnly = await fixture.client().request<BotsIndexSnapshot>("/api/bots");
    expect(activeOnly.bots.some(b => b.id === botB.id)).toBe(false);
    const withArchived = await fixture.client().request<BotsIndexSnapshot>("/api/bots?includeArchived=1");
    expect(withArchived.bots.some(b => b.id === botB.id)).toBe(true);
  } finally {
    if (prevAdk === undefined) delete process.env.ADK_MODEL; else process.env.ADK_MODEL = prevAdk;
    if (prevRouter === undefined) delete process.env.ALPHACODE_BOTS_ROUTER_MODEL; else process.env.ALPHACODE_BOTS_ROUTER_MODEL = prevRouter;
    if (prevWorker === undefined) delete process.env.ALPHACODE_BOTS_WORKER_MODEL; else process.env.ALPHACODE_BOTS_WORKER_MODEL = prevWorker;
    await fixture.dispose();
  }
});

test("bot super-agent full-duplex dispatch locks to bound project, uses git worktree, guards delete on unmerged worktree, and merges safely", async () => {
  let dispatchedTaskId = "";
  const fixture = await botsFixture((role, _botId, body, count) => {
    if (role === "router") {
      const toolNames = (body.tools ?? []).map(t => t.function.name);
      expect(toolNames).toContain("dispatch_task");
      expect(toolNames).toContain("recall_object");
      expect(toolNames).not.toContain("run_command");
      expect(toolNames).not.toContain("edit_file");
      // dispatch_task must NOT expose projectId parameter (single-project binding enforced at tool schema level)
      const dispatchTool = (body.tools ?? []).find(t => t.function.name === "dispatch_task") as { function: { parameters?: { properties?: Record<string, unknown> } } } | undefined;
      const props = dispatchTool?.function.parameters?.properties ?? {};
      expect(props.projectId).toBeUndefined();

      if (count === 1) {
        return toolResponse("dispatch_task", {
          title: "Bump version",
          goal: "Update app.ts version to 2",
          accessMode: "write",
        });
      }
      if (count === 2) {
        const lastTool = JSON.parse(body.messages.at(-1)?.content ?? "{}") as { taskId?: string; status?: string };
        expect(lastTool.status).toBe("started");
        dispatchedTaskId = lastTool.taskId ?? "";
        return textResponse(`Started ${dispatchedTaskId} in a worktree.`);
      }
      if (count === 3) {
        return toolResponse("recall_object", { objectId: dispatchedTaskId });
      }
      if (count === 4) {
        const recalled = JSON.parse(body.messages.at(-1)?.content ?? "{}") as { ok?: boolean; diffArtifactRef?: string };
        expect(recalled.ok).toBe(true);
        expect(recalled.diffArtifactRef).toBeTruthy();
        return textResponse(`Worker completed with diff ${recalled.diffArtifactRef}.`);
      }
      return textResponse("ok");
    }

    if (count === 1) return toolResponse("read_file", { path: "app.ts" });
    if (count === 2) {
      return toolResponse("edit_file", {
        path: "app.ts",
        oldText: "export const version = 1;",
        newText: "export const version = 2;",
      });
    }
    return textResponse("Updated app.ts to version 2.");
  });

  try {
    const { bot } = await fixture.client().request<{ bot: BotSummaryView }>("/api/bots", {
      name: "Release Helper",
      instructions: "Manage version bumps.",
      projectId: fixture.projectA,
    });

    await fixture.client().request(`/api/bots/${bot.id}/messages`, {
      requestId: "duplex-1",
      input: "Update app.ts version to 2",
    });

    await waitFor(async () => {
      const state = await fixture.client().request<BotDetailStateView>(`/api/bots/${bot.id}/state`);
      return !state.router.busy
        && state.tasks.length === 1
        && state.tasks[0]?.status === "completed"
        && state.router.messages.some(m => m.text.includes("Worker completed with diff"));
    }, 15000);

    const state = await fixture.client().request<BotDetailStateView>(`/api/bots/${bot.id}/state`);
    const task = state.tasks[0];
    if (!task) throw new Error("Expected task");
    expect(task.botId).toBe(bot.id);
    expect(task.projectId).toBe(fixture.projectA);
    expect(task.isolationMode).toBe("git_worktree");
    expect(task.worktreeBranch).toBe(`alphacode/bot/${task.shortId}`);
    expect(task.worktreeState).toBe("ready_for_review");
    expect(state.bot.status).toBe("done");

    // Primary repo untouched before explicit merge
    expect(await readFile(join(fixture.repoA, "app.ts"), "utf8")).toBe("export const version = 1;\n");

    // Normal project session list is NOT polluted by bot router or workers
    const normalSessions = await fixture.client().request<{ sessions: { id: string }[] }>("/api/sessions");
    expect(normalSessions.sessions).toHaveLength(0);

    // Deleting bot with unmerged worktree is blocked with 409 UNMERGED_WORKTREES unless forced
    const guardedDel = await fixture.del<BotDeleteResult & { code?: string }>(`/api/bots/${bot.id}`);
    expect(guardedDel.status).toBe(409);
    expect(guardedDel.data.code).toBe("UNMERGED_WORKTREES");
    expect(guardedDel.data.unmergedWorktreeTaskIds).toEqual([task.id]);

    // Even after rebinding the bot to projectB while idle, the historical task still merges safely into original projectA!
    await fixture.patch<{ bot: BotSummaryView }>(`/api/bots/${bot.id}`, { projectId: fixture.projectB });

    const workerSession = await fixture.client().request<BotWorkerSessionSnapshot>(`/api/bots/${bot.id}/tasks/${task.id}/session`);
    expect(workerSession.sessionId).toBe(task.workerSessionId);
    expect(workerSession.messages.some(m => m.text.includes("Updated app.ts to version 2"))).toBe(true);

    const diff = await fixture.client().request<BotTaskDiffView>(`/api/bots/${bot.id}/tasks/${task.id}/diff`);
    expect(diff.hasChanges).toBe(true);
    expect(diff.files.map(f => f.path)).toEqual(["app.ts"]);

    const applied = await fixture.client().request<BotTaskApplyResult>(`/api/bots/${bot.id}/tasks/${task.id}/apply`, {
      strategy: "merge",
      cleanup: true,
    });
    expect(applied.applied).toBe(true);
    expect(applied.cleaned).toBe(true);
    expect((await readFile(join(fixture.repoA, "app.ts"), "utf8")).replace(/\r\n/g, "\n")).toBe("export const version = 2;\n");
    expect(await stat(task.worktreePath ?? "").catch(() => undefined)).toBeUndefined();

    // Now delete succeeds cleanly
    const finalDel = await fixture.del<BotDeleteResult>(`/api/bots/${bot.id}`);
    expect(finalDel.status).toBe(200);
    expect(finalDel.data.deleted).toBe(true);
  } finally {
    await fixture.dispose();
  }
});

test("bot approval aggregation, busy project-rebind rejection, and restart recovery preserve interrupted worktree", async () => {
  const secondWorkerStream = controlledStream();
  let workerTurn = 0;

  const fixture = await botsFixture((role, _botId, _body, count) => {
    if (role === "router") {
      if (count === 1) {
        return toolResponse("dispatch_task", {
          title: "Run command",
          goal: "Run echo hello",
          accessMode: "write",
        });
      }
      if (count === 2) return textResponse("Dispatched approval task.");
      if (count === 3) return textResponse("Approval task finished.");
      if (count === 4) {
        return toolResponse("dispatch_task", {
          title: "Long edit",
          goal: "Long edit task",
          accessMode: "write",
        });
      }
      return textResponse("Acknowledged.");
    }

    workerTurn++;
    if (workerTurn === 1) {
      return toolResponse("run_command", { command: "echo approved-ok", description: "Print greeting" });
    }
    if (workerTurn === 2) return textResponse("Command output verified.");
    if (workerTurn === 3) {
      secondWorkerStream.text("Working slowly...");
      return secondWorkerStream.response;
    }
    return textResponse("Steered done");
  }, { permissionMode: "ask" });

  try {
    const { bot } = await fixture.client().request<{ bot: BotSummaryView }>("/api/bots", {
      name: "Ops Bot",
      instructions: "Run commands with approval.",
      projectId: fixture.projectA,
      permissionMode: "ask",
    });

    await fixture.client().request(`/api/bots/${bot.id}/messages`, { requestId: "app-1", input: "Run echo" });
    await waitFor(async () => {
      const s = await fixture.client().request<BotDetailStateView>(`/api/bots/${bot.id}/state`);
      return s.approvals.length === 1;
    }, 15000);

    const pendingState = await fixture.client().request<BotDetailStateView>(`/api/bots/${bot.id}/state`);
    expect(pendingState.bot.status).toBe("approval");
    expect(pendingState.bot.pendingApprovalCount).toBe(1);
    const approval = pendingState.approvals[0];
    if (!approval) throw new Error("Expected approval");

    // Rebinding project while bot has active/awaiting worker must fail with 409 BOT_BUSY
    const busyRebind = await fixture.reqRaw("PATCH", `/api/bots/${bot.id}`, { projectId: fixture.projectB });
    expect(busyRebind.status).toBe(409);

    await fixture.client().request(`/api/bots/${bot.id}/approvals/${approval.approvalId}`, {
      taskId: approval.taskId,
      allow: true,
    });
    await expect(fixture.client().request(`/api/bots/${bot.id}/approvals/${approval.approvalId}`, {
      taskId: approval.taskId,
      allow: true,
    })).rejects.toThrow();

    await waitFor(async () => {
      const s = await fixture.client().request<BotDetailStateView>(`/api/bots/${bot.id}/state`);
      return !s.router.busy && s.tasks.find(t => t.id === approval.taskId)?.status === "completed";
    }, 15000);

    await fixture.client().request(`/api/bots/${bot.id}/messages`, { requestId: "long-1", input: "Start long edit" });
    await waitFor(async () => {
      const s = await fixture.client().request<BotDetailStateView>(`/api/bots/${bot.id}/state`);
      return s.tasks.length === 2 && s.tasks[0]?.status === "running";
    }, 15000);

    const runningTask = (await fixture.client().request<BotDetailStateView>(`/api/bots/${bot.id}/state`)).tasks[0];
    if (!runningTask) throw new Error("Expected running task");

    await fixture.restart();
    secondWorkerStream.end();

    const afterRestart = await fixture.client().request<BotDetailStateView>(`/api/bots/${bot.id}/state`);
    expect(afterRestart.router.messages.length).toBeGreaterThan(0);
    const recovered = afterRestart.tasks.find(t => t.id === runningTask.id);
    expect(recovered?.status).toBe("interrupted");
    expect((await stat(runningTask.worktreePath ?? "")).isDirectory()).toBe(true);
  } finally {
    await fixture.dispose();
  }
});

test("watchdog detects stale running tasks per-bot and fast-path routes subscribed thread events without waking router", async () => {
  const root = await mkdtemp(join(tmpdir(), "alphacode-bots-wd-"));
  const repoDir = join(root, "repo");
  const configDir = join(root, "config");
  await initGitRepo(repoDir);
  await mkdir(configDir, { recursive: true });
  const paths = await serverPaths(join(root, "sessions.db"));
  const registry = await createRegistry(paths.database, paths.directory);
  const projectId = await registry.register({
    workspaceRoot: repoDir,
    databasePath: paths.database,
    configDirectory: configDir,
    modelId: "test-model",
    baseURL: "https://offline.invalid/v1",
    apiKeyEnv: "UNUSED",
    noAuth: true,
    permissionMode: "full",
    skills: { sharedDirectories: false, claudeDirectories: false, trustedProjects: [], disabledNames: [] },
  });

  const workerStream = controlledStream();
  let routerCalls = 0;
  let steeredSeen = false;

  const manager = createBotManager({
    instanceId: "inst-wd",
    databasePath: paths.database,
    configDirectory: configDir,
    registry,
    watchdogIntervalMs: 60_000,
    softTaskTimeoutMs: 1,
    providerForRole: role => ({
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as RequestBody;
        if (!body.stream) return Response.json({ choices: [{ message: { content: "t" }, finish_reason: "stop" }] });
        if (role === "router") {
          routerCalls++;
          if (routerCalls === 1) {
            return toolResponse("dispatch_task", {
              title: "Watchdog test",
              goal: "Stay running",
              accessMode: "readonly",
              threadId: "thr_pr_42",
            });
          }
          return textResponse("Router noted.");
        }
        if (JSON.stringify(body.messages).includes("PR comment arrived")) {
          steeredSeen = true;
          return textResponse("Handled PR comment directly!");
        }
        workerStream.text("Working...");
        return workerStream.response;
      },
    }),
  });

  try {
    const bot = await manager.createBot({ name: "PR Watcher", projectId });
    await manager.sendMessage(bot.id, "wd-1", "Watch PR 42");
    await waitFor(async () => {
      const s = await manager.getBotState(bot.id);
      return !s.router.busy && s.tasks.length === 1 && s.tasks[0]?.status === "running";
    }, 10000);

    await Bun.sleep(10);
    const wd1 = await manager.runWatchdogOnce();
    expect(wd1.alerts).toBe(1);
    const wd2 = await manager.runWatchdogOnce();
    expect(wd2.alerts).toBe(0);

    await waitFor(async () => !(await manager.getBotState(bot.id)).router.busy, 10000);
    const callsBeforeFastPath = routerCalls;

    const fast = await manager.publishExternalTrigger(bot.id, {
      threadId: "thr_pr_42",
      kind: "pr.comment",
      actor: "reviewer",
      text: "PR comment arrived: please also check edge case",
    });
    expect(fast.route).toBe("fast_path");
    expect(fast.routedTaskIds).toHaveLength(1);
    expect(routerCalls).toBe(callsBeforeFastPath);

    await waitFor(() => steeredSeen, 10000);
    workerStream.end();
  } finally {
    await manager.close();
    await registry.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
