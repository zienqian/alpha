import { randomBytes, randomUUID } from "node:crypto";
import { basename, normalize, resolve } from "node:path";
import type { CreateProviderOptions } from "@alpha/provider";
import { createSqliteSessionStore } from "@alpha/adk-session/sqlite";
import { createApplication } from "../application";
import type { Chat, ChatMessage, PermissionMode } from "../chat/contracts";
import type { AppConfig } from "../config";
import { restoreMessages } from "../runtime/history";
import type { RuntimeTrace } from "../runtime/trace-bridge";
import { fail } from "../server/security";
import type { createRegistry } from "../server/storage";
import type {
  BotApprovalView,
  BotRecord,
  BotTaskAccessMode,
  BotTaskApplyResult,
  BotTaskDiffView,
  BotTaskRecord,
} from "./contracts";
import type { ResolvedBotRuntimeConfig, ResolvedBotsGlobalConfig } from "./config-resolver";
import type { BotsStore } from "./store";
import {
  allocateWorkspace,
  applyWorktreeChanges,
  cleanupWorktree,
  collectWorktreeDiff,
  inspectRepo,
} from "./worktree-manager";

export type BotWorkerChatFactory = (
  config: AppConfig,
  options: {
    botId: string;
    namespace: string;
    accessMode: BotTaskAccessMode;
    instructions: string;
    draftSessionId: string;
    credential?: string;
    provider?: CreateProviderOptions;
    trace?: RuntimeTrace;
  },
) => Promise<Chat>;

export interface BotWorkerSessionSnapshot {
  botId: string;
  taskId: string;
  sessionId: string;
  modelId: string;
  workspaceRoot: string;
  live: boolean;
  busy: boolean;
  canSteer: boolean;
  messages: readonly ChatMessage[];
}

interface ActiveWorker {
  botId: string;
  taskId: string;
  chat: Chat;
  dirLockKey?: string;
  startedAt: number;
  approvalId?: string;
  approvalCreatedAt?: number;
  pendingSteers: string[];
  unsubscribe: () => void;
  promise?: Promise<void>;
}

export interface BotWorkerPool {
  readonly activeCount: number;
  readonly queuedCount: number;
  activeCountForBot(botId: string): number;
  queuedCountForBot(botId: string): number;
  hasActiveOrQueuedForBot(botId: string): boolean;
  dispatch(input: {
    bot: BotRecord;
    goal: string;
    title?: string;
    accessMode?: BotTaskAccessMode;
    originTriggerId?: string;
    threadId?: string;
  }): Promise<BotTaskRecord>;
  steerTask(botId: string, taskId: string, instruction: string): Promise<{ ok: boolean; reason?: string }>;
  cancelTask(botId: string, taskId: string, cleanup?: boolean): Promise<BotTaskRecord>;
  cancelAllForBot(botId: string, cleanup?: boolean): Promise<void>;
  answerApproval(botId: string, approvalId: string, taskId: string, allow: boolean): void;
  listApprovals(botId?: string): BotApprovalView[];
  getActiveMetrics(): { botId: string; taskId: string; startedAt: number; approvalCreatedAt?: number; approvalId?: string }[];
  getTaskDiff(botId: string, taskId: string): Promise<BotTaskDiffView>;
  applyTask(botId: string, taskId: string, options: { strategy: "merge" | "apply_patch"; cleanup?: boolean }): Promise<BotTaskApplyResult>;
  discardTask(botId: string, taskId: string): Promise<BotTaskRecord>;
  getTaskSession(botId: string, taskId: string): Promise<BotWorkerSessionSnapshot>;
  close(): Promise<void>;
}

function dirKey(path: string): string {
  const normalized = normalize(resolve(path));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function botWorkerNamespace(botId: string): string {
  return `bot:worker:${botId}`;
}

function summarizeWorkerResult(chat: Chat, fallback: string): string {
  const lastAssistant = [...chat.state.messages].reverse().find(m => m.role === "assistant" && m.text.trim());
  const text = lastAssistant?.text.trim() || chat.state.error || fallback;
  return text.length > 600 ? `${text.slice(0, 599)}…` : text;
}

function buildWorkerInstructions(bot: BotRecord, task: BotTaskRecord): string {
  const lines = [
    `You are an isolated background Worker Agent dispatched by AlphaCode Bot "${bot.name}".`,
    `Task ID: ${task.shortId} (${task.accessMode} mode, isolation: ${task.isolationMode}).`,
    "Work autonomously and thoroughly on the assigned goal, verify changes with tests when applicable, and end with a concise summary of what you found or changed.",
  ];
  if (bot.instructions.trim()) {
    lines.push(`Bot role context: ${bot.instructions.trim().slice(0, 800)}`);
  }
  if (task.isolationMode === "git_worktree" && task.worktreeBranch) {
    lines.push(`You are running in an isolated git worktree on branch ${task.worktreeBranch}. Do not push to remotes or modify the user's primary working directory.`);
  }
  if (task.mainRepoDirtyAtStart) {
    lines.push("Note: the user's primary repository had uncommitted changes when this worktree was created from HEAD.");
  }
  return lines.join("\n");
}

export function createBotWorkerPool(options: {
  databasePath: string;
  registry: Awaited<ReturnType<typeof createRegistry>>;
  store: BotsStore;
  getBot: (botId: string) => BotRecord | undefined;
  resolveGlobalConfig: () => Promise<ResolvedBotsGlobalConfig>;
  resolveBotConfig: (bot: BotRecord) => Promise<ResolvedBotRuntimeConfig>;
  createWorkerChat?: BotWorkerChatFactory;
  providerForRole?: (role: "router" | "worker", config: AppConfig, botId: string) => CreateProviderOptions | undefined;
  trace?: RuntimeTrace;
  onTaskEvent: (event: {
    botId: string;
    task: BotTaskRecord;
    kind: "task.completed" | "task.failed" | "task.cancelled";
    summary: string;
    diffArtifactRef?: string;
  }) => void;
  onChanged: (botId: string) => void;
}): BotWorkerPool {
  const active = new Map<string, ActiveWorker>();
  const inFlight = new Set<Promise<void>>();
  const inFlightByBot = new Map<string, number>();
  const queueByBot = new Map<string, string[]>();
  const queueBotOrder: string[] = [];
  let rrCursor = 0;
  const dirLocks = new Set<string>();
  const approvals = new Map<string, BotApprovalView>();
  const executionDirs = new Map<string, string>();
  let closed = false;

  const chatFactory: BotWorkerChatFactory = options.createWorkerChat ?? (async (config, opts) =>
    createApplication(config, {
      namespace: opts.namespace,
      accessMode: opts.accessMode,
      instructions: opts.instructions,
      draftSessionId: opts.draftSessionId,
      trace: opts.trace,
      provider: opts.provider ?? {
        getEnv: name => (name === config.apiKeyEnv && opts.credential !== undefined ? opts.credential : process.env[name]),
      },
    }));

  function lookupOwnedTask(botId: string, idOrShortId: string): BotTaskRecord | undefined {
    const task = options.store.getTask(idOrShortId) ?? options.store.getTaskByShortId(idOrShortId);
    return task && task.botId === botId ? task : undefined;
  }

  function clearApprovalFor(taskId: string) {
    for (const [id, item] of approvals) {
      if (item.taskId === taskId) approvals.delete(id);
    }
  }

  function enqueueTask(botId: string, taskId: string) {
    let list = queueByBot.get(botId);
    if (!list) {
      list = [];
      queueByBot.set(botId, list);
      queueBotOrder.push(botId);
    }
    list.push(taskId);
  }

  function removeQueuedTask(botId: string, taskId: string): boolean {
    const list = queueByBot.get(botId);
    if (!list) return false;
    const idx = list.indexOf(taskId);
    if (idx < 0) return false;
    list.splice(idx, 1);
    if (list.length === 0) {
      queueByBot.delete(botId);
      const orderIdx = queueBotOrder.indexOf(botId);
      if (orderIdx >= 0) {
        queueBotOrder.splice(orderIdx, 1);
        if (rrCursor > orderIdx) rrCursor--;
        if (rrCursor >= queueBotOrder.length) rrCursor = 0;
      }
    }
    return true;
  }

  function totalQueuedCount(): number {
    let count = 0;
    for (const list of queueByBot.values()) count += list.length;
    return count;
  }

  function botInFlightCount(botId: string): number {
    return inFlightByBot.get(botId) ?? 0;
  }

  async function runWorker(taskId: string, bot: BotRecord, botConfig: ResolvedBotRuntimeConfig) {
    const task = options.store.getTask(taskId);
    if (!task || task.status !== "queued" || closed) return;

    const projectConfig = options.registry.configs.get(task.projectId);
    const workerRole = botConfig.worker;
    if (!workerRole) {
      const failed = options.store.updateTask(taskId, {
        status: "failed",
        resultSummary: "MODEL_REQUIRED",
        finishedAt: new Date().toISOString(),
      }) ?? task;
      options.onChanged(task.botId);
      options.onTaskEvent({ botId: task.botId, task: failed, kind: "task.failed", summary: `Task ${task.shortId} failed: MODEL_REQUIRED` });
      return;
    }

    const lockKey = task.isolationMode === "serial_lock" ? dirKey(task.workspaceRoot) : undefined;
    if (lockKey) dirLocks.add(lockKey);

    const execCwd = executionDirs.get(taskId) ?? task.worktreePath ?? task.workspaceRoot;
    const permissionMode: PermissionMode = bot.permissionMode ?? projectConfig?.permissionMode ?? botConfig.global.defaults.permissionMode ?? "ask";
    const appConfig: AppConfig = {
      workspaceRoot: execCwd,
      databasePath: options.databasePath,
      configDirectory: botConfig.global.configDirectory,
      modelId: workerRole.modelId,
      baseURL: workerRole.baseURL,
      apiKeyEnv: workerRole.apiKeyEnv,
      noAuth: workerRole.noAuth,
      contextWindow: workerRole.contextWindow,
      maxOutputTokens: workerRole.maxOutputTokens,
      autoCompact: projectConfig?.autoCompact ?? botConfig.global.defaults.autoCompact,
      permissionMode,
      skills: projectConfig?.skills ?? botConfig.global.defaults.skills,
      traceEnabled: projectConfig?.traceEnabled ?? (process.env.ALPHACODE_TRACE !== "0"),
      globalInstructions: projectConfig?.globalInstructions,
      globalInstructionsPath: projectConfig?.globalInstructionsPath,
    };

    let chat: Chat | undefined;
    let workerEntry: ActiveWorker | undefined;
    try {
      const credential = options.registry.credentials.get(task.projectId);
      chat = await chatFactory(appConfig, {
        botId: task.botId,
        namespace: botWorkerNamespace(task.botId),
        accessMode: task.accessMode,
        instructions: buildWorkerInstructions(bot, task),
        draftSessionId: task.workerSessionId,
        credential,
        provider: options.providerForRole?.("worker", appConfig, task.botId),
        trace: appConfig.traceEnabled === false ? undefined : options.trace,
      });
      if (closed) {
        await chat.close().catch(() => undefined);
        return;
      }
      const startedAt = Date.now();
      const entry: ActiveWorker = {
        botId: task.botId,
        taskId,
        chat,
        dirLockKey: lockKey,
        startedAt,
        pendingSteers: [],
        unsubscribe: () => undefined,
      };
      workerEntry = entry;
      active.set(taskId, entry);

      let steeringInFlight = false;
      const flushSteers = () => {
        if (closed || steeringInFlight || !entry.pendingSteers.length || !entry.chat.canSteer || !entry.chat.steer) return;
        const nextSteer = entry.pendingSteers.shift();
        if (!nextSteer) return;
        steeringInFlight = true;
        void entry.chat.steer(nextSteer).then(consumed => {
          steeringInFlight = false;
          if (!consumed && !closed) entry.pendingSteers.unshift(nextSteer);
          else if (!closed && entry.pendingSteers.length) queueMicrotask(flushSteers);
        }).catch(() => {
          steeringInFlight = false;
        });
      };

      entry.unsubscribe = chat.subscribe(state => {
        if (closed) return;
        if (entry.pendingSteers.length) queueMicrotask(flushSteers);
        const current = options.store.getTask(taskId);
        if (!current) return;
        if (state.approval && !entry.approvalId) {
          const approvalId = randomUUID();
          const latestBot = options.getBot(current.botId);
          entry.approvalId = approvalId;
          entry.approvalCreatedAt = Date.now();
          approvals.set(approvalId, {
            approvalId,
            botId: current.botId,
            botName: latestBot?.name ?? bot.name,
            taskId: current.id,
            taskShortId: current.shortId,
            taskTitle: current.title,
            projectId: current.projectId,
            workspaceRoot: current.worktreePath ?? current.workspaceRoot,
            request: state.approval,
            createdAt: new Date().toISOString(),
          });
          options.store.updateTask(taskId, { status: "awaiting_approval" });
          options.onChanged(current.botId);
        } else if (!state.approval && entry.approvalId) {
          approvals.delete(entry.approvalId);
          entry.approvalId = undefined;
          entry.approvalCreatedAt = undefined;
          if (current.status === "awaiting_approval") {
            options.store.updateTask(taskId, { status: "running" });
          }
          options.onChanged(current.botId);
        }
      });

      const runningTask = options.store.updateTask(taskId, { status: "running" }) ?? task;
      options.onChanged(task.botId);

      const work = chat.send(runningTask.goal, `bot-worker-${runningTask.shortId}`);
      entry.promise = work;
      queueMicrotask(flushSteers);
      await work;

      if (closed) return;
      const latest = options.store.getTask(taskId) ?? runningTask;
      const runStatus = chat.state.lastRunStatus;
      let diffArtifactRef: string | undefined;
      let worktreeState = latest.worktreeState;
      let diffNote = "";

      if (latest.isolationMode === "git_worktree" && latest.worktreePath) {
        const diff = await collectWorktreeDiff(latest);
        if (diff.hasChanges) {
          worktreeState = "ready_for_review";
          const artifactId = `art_diff_${latest.shortId}`;
          options.store.savePayload(latest.botId, artifactId, diff.patch || diff.stat);
          options.store.addLink(latest.botId, latest.id, artifactId, "produced");
          diffArtifactRef = artifactId;
          diffNote = ` (${diff.files.length} file(s) changed on branch ${latest.worktreeBranch})`;
        } else {
          const repo = await inspectRepo(latest.workspaceRoot);
          if (repo.isGitRepo && repo.repoRoot) {
            await cleanupWorktree(repo.repoRoot, latest.worktreePath, latest.worktreeBranch, true);
          }
          worktreeState = "cleaned";
        }
      }

      if (closed) return;
      const finalStatus = latest.status === "cancelled" || runStatus === "cancelled"
        ? "cancelled"
        : runStatus === "failed"
          ? "failed"
          : "completed";
      const summary = `${summarizeWorkerResult(chat, finalStatus)}${diffNote}`;
      const finalized = options.store.updateTask(taskId, {
        status: finalStatus,
        worktreeState,
        ...(diffArtifactRef ? { diffArtifactRef } : {}),
        resultSummary: summary,
        finishedAt: new Date().toISOString(),
      }) ?? latest;

      const eventKind = finalStatus === "completed" ? "task.completed" : finalStatus === "cancelled" ? "task.cancelled" : "task.failed";
      options.onChanged(latest.botId);
      options.onTaskEvent({ botId: latest.botId, task: finalized, kind: eventKind, summary, diffArtifactRef });
    } catch (error) {
      if (closed) return;
      const latest = options.store.getTask(taskId) ?? task;
      const code = (error as { code?: string })?.code ?? (error instanceof Error ? error.message : "WORKER_FAILED");
      const finalStatus = latest.status === "cancelled" ? "cancelled" : "failed";
      const finalized = options.store.updateTask(taskId, {
        status: finalStatus,
        resultSummary: code,
        finishedAt: new Date().toISOString(),
      }) ?? latest;
      options.onChanged(latest.botId);
      options.onTaskEvent({
        botId: latest.botId,
        task: finalized,
        kind: finalStatus === "cancelled" ? "task.cancelled" : "task.failed",
        summary: `Task ${finalized.shortId} ${finalStatus}: ${code}`,
      });
    } finally {
      clearApprovalFor(taskId);
      if (workerEntry) {
        workerEntry.unsubscribe();
        active.delete(taskId);
      }
      if (chat) await chat.close().catch(() => undefined);
      if (lockKey) dirLocks.delete(lockKey);
      executionDirs.delete(taskId);
      if (!closed) {
        options.onChanged(task.botId);
        void schedule();
      }
    }
  }

  async function schedule() {
    if (closed || queueBotOrder.length === 0) return;
    const globalConfig = await options.resolveGlobalConfig();

    // Round-robin fair scheduling across bots respecting global & per-bot limits.
    let scanned = 0;
    while (inFlight.size < globalConfig.maxConcurrentWorkers && queueBotOrder.length > 0 && scanned < queueBotOrder.length) {
      if (rrCursor >= queueBotOrder.length) rrCursor = 0;
      const botId = queueBotOrder[rrCursor];
      if (!botId) break;
      const list = queueByBot.get(botId);
      if (!list || list.length === 0) {
        queueByBot.delete(botId);
        queueBotOrder.splice(rrCursor, 1);
        continue;
      }

      const bot = options.getBot(botId);
      if (!bot) {
        queueByBot.delete(botId);
        queueBotOrder.splice(rrCursor, 1);
        continue;
      }
      const botConfig = await options.resolveBotConfig(bot);
      if (botInFlightCount(botId) >= botConfig.maxConcurrentWorkers) {
        rrCursor = (rrCursor + 1) % queueBotOrder.length;
        scanned++;
        continue;
      }

      let pickedTaskId: string | undefined;
      for (let i = 0; i < list.length; i++) {
        const candidateId = list[i];
        if (!candidateId) continue;
        const task = options.store.getTask(candidateId);
        if (!task || task.status !== "queued") {
          list.splice(i, 1);
          i--;
          continue;
        }
        if (task.isolationMode === "serial_lock" && dirLocks.has(dirKey(task.workspaceRoot))) {
          continue;
        }
        list.splice(i, 1);
        pickedTaskId = candidateId;
        break;
      }

      if (list.length === 0) {
        queueByBot.delete(botId);
        queueBotOrder.splice(rrCursor, 1);
        if (rrCursor >= queueBotOrder.length) rrCursor = 0;
      } else {
        rrCursor = (rrCursor + 1) % queueBotOrder.length;
      }

      if (!pickedTaskId) {
        scanned++;
        continue;
      }

      scanned = 0;
      inFlightByBot.set(botId, botInFlightCount(botId) + 1);
      const work = runWorker(pickedTaskId, bot, botConfig).finally(() => {
        inFlight.delete(work);
        const prev = botInFlightCount(botId);
        if (prev <= 1) inFlightByBot.delete(botId);
        else inFlightByBot.set(botId, prev - 1);
        if (!closed) void schedule();
      });
      inFlight.add(work);
    }
  }

  return {
    get activeCount() { return active.size; },
    get queuedCount() { return totalQueuedCount(); },
    activeCountForBot(botId) {
      let count = 0;
      for (const entry of active.values()) {
        if (entry.botId === botId) count++;
      }
      return count;
    },
    queuedCountForBot(botId) {
      return queueByBot.get(botId)?.length ?? 0;
    },
    hasActiveOrQueuedForBot(botId) {
      if (botInFlightCount(botId) > 0) return true;
      if ((queueByBot.get(botId)?.length ?? 0) > 0) return true;
      for (const entry of active.values()) {
        if (entry.botId === botId) return true;
      }
      return false;
    },
    async dispatch(input) {
      if (closed) return fail(503, "SERVER_STOPPING");
      const botConfig = await options.resolveBotConfig(input.bot);
      const workerModel = botConfig.worker;
      if (!workerModel) return fail(409, "MODEL_REQUIRED");

      const project = options.registry.configs.get(input.bot.projectId);
      if (!project) return fail(409, "BOT_PROJECT_UNAVAILABLE");

      const taskId = `tsk_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
      const shortId = randomBytes(4).toString("hex");
      const accessMode: BotTaskAccessMode = input.accessMode ?? "write";
      const title = (input.title?.trim() || input.goal.replace(/\s+/g, " ").trim().slice(0, 64)) || `Task ${shortId}`;

      const allocation = await allocateWorkspace({
        projectId: input.bot.projectId,
        workspaceRoot: project.workspaceRoot,
        taskShortId: shortId,
        accessMode,
        worktreeBaseDir: botConfig.global.worktreeRoot,
      });

      const now = new Date().toISOString();
      const workerSessionId = randomUUID();
      const task: BotTaskRecord = {
        id: taskId,
        botId: input.bot.id,
        shortId,
        title,
        goal: input.goal.trim(),
        projectId: input.bot.projectId,
        workspaceRoot: project.workspaceRoot,
        accessMode,
        isolationMode: allocation.isolationMode,
        ...(allocation.worktreePath ? { worktreePath: allocation.worktreePath } : {}),
        ...(allocation.worktreeBranch ? { worktreeBranch: allocation.worktreeBranch } : {}),
        ...(allocation.baseCommit ? { baseCommit: allocation.baseCommit } : {}),
        mainRepoDirtyAtStart: allocation.mainRepoDirtyAtStart,
        worktreeState: allocation.isolationMode === "git_worktree" ? "active" : "none",
        workerSessionId,
        workerModelId: workerModel.modelId,
        status: "queued",
        ...(input.originTriggerId ? { originTriggerId: input.originTriggerId } : {}),
        createdAt: now,
        updatedAt: now,
      };

      options.store.createTask(task);
      executionDirs.set(taskId, allocation.executionCwd);
      if (input.originTriggerId) options.store.addLink(input.bot.id, input.originTriggerId, task.id, "spawned");
      if (input.threadId) {
        options.store.addLink(input.bot.id, task.id, input.threadId, "belongs_to");
        options.store.subscribeThread(input.bot.id, input.threadId, task.id);
      }

      enqueueTask(input.bot.id, task.id);
      options.onChanged(input.bot.id);
      void schedule();
      return task;
    },
    async steerTask(botId, taskIdOrShort, instruction) {
      const task = lookupOwnedTask(botId, taskIdOrShort);
      if (!task) return { ok: false, reason: "TASK_NOT_FOUND" };
      const worker = active.get(task.id);
      if (!worker) return { ok: false, reason: "TASK_NOT_RUNNING" };
      if (!worker.chat.steer) return { ok: false, reason: "CANNOT_STEER" };
      if (worker.chat.canSteer) {
        void worker.chat.steer(instruction).catch(() => undefined);
        return { ok: true };
      }
      worker.pendingSteers.push(instruction);
      return { ok: true };
    },
    async cancelTask(botId, taskIdOrShort, cleanup = false) {
      const task = lookupOwnedTask(botId, taskIdOrShort);
      if (!task) return fail(404, "TASK_NOT_FOUND");
      removeQueuedTask(botId, task.id);
      const worker = active.get(task.id);
      clearApprovalFor(task.id);
      if (worker) {
        worker.chat.cancel();
      }
      let worktreeState = task.worktreeState;
      if (cleanup && task.isolationMode === "git_worktree" && task.worktreePath) {
        if (worker?.promise) await worker.promise.catch(() => undefined);
        const repo = await inspectRepo(task.workspaceRoot);
        if (repo.isGitRepo && repo.repoRoot) {
          await cleanupWorktree(repo.repoRoot, task.worktreePath, task.worktreeBranch, true);
        }
        worktreeState = "cleaned";
      }
      const updated = options.store.updateTask(task.id, {
        status: "cancelled",
        worktreeState,
        finishedAt: new Date().toISOString(),
      }) ?? task;
      options.onChanged(botId);
      return updated;
    },
    async cancelAllForBot(botId, cleanup = false) {
      const queued = [...(queueByBot.get(botId) ?? [])];
      for (const taskId of queued) {
        removeQueuedTask(botId, taskId);
        options.store.updateTask(taskId, { status: "cancelled", finishedAt: new Date().toISOString() });
      }
      const running = [...active.values()].filter(entry => entry.botId === botId);
      for (const entry of running) {
        clearApprovalFor(entry.taskId);
        entry.chat.cancel();
      }
      await Promise.all(running.map(entry => entry.promise?.catch(() => undefined)));
      if (cleanup) {
        for (const task of options.store.listUnmergedWorktreeTasks(botId)) {
          if (task.worktreePath) {
            const repo = await inspectRepo(task.workspaceRoot);
            if (repo.isGitRepo && repo.repoRoot) {
              await cleanupWorktree(repo.repoRoot, task.worktreePath, task.worktreeBranch, true);
            }
            options.store.updateTask(task.id, { worktreeState: "cleaned" });
          }
        }
      }
    },
    answerApproval(botId, approvalId, taskIdOrShort, allow) {
      const pending = approvals.get(approvalId);
      const task = lookupOwnedTask(botId, taskIdOrShort);
      if (!pending || !task || pending.taskId !== task.id || pending.botId !== botId) {
        return fail(409, "STALE_APPROVAL");
      }
      const worker = active.get(task.id);
      if (!worker || worker.approvalId !== approvalId) {
        approvals.delete(approvalId);
        return fail(409, "STALE_APPROVAL");
      }
      approvals.delete(approvalId);
      worker.approvalId = undefined;
      worker.approvalCreatedAt = undefined;
      options.store.updateTask(task.id, { status: "running" });
      worker.chat.answerApproval(allow);
      options.onChanged(botId);
    },
    listApprovals(botId) {
      const items = [...approvals.values()];
      return botId ? items.filter(item => item.botId === botId) : items;
    },
    getActiveMetrics() {
      return [...active.values()].map(item => ({
        botId: item.botId,
        taskId: item.taskId,
        startedAt: item.startedAt,
        ...(item.approvalCreatedAt !== undefined ? { approvalCreatedAt: item.approvalCreatedAt } : {}),
        ...(item.approvalId ? { approvalId: item.approvalId } : {}),
      }));
    },
    async getTaskDiff(botId, taskIdOrShort) {
      const task = lookupOwnedTask(botId, taskIdOrShort);
      if (!task) return fail(404, "TASK_NOT_FOUND");
      return collectWorktreeDiff(task);
    },
    async applyTask(botId, taskIdOrShort, applyOptions) {
      const task = lookupOwnedTask(botId, taskIdOrShort);
      if (!task) return fail(404, "TASK_NOT_FOUND");
      if (active.has(task.id) || task.status === "queued" || task.status === "running" || task.status === "awaiting_approval") {
        return fail(409, "TASK_BUSY");
      }
      const result = await applyWorktreeChanges(task, applyOptions);
      if (result.applied) {
        options.store.updateTask(task.id, { worktreeState: result.worktreeState });
        options.onChanged(botId);
      }
      return result;
    },
    async discardTask(botId, taskIdOrShort) {
      const task = lookupOwnedTask(botId, taskIdOrShort);
      if (!task) return fail(404, "TASK_NOT_FOUND");
      if (active.has(task.id)) return fail(409, "TASK_BUSY");
      if (task.isolationMode === "git_worktree" && task.worktreePath) {
        const repo = await inspectRepo(task.workspaceRoot);
        if (repo.isGitRepo && repo.repoRoot) {
          await cleanupWorktree(repo.repoRoot, task.worktreePath, task.worktreeBranch, true);
        }
      }
      const updated = options.store.updateTask(task.id, { worktreeState: "cleaned" }) ?? task;
      options.onChanged(botId);
      return updated;
    },
    async getTaskSession(botId, taskIdOrShort) {
      const task = lookupOwnedTask(botId, taskIdOrShort);
      if (!task) return fail(404, "TASK_NOT_FOUND");
      const liveWorker = active.get(task.id);
      if (liveWorker) {
        return {
          botId,
          taskId: task.id,
          sessionId: liveWorker.chat.sessionId,
          modelId: liveWorker.chat.modelId,
          workspaceRoot: task.worktreePath ?? task.workspaceRoot,
          live: true,
          busy: liveWorker.chat.state.busy,
          canSteer: Boolean(liveWorker.chat.canSteer),
          messages: liveWorker.chat.state.messages,
        };
      }
      const sessionStore = await createSqliteSessionStore({ filename: options.databasePath });
      try {
        const saved = await sessionStore.read({ namespace: botWorkerNamespace(botId), id: task.workerSessionId });
        const messages = saved ? restoreMessages(saved.data) : [];
        return {
          botId,
          taskId: task.id,
          sessionId: task.workerSessionId,
          modelId: task.workerModelId,
          workspaceRoot: task.worktreePath ?? task.workspaceRoot,
          live: false,
          busy: false,
          canSteer: false,
          messages,
        };
      } finally {
        await sessionStore.close();
      }
    },
    async close() {
      closed = true;
      queueByBot.clear();
      queueBotOrder.length = 0;
      const entries = [...active.values()];
      for (const entry of entries) {
        entry.chat.cancel();
      }
      await Promise.all([...inFlight].map(work => work.catch(() => undefined)));
      for (const entry of [...active.values()]) {
        entry.unsubscribe();
        await entry.chat.close().catch(() => undefined);
      }
      active.clear();
      inFlightByBot.clear();
      approvals.clear();
      dirLocks.clear();
      executionDirs.clear();
    },
  };
}

export function projectSummaryName(workspaceRoot: string, projectName?: string): string {
  return projectName || basename(workspaceRoot) || workspaceRoot;
}
