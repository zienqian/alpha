import { randomBytes } from "node:crypto";
import type { CreateProviderOptions } from "@alpha/provider";
import type { AppConfig } from "../config";
import { updateBotsGlobalSettings, type BotsGlobalSettingsPatch } from "../global-config";
import type { MemoryService } from "../memory/service";
import type { RuntimeTrace } from "../runtime/trace-bridge";
import { encodeAttachmentInput } from "../input";
import { fail } from "../server/security";
import type { createRegistry } from "../server/storage";
import { botUploadScope, botUploadUrl, createUploadStore, defaultUploadsDirectory, toChatAttachment, type UploadStore } from "../uploads";
import {
  botColorIds,
  botShapeIds,
  defaultBotAppearance,
  type BotAppearance,
  type BotColorId,
  type BotDeleteResult,
  type BotDetailStateView,
  type BotMessageReceipt,
  type BotModelOverride,
  type BotModelOverridePatch,
  type BotRecord,
  type BotShapeId,
  type BotStatusKind,
  type BotSummaryView,
  type BotTaskApplyResult,
  type BotTaskDiffView,
  type BotTaskRecord,
  type BotsGlobalConfigView,
  type BotsIndexSnapshot,
  type CreateBotInput,
  type UpdateBotInput,
} from "./contracts";
import {
  resolveBotRuntimeConfig,
  resolveBotsGlobalConfig,
  type ResolvedBotRuntimeConfig,
  type ResolvedBotsGlobalConfig,
} from "./config-resolver";
import { createBotEventBus, type BotEventBus } from "./event-bus";
import { createBotRouter, type BotRouter } from "./router";
import { createBotsStore } from "./store";
import { createBotsWatchdog } from "./watchdog";
import {
  createBotWorkerPool,
  projectSummaryName,
  type BotWorkerChatFactory,
  type BotWorkerSessionSnapshot,
} from "./worker-pool";

export interface BotManagerOptions {
  instanceId: string;
  databasePath: string;
  configDirectory?: string;
  registry: Awaited<ReturnType<typeof createRegistry>>;
  trace?: RuntimeTrace;
  memory?: MemoryService;
  uploads?: UploadStore;
  createWorkerChat?: BotWorkerChatFactory;
  providerForRole?: (role: "router" | "worker", config: AppConfig, botId: string) => CreateProviderOptions | undefined;
  watchdogIntervalMs?: number;
  softTaskTimeoutMs?: number;
  approvalTimeoutMs?: number;
  onChanged?: () => void;
}

export interface BotManager {
  readonly busy: boolean;
  readonly sequence: number;
  listBots(options?: { includeArchived?: boolean }): Promise<BotsIndexSnapshot>;
  getBotState(botId: string): Promise<BotDetailStateView>;
  createBot(input: CreateBotInput): Promise<BotSummaryView>;
  updateBot(botId: string, patch: UpdateBotInput): Promise<BotSummaryView>;
  reorderBots(botIds: readonly string[]): Promise<BotsIndexSnapshot>;
  markVisited(botId: string): Promise<BotSummaryView>;
  setArchived(botId: string, archived: boolean): Promise<BotSummaryView>;
  deleteBot(botId: string, options?: { forceCleanupWorktrees?: boolean }): Promise<BotDeleteResult>;
  hasBot(botId: string): boolean;
  sendMessage(botId: string, requestId: string, input: string, attachmentIds?: readonly string[]): Promise<BotMessageReceipt>;
  cancelRouter(botId: string): void;
  answerApproval(botId: string, approvalId: string, taskId: string, allow: boolean): void;
  steerTask(botId: string, taskId: string, input: string): Promise<{ ok: boolean; reason?: string }>;
  cancelTask(botId: string, taskId: string, cleanupWorktree?: boolean): Promise<BotTaskRecord>;
  getTaskDiff(botId: string, taskId: string): Promise<BotTaskDiffView>;
  applyTask(botId: string, taskId: string, options: { strategy: "merge" | "apply_patch"; cleanup?: boolean }): Promise<BotTaskApplyResult>;
  discardTask(botId: string, taskId: string): Promise<BotTaskRecord>;
  getTaskSession(botId: string, taskId: string): Promise<BotWorkerSessionSnapshot>;
  getDefaults(): Promise<BotsGlobalConfigView>;
  updateDefaults(patch: BotsGlobalSettingsPatch): Promise<BotsGlobalConfigView>;
  publishExternalTrigger(botId: string, input: { threadId: string; kind: string; actor: string; text: string; idempotencyKey?: string }): Promise<{ route: string; routedTaskIds?: readonly string[] }>;
  notifyProjectsChanged(): void;
  notifyMemorySettingsChanged(): void;
  runWatchdogOnce(): Promise<{ alerts: number; prunedWorktrees: number }>;
  subscribeIndex(listener: () => void): () => void;
  subscribeBot(botId: string, listener: () => void): () => void;
  close(): Promise<void>;
}

interface BotRuntimeHandle {
  eventBus: BotEventBus;
  router: BotRouter;
}

function mergeAppearance(id: string, base: BotAppearance, patch?: Partial<BotAppearance>): BotAppearance {
  if (!patch) return base;
  const fallback = defaultBotAppearance(id);
  const shape = patch.shape && botShapeIds.includes(patch.shape as BotShapeId) ? patch.shape : (base.shape ?? fallback.shape);
  const color = patch.color && botColorIds.includes(patch.color as BotColorId) ? patch.color : (base.color ?? fallback.color);
  return { shape, color };
}

function applyModelOverridePatch(current: BotModelOverride | undefined, patch: BotModelOverridePatch | null | undefined): BotModelOverride | null | undefined {
  if (patch === undefined) return undefined;
  if (patch === null) return null;
  const next: BotModelOverride = { ...(current ?? {}) };
  if (patch.modelId !== undefined) {
    if (patch.modelId === null) delete next.modelId;
    else next.modelId = patch.modelId;
  }
  if (patch.contextWindow !== undefined) {
    if (patch.contextWindow === null) delete next.contextWindow;
    else next.contextWindow = patch.contextWindow;
  }
  if (patch.maxOutputTokens !== undefined) {
    if (patch.maxOutputTokens === null) delete next.maxOutputTokens;
    else next.maxOutputTokens = patch.maxOutputTokens;
  }
  if (patch.baseURL !== undefined) {
    if (patch.baseURL === null) delete next.baseURL;
    else next.baseURL = patch.baseURL;
  }
  if (patch.noAuth === true) {
    delete next.apiKeyEnv;
    next.noAuth = true;
  } else if (patch.apiKeyEnv !== undefined) {
    if (patch.apiKeyEnv === null) delete next.apiKeyEnv;
    else {
      next.apiKeyEnv = patch.apiKeyEnv;
      next.noAuth = false;
    }
  } else if (patch.noAuth === false || patch.noAuth === null) {
    if (patch.noAuth === null) delete next.noAuth;
    else next.noAuth = false;
  }
  return Object.keys(next).length ? next : null;
}

function isNewerThan(timestamp: string | undefined, reference: string | undefined): boolean {
  if (!timestamp) return false;
  if (!reference) return true;
  return Date.parse(timestamp) > Date.parse(reference);
}

export function createBotManager(options: BotManagerOptions): BotManager {
  const store = createBotsStore(`${options.databasePath}.bots.db`);
  const uploads = options.uploads ?? createUploadStore(defaultUploadsDirectory(options.databasePath));
  // Crash recovery: preserve worktrees and sessions, never silently replay interrupted write tasks.
  store.markRunningTasksInterrupted();

  const handles = new Map<string, BotRuntimeHandle>();
  const indexListeners = new Set<() => void>();
  const botListeners = new Map<string, Set<() => void>>();
  let sequence = 0;
  let cachedGlobal: ResolvedBotsGlobalConfig | undefined;

  function notifyBot(botId: string) {
    sequence++;
    for (const listener of botListeners.get(botId) ?? []) listener();
    for (const listener of indexListeners) listener();
    options.onChanged?.();
  }

  function notifyIndex() {
    sequence++;
    for (const listeners of botListeners.values()) {
      for (const listener of listeners) listener();
    }
    for (const listener of indexListeners) listener();
    options.onChanged?.();
  }

  async function resolveGlobal(): Promise<ResolvedBotsGlobalConfig> {
    const fallbackProject = [...options.registry.configs.values()].at(-1);
    const resolved = await resolveBotsGlobalConfig({
      configDirectory: options.configDirectory,
      fallbackProject,
    });
    cachedGlobal = resolved;
    return resolved;
  }

  async function resolveBotCfg(bot: BotRecord): Promise<ResolvedBotRuntimeConfig> {
    const global = await resolveGlobal();
    const projectConfig = options.registry.configs.get(bot.projectId);
    return resolveBotRuntimeConfig(global, bot, projectConfig);
  }

  function ensureHandle(botId: string): BotRuntimeHandle {
    const existing = handles.get(botId);
    if (existing) return existing;
    const bot = store.getBot(botId);
    if (!bot) return fail(404, "BOT_NOT_FOUND");

    let wakeRouter: () => void = () => undefined;
    const eventBus = createBotEventBus({
      botId,
      botName: () => store.getBot(botId)?.name ?? bot.name,
      store,
      async onFastRoute(task, trigger, fullText) {
        const steered = await workerPool.steerTask(botId, task.id, `[Thread ${trigger.threadId} event from ${trigger.actor}]: ${fullText}`);
        return steered.ok;
      },
      onRouterWake() {
        wakeRouter();
      },
      onChanged: () => notifyBot(botId),
    });

    const router = createBotRouter({
      botId,
      databasePath: options.databasePath,
      registry: options.registry,
      store,
      workerPool,
      getBot: () => store.getBot(botId),
      resolveBotConfig: resolveBotCfg,
      providerForRole: options.providerForRole,
      trace: options.trace,
      memory: options.memory,
      uploads,
      onChanged: () => notifyBot(botId),
    });
    wakeRouter = () => router.schedule();

    const handle: BotRuntimeHandle = { eventBus, router };
    handles.set(botId, handle);
    return handle;
  }

  const workerPool = createBotWorkerPool({
    databasePath: options.databasePath,
    registry: options.registry,
    store,
    getBot: botId => store.getBot(botId),
    resolveGlobalConfig: resolveGlobal,
    resolveBotConfig: resolveBotCfg,
    createWorkerChat: options.createWorkerChat,
    providerForRole: options.providerForRole,
    trace: options.trace,
    memory: options.memory,
    onTaskEvent(event) {
      if (!store.getBot(event.botId)) return;
      const handle = ensureHandle(event.botId);
      void handle.eventBus.publish({
        threadId: handle.eventBus.mainThreadId,
        source: "worker_event",
        kind: event.kind,
        priority: "normal",
        actor: `worker:${event.task.shortId}`,
        text: `Worker ${event.task.shortId} (${event.task.title}) ${event.kind.replace("task.", "")}: ${event.summary}`,
        ...(event.diffArtifactRef ? { payloadRef: event.diffArtifactRef } : {}),
        relatedIds: [event.task.id, ...(event.diffArtifactRef ? [event.diffArtifactRef] : [])],
      });
    },
    onChanged: botId => notifyBot(botId),
  });

  const watchdog = createBotsWatchdog({
    store,
    workerPool,
    async publishBotTrigger(botId, input) {
      if (!store.getBot(botId)) return undefined;
      return ensureHandle(botId).eventBus.publish(input);
    },
    resolveGlobalConfig: resolveGlobal,
    getRepoRoots: () => [...options.registry.configs.values()].map(c => c.workspaceRoot),
    intervalMs: options.watchdogIntervalMs,
    softTaskTimeoutMs: options.softTaskTimeoutMs,
    approvalTimeoutMs: options.approvalTimeoutMs,
  });

  function computeSummary(bot: BotRecord, global: ResolvedBotsGlobalConfig): BotSummaryView {
    const projectConfig = options.registry.configs.get(bot.projectId);
    const projectMissing = !projectConfig;
    const projectName = projectConfig
      ? projectSummaryName(projectConfig.workspaceRoot, projectConfig.projectName)
      : bot.projectId;
    const runtimeCfg = resolveBotRuntimeConfig(global, bot, projectConfig);
    const handle = handles.get(bot.id);
    const routerBusy = Boolean(handle?.router.busy);
    const tasks = store.listTasksByBot(bot.id, 100);
    const approvals = workerPool.listApprovals(bot.id);

    const activeTaskCount = tasks.filter(t => t.status === "running" || t.status === "awaiting_approval").length;
    const queuedTaskCount = tasks.filter(t => t.status === "queued").length;
    const pendingApprovalCount = approvals.length;
    const readyDiffCount = tasks.filter(t => t.worktreeState === "ready_for_review").length;

    const latestFailed = tasks.find(t => (t.status === "failed" || t.status === "interrupted") && isNewerThan(t.finishedAt ?? t.updatedAt, bot.lastVisitedAt));
    const latestCompleted = tasks.find(t => t.status === "completed" && isNewerThan(t.finishedAt ?? t.updatedAt, bot.lastVisitedAt));

    let status: BotStatusKind = "idle";
    let statusDetail: string | undefined;
    if (pendingApprovalCount > 0) {
      status = "approval";
      statusDetail = "approval";
    } else if (routerBusy || activeTaskCount > 0) {
      status = "working";
      statusDetail = activeTaskCount > 0 ? "worker_running" : "router_thinking";
    } else if (queuedTaskCount > 0) {
      status = "waiting";
      statusDetail = "worker_queued";
    } else if (projectMissing) {
      status = "attention_error";
      statusDetail = "project_missing";
    } else if (latestFailed) {
      status = "attention_error";
      statusDetail = latestFailed.status === "interrupted" ? "task_interrupted" : "task_failed";
    } else if (latestCompleted || readyDiffCount > 0) {
      status = "done";
      statusDetail = readyDiffCount > 0 ? "diff_ready" : "task_completed";
    }

    return {
      id: bot.id,
      name: bot.name,
      instructions: bot.instructions,
      projectId: bot.projectId,
      projectName,
      ...(projectConfig ? { workspaceRoot: projectConfig.workspaceRoot } : {}),
      projectMissing,
      appearance: bot.appearance,
      ...(bot.permissionMode ? { permissionMode: bot.permissionMode } : {}),
      ...(bot.maxConcurrentWorkers !== undefined ? { maxConcurrentWorkers: bot.maxConcurrentWorkers } : {}),
      ...(bot.routerModel ? { routerModel: bot.routerModel } : {}),
      ...(bot.workerModel ? { workerModel: bot.workerModel } : {}),
      sortOrder: bot.sortOrder,
      memoryMode: bot.memoryMode,
      ...(bot.lastVisitedAt ? { lastVisitedAt: bot.lastVisitedAt } : {}),
      ...(bot.archivedAt ? { archivedAt: bot.archivedAt } : {}),
      createdAt: bot.createdAt,
      updatedAt: bot.updatedAt,
      status,
      ...(statusDetail ? { statusDetail } : {}),
      activeTaskCount,
      queuedTaskCount,
      pendingApprovalCount,
      readyDiffCount,
      routerBusy,
      ...(runtimeCfg.router ? { effectiveRouterModel: runtimeCfg.router } : {}),
      ...(runtimeCfg.worker ? { effectiveWorkerModel: runtimeCfg.worker } : {}),
    };
  }

  function requireBot(botId: string): BotRecord {
    const bot = store.getBot(botId);
    if (!bot) return fail(404, "BOT_NOT_FOUND");
    return bot;
  }

  return {
    get busy() {
      if (workerPool.activeCount > 0 || workerPool.queuedCount > 0) return true;
      for (const handle of handles.values()) {
        if (handle.router.busy) return true;
      }
      return false;
    },
    get sequence() {
      return sequence;
    },
    async listBots(listOptions = {}) {
      const global = await resolveGlobal();
      const bots = store.listBots({ includeArchived: listOptions.includeArchived }).map(bot => computeSummary(bot, global));
      return {
        instanceId: options.instanceId,
        sequence,
        bots,
        approvals: workerPool.listApprovals(),
        defaults: global.view,
      };
    },
    async getBotState(botId) {
      const bot = requireBot(botId);
      const global = await resolveGlobal();
      const handle = ensureHandle(botId);
      await handle.router.ready();
      return {
        instanceId: options.instanceId,
        sequence,
        bot: computeSummary(bot, global),
        router: handle.router.snapshot(),
        tasks: store.listTasksByBot(botId, 100),
        approvals: workerPool.listApprovals(botId),
      };
    },
    async createBot(input) {
      const name = input.name.trim();
      if (!name || name.length > 120) return fail(400, "INVALID_BOT_NAME");
      const instructions = (input.instructions ?? "").trim();
      if (instructions.length > 16000) return fail(400, "INVALID_INSTRUCTIONS");
      if (!options.registry.configs.has(input.projectId)) return fail(404, "PROJECT_NOT_FOUND");
      if (input.maxConcurrentWorkers !== undefined && input.maxConcurrentWorkers !== null) {
        if (!Number.isSafeInteger(input.maxConcurrentWorkers) || input.maxConcurrentWorkers < 1 || input.maxConcurrentWorkers > 4) {
          return fail(400, "INVALID_CONFIG");
        }
      }

      const id = `bot_${randomBytes(6).toString("hex")}`;
      const now = new Date().toISOString();
      const appearance = mergeAppearance(id, defaultBotAppearance(id), input.appearance);
      const record: BotRecord = {
        id,
        name,
        instructions,
        projectId: input.projectId,
        appearance,
        ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
        ...(input.maxConcurrentWorkers ? { maxConcurrentWorkers: input.maxConcurrentWorkers } : {}),
        ...(input.routerModel ? { routerModel: input.routerModel } : {}),
        ...(input.workerModel ? { workerModel: input.workerModel } : {}),
        routerSessionId: "main",
        sortOrder: store.nextSortOrder(),
        memoryMode: input.memoryMode === "off" ? "off" : "alphacode",
        lastVisitedAt: now,
        createdAt: now,
        updatedAt: now,
      };
      store.createBot(record);
      ensureHandle(id);
      notifyBot(id);
      const global = await resolveGlobal();
      return computeSummary(record, global);
    },
    async updateBot(botId, patch) {
      const current = requireBot(botId);
      const nextPatch: Parameters<typeof store.updateBot>[1] = {};

      if (patch.name !== undefined) {
        const name = patch.name.trim();
        if (!name || name.length > 120) return fail(400, "INVALID_BOT_NAME");
        nextPatch.name = name;
      }
      if (patch.instructions !== undefined) {
        const instructions = patch.instructions.trim();
        if (instructions.length > 16000) return fail(400, "INVALID_INSTRUCTIONS");
        nextPatch.instructions = instructions;
      }
      if (patch.projectId !== undefined && patch.projectId !== current.projectId) {
        if (!options.registry.configs.has(patch.projectId)) return fail(404, "PROJECT_NOT_FOUND");
        const handle = handles.get(botId);
        if (handle?.router.busy || workerPool.hasActiveOrQueuedForBot(botId)) {
          return fail(409, "BOT_BUSY");
        }
        nextPatch.projectId = patch.projectId;
      }
      if (patch.appearance !== undefined) {
        nextPatch.appearance = mergeAppearance(botId, current.appearance, patch.appearance);
      }
      if (patch.permissionMode !== undefined) {
        nextPatch.permissionMode = patch.permissionMode;
      }
      if (patch.maxConcurrentWorkers !== undefined) {
        if (patch.maxConcurrentWorkers !== null && (!Number.isSafeInteger(patch.maxConcurrentWorkers) || patch.maxConcurrentWorkers < 1 || patch.maxConcurrentWorkers > 4)) {
          return fail(400, "INVALID_CONFIG");
        }
        nextPatch.maxConcurrentWorkers = patch.maxConcurrentWorkers;
      }
      const nextRouterModel = applyModelOverridePatch(current.routerModel, patch.routerModel);
      if (nextRouterModel !== undefined) nextPatch.routerModel = nextRouterModel;
      const nextWorkerModel = applyModelOverridePatch(current.workerModel, patch.workerModel);
      if (nextWorkerModel !== undefined) nextPatch.workerModel = nextWorkerModel;
      if (patch.memoryMode !== undefined) {
        nextPatch.memoryMode = patch.memoryMode === "off" ? "off" : "alphacode";
      }

      const updated = store.updateBot(botId, nextPatch) ?? current;
      handles.get(botId)?.router.markConfigDirty();
      notifyBot(botId);
      const global = await resolveGlobal();
      return computeSummary(updated, global);
    },
    async reorderBots(botIds) {
      store.reorderBots(botIds);
      notifyIndex();
      return this.listBots();
    },
    async markVisited(botId) {
      const current = requireBot(botId);
      const updated = store.updateBot(botId, { lastVisitedAt: new Date().toISOString() }) ?? current;
      notifyBot(botId);
      const global = await resolveGlobal();
      return computeSummary(updated, global);
    },
    async setArchived(botId, archived) {
      const current = requireBot(botId);
      if (archived) {
        const handle = handles.get(botId);
        if (handle?.router.busy || workerPool.hasActiveOrQueuedForBot(botId)) {
          return fail(409, "BOT_BUSY");
        }
      }
      const updated = store.updateBot(botId, { archivedAt: archived ? new Date().toISOString() : null }) ?? current;
      notifyBot(botId);
      const global = await resolveGlobal();
      return computeSummary(updated, global);
    },
    async deleteBot(botId, deleteOptions = {}) {
      requireBot(botId);
      const unmerged = store.listUnmergedWorktreeTasks(botId);
      if (unmerged.length > 0 && !deleteOptions.forceCleanupWorktrees) {
        return {
          deleted: false,
          cleanedWorktrees: 0,
          unmergedWorktreeTaskIds: unmerged.map(task => task.id),
        };
      }
      await workerPool.cancelAllForBot(botId, Boolean(deleteOptions.forceCleanupWorktrees));
      const handle = handles.get(botId);
      if (handle) {
        await handle.router.close();
        handles.delete(botId);
      }
      store.deleteBot(botId);
      await uploads.removeScope(botUploadScope(botId));
      botListeners.delete(botId);
      notifyIndex();
      return {
        deleted: true,
        cleanedWorktrees: deleteOptions.forceCleanupWorktrees ? unmerged.length : 0,
      };
    },
    hasBot(botId) {
      return Boolean(store.getBot(botId));
    },
    async sendMessage(botId, requestId, input, attachmentIds) {
      const bot = requireBot(botId);
      if (bot.archivedAt) return fail(409, "BOT_ARCHIVED");
      if (!options.registry.configs.has(bot.projectId)) return fail(409, "BOT_PROJECT_UNAVAILABLE");
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(requestId)) return fail(400, "INVALID_REQUESTID");
      const trimmed = input.trim();
      const ids = attachmentIds ?? [];
      if (!trimmed && ids.length === 0) return fail(400, "INVALID_INPUT");
      const stored = ids.length ? await uploads.resolveMany(botUploadScope(botId), ids) : undefined;
      const payload = stored?.length
        ? encodeAttachmentInput(trimmed, stored.map(item => toChatAttachment(item, botUploadUrl(botId, item.id))))
        : trimmed;

      const handle = ensureHandle(botId);
      const res = await handle.eventBus.publish({
        threadId: handle.eventBus.mainThreadId,
        source: "user_chat",
        kind: "user.message",
        priority: "normal",
        idempotencyKey: `bot:${botId}:msg:${requestId}`,
        actor: "user",
        text: payload,
      });
      return {
        requestId,
        triggerId: res.trigger.id,
        status: res.inserted ? "accepted" : "duplicate",
      };
    },
    cancelRouter(botId) {
      requireBot(botId);
      handles.get(botId)?.router.cancel();
    },
    answerApproval(botId, approvalId, taskId, allow) {
      requireBot(botId);
      workerPool.answerApproval(botId, approvalId, taskId, allow);
    },
    steerTask(botId, taskId, input) {
      requireBot(botId);
      return workerPool.steerTask(botId, taskId, input);
    },
    cancelTask(botId, taskId, cleanupWorktree) {
      requireBot(botId);
      return workerPool.cancelTask(botId, taskId, cleanupWorktree);
    },
    getTaskDiff(botId, taskId) {
      requireBot(botId);
      return workerPool.getTaskDiff(botId, taskId);
    },
    applyTask(botId, taskId, applyOptions) {
      requireBot(botId);
      return workerPool.applyTask(botId, taskId, applyOptions);
    },
    discardTask(botId, taskId) {
      requireBot(botId);
      return workerPool.discardTask(botId, taskId);
    },
    getTaskSession(botId, taskId) {
      requireBot(botId);
      return workerPool.getTaskSession(botId, taskId);
    },
    async getDefaults() {
      return (await resolveGlobal()).view;
    },
    async updateDefaults(patch) {
      const current = cachedGlobal ?? await resolveGlobal();
      await updateBotsGlobalSettings(current.configDirectory, patch);
      for (const handle of handles.values()) handle.router.markConfigDirty();
      const refreshed = await resolveGlobal();
      notifyIndex();
      return refreshed.view;
    },
    async publishExternalTrigger(botId, input) {
      requireBot(botId);
      const handle = ensureHandle(botId);
      const res = await handle.eventBus.publish({
        threadId: input.threadId,
        source: "external_channel",
        kind: input.kind,
        actor: input.actor,
        text: input.text,
        idempotencyKey: input.idempotencyKey,
        allowFastPath: true,
      });
      return { route: res.route, routedTaskIds: res.routedTaskIds };
    },
    notifyProjectsChanged() {
      sequence++;
      for (const listeners of botListeners.values()) {
        for (const listener of listeners) listener();
      }
      for (const listener of indexListeners) listener();
    },
    notifyMemorySettingsChanged() {
      for (const handle of handles.values()) {
        handle.router.markConfigDirty();
      }
      notifyIndex();
    },
    runWatchdogOnce() {
      return watchdog.runOnce();
    },
    subscribeIndex(listener) {
      indexListeners.add(listener);
      return () => { indexListeners.delete(listener); };
    },
    subscribeBot(botId, listener) {
      let set = botListeners.get(botId);
      if (!set) {
        set = new Set();
        botListeners.set(botId, set);
      }
      set.add(listener);
      return () => {
        set?.delete(listener);
        if (set?.size === 0) botListeners.delete(botId);
      };
    },
    async close() {
      watchdog.stop();
      await Promise.all([...handles.values()].map(h => h.router.close()));
      handles.clear();
      await workerPool.close();
      store.close();
    },
  };
}
