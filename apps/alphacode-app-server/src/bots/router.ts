import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { createAgent, type Agent, type JsonObject, type Tool, type ToolInfo } from "@alpha/adk/core";
import { createContextManager } from "@alpha/adk-context";
import { createSqliteContextStore } from "@alpha/adk-context/sqlite";
import { createSessionManager, createSessionPlugin, type Session, type SessionManager, type SessionStore } from "@alpha/adk-session";
import { createSqliteSessionStore } from "@alpha/adk-session/sqlite";
import { createTracePlugin } from "@alpha/adk-trace";
import { createProvider, type CreateProviderOptions } from "@alpha/provider";
import type { ChatMessage, ChatPhase, ContextUsage } from "../chat/contracts";
import type { AppConfig } from "../config";
import { modelContext } from "../runtime/context-usage";
import { subscribeToAgent } from "../runtime/events";
import { restoreMessages } from "../runtime/history";
import type { RuntimeTrace } from "../runtime/trace-bridge";
import type { createRegistry } from "../server/storage";
import type {
  BotRecord,
  BotRouterStateView,
  BotTaskAccessMode,
  BotTriggerRecord,
} from "./contracts";
import type { ResolvedBotRuntimeConfig } from "./config-resolver";
import { botMainThreadId } from "./event-bus";
import type { BotsStore } from "./store";
import { projectSummaryName, type BotWorkerPool } from "./worker-pool";

export const botRouterAgentKey = "alphacode-bot-router-v1";

export function botRouterNamespace(botId: string): string {
  return `bot:router:${botId}`;
}

const maxBatchSize = 12;
const maxBatchBytes = 24 * 1024;
const maxRecallBytes = 4096;

function defineRouterTool(spec: {
  name: string;
  description: string;
  effect: ToolInfo["effect"];
  inputSchema: JsonObject;
  validate: (raw: JsonObject) => JsonObject;
  execute: (args: JsonObject) => Promise<string> | string;
}): Tool<undefined> {
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
        execute: () => spec.execute(validated),
      });
    },
  });
}

function asOptionalString(value: unknown, maxLen = 4000): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw Object.assign(new Error("TOOL_INPUT_INVALID"), { code: "TOOL_INPUT_INVALID" });
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLen) throw Object.assign(new Error("TOOL_INPUT_INVALID"), { code: "TOOL_INPUT_INVALID" });
  return trimmed;
}

function asRequiredString(value: unknown, maxLen = 20000): string {
  const parsed = asOptionalString(value, maxLen);
  if (!parsed) throw Object.assign(new Error("TOOL_INPUT_INVALID"), { code: "TOOL_INPUT_INVALID" });
  return parsed;
}

function buildBotRouterInstructions(bot: BotRecord, projectName: string, workspaceRoot?: string): string {
  const lines = [
    `You are "${bot.name}", a permanent Super-agent Bot in AlphaCode (Router Layer).`,
    `Bound working project: ${projectName}${workspaceRoot ? ` (${workspaceRoot})` : ""} (projectId: ${bot.projectId}).`,
  ];
  if (bot.instructions.trim()) {
    lines.push("", "Role & Instructions:", bot.instructions.trim());
  }
  lines.push(
    "",
    "Core orchestration rules:",
    "1. You NEVER execute code edits, file reads, or shell commands directly. Always delegate concrete coding, research, and file tasks in your bound project via dispatch_task.",
    "2. dispatch_task returns immediately after starting an isolated background Worker (git worktree for write tasks, zero-copy readonly for research). Acknowledge concisely so the user can keep talking without waiting.",
    "3. Keep replies concise, calm, and structured. Do not dump internal tool logs; summarize conclusions, branch names, and next actions clearly.",
    "4. Use list_state to inspect active/recent tasks and pending approvals, steer_task/cancel_task to guide or stop running workers, and recall_object to inspect referenced triggers, threads, tasks, or diff artifacts on demand.",
    "5. Respond in the user's language.",
  );
  return lines.join("\n");
}

export interface BotRouter {
  readonly busy: boolean;
  ready(): Promise<void>;
  snapshot(): BotRouterStateView;
  schedule(): void;
  markConfigDirty(): void;
  cancel(): void;
  close(): Promise<void>;
}

export function createBotRouter(options: {
  botId: string;
  databasePath: string;
  registry: Awaited<ReturnType<typeof createRegistry>>;
  store: BotsStore;
  workerPool: BotWorkerPool;
  getBot: () => BotRecord | undefined;
  resolveBotConfig: (bot: BotRecord) => Promise<ResolvedBotRuntimeConfig>;
  providerForRole?: (role: "router" | "worker", config: AppConfig, botId: string) => CreateProviderOptions | undefined;
  trace?: RuntimeTrace;
  onChanged: () => void;
}): BotRouter {
  const namespace = botRouterNamespace(options.botId);
  const mainThread = botMainThreadId(options.botId);
  let sessionId = options.getBot()?.routerSessionId ?? "main";
  let sessionStore: SessionStore | undefined;
  let manager: SessionManager | undefined;
  let session: Session | undefined;
  let agent: Agent<undefined> | undefined;
  let detachAgent: (() => void) | undefined;
  let detachTrace: (() => void) | undefined;
  let contextStore: ReturnType<typeof createSqliteContextStore> | undefined;
  let contextManager: ReturnType<typeof createContextManager> | undefined;
  let activeModelId: string | undefined;
  let activeFingerprint: string | undefined;
  let contextUsage: ContextUsage | undefined;
  let messages: ChatMessage[] = [];
  let phase: ChatPhase = "idle";
  let running = false;
  let scheduled = false;
  let configDirty = false;
  let closed = false;
  let errorText: string | undefined;
  let activeBatchTriggers: BotTriggerRecord[] = [];
  let activeRun: Promise<void> | undefined;
  let streamingMessage: ChatMessage | undefined;

  function recallObject(objectId: string): Record<string, unknown> {
    const links = options.store.getLinks(options.botId, objectId).map(link => ({
      relation: link.relation,
      target: link.fromId === objectId ? link.toId : link.fromId,
    }));
    if (objectId.startsWith("tsk_") || !objectId.includes("_")) {
      const task = options.store.getTask(objectId) ?? options.store.getTaskByShortId(objectId);
      if (!task || task.botId !== options.botId) return { ok: false, code: "OBJECT_NOT_FOUND", objectId };
      return {
        ok: true,
        type: "task",
        id: task.id,
        shortId: task.shortId,
        title: task.title,
        goal: task.goal.slice(0, 600),
        projectId: task.projectId,
        workspaceRoot: task.workspaceRoot,
        accessMode: task.accessMode,
        isolationMode: task.isolationMode,
        worktreeBranch: task.worktreeBranch,
        worktreeState: task.worktreeState,
        diffArtifactRef: task.diffArtifactRef,
        status: task.status,
        resultSummary: task.resultSummary,
        links,
      };
    }
    if (objectId.startsWith("trg_")) {
      const trigger = options.store.getTrigger(options.botId, objectId);
      if (!trigger) return { ok: false, code: "OBJECT_NOT_FOUND", objectId };
      return { ok: true, type: "trigger", ...trigger, links };
    }
    if (objectId.startsWith("thr_")) {
      const thread = options.store.getThread(objectId);
      if (!thread || thread.botId !== options.botId) return { ok: false, code: "OBJECT_NOT_FOUND", objectId };
      const recent = options.store.listRecentThreadTriggers(options.botId, thread.id, 6).map(item => ({
        id: item.id, source: item.source, actor: item.actor, summary: item.summary, createdAt: item.createdAt,
      }));
      return { ok: true, type: "thread", ...thread, recentTriggers: recent, links };
    }
    if (objectId.startsWith("art_")) {
      const payload = options.store.getPayload(options.botId, objectId);
      if (payload === undefined) return { ok: false, code: "OBJECT_NOT_FOUND", objectId };
      const truncated = Buffer.byteLength(payload, "utf8") > maxRecallBytes;
      const content = truncated ? Buffer.from(payload, "utf8").subarray(0, maxRecallBytes).toString("utf8") : payload;
      return { ok: true, type: "artifact", id: objectId, content, truncated, links };
    }
    return { ok: false, code: "UNSUPPORTED_OBJECT_ID", objectId };
  }

  function buildTools(): Tool<undefined>[] {
    return [
      defineRouterTool({
        name: "dispatch_task",
        description: "Dispatch an isolated background Worker Agent inside this bot's bound project for coding, research, or file work. Returns immediately once started.",
        effect: "write",
        inputSchema: {
          type: "object",
          properties: {
            goal: { type: "string", description: "Clear, self-contained task objective for the Worker." },
            title: { type: "string", description: "Short human-readable task title." },
            accessMode: { type: "string", enum: ["readonly", "write"], description: "Use 'readonly' for inspection/research and 'write' for edits/tests (uses git worktree)." },
            threadId: { type: "string", description: "Optional threadId within this bot to associate and subscribe." },
          },
          required: ["goal"],
        },
        validate(raw) {
          const goal = asRequiredString(raw.goal, 20000);
          const title = asOptionalString(raw.title, 200);
          const threadId = asOptionalString(raw.threadId, 128);
          const accessMode = raw.accessMode === undefined ? "write" : raw.accessMode;
          if (accessMode !== "readonly" && accessMode !== "write") {
            throw Object.assign(new Error("TOOL_INPUT_INVALID"), { code: "TOOL_INPUT_INVALID" });
          }
          return {
            goal,
            ...(title ? { title } : {}),
            ...(threadId ? { threadId } : {}),
            accessMode,
          };
        },
        async execute(args) {
          const bot = options.getBot();
          if (!bot) return JSON.stringify({ ok: false, code: "BOT_NOT_FOUND" });
          const origin = activeBatchTriggers.find(t => t.source === "user_chat") ?? activeBatchTriggers[0];
          const task = await options.workerPool.dispatch({
            bot,
            goal: String(args.goal),
            title: args.title ? String(args.title) : undefined,
            accessMode: (args.accessMode as BotTaskAccessMode) ?? "write",
            originTriggerId: origin?.id,
            threadId: args.threadId ? String(args.threadId) : (origin?.threadId ?? mainThread),
          });
          return JSON.stringify({
            ok: true,
            status: "started",
            taskId: task.id,
            shortId: task.shortId,
            title: task.title,
            projectId: task.projectId,
            accessMode: task.accessMode,
            isolationMode: task.isolationMode,
            ...(task.worktreeBranch ? { worktreeBranch: task.worktreeBranch } : {}),
            mainRepoDirtyAtStart: task.mainRepoDirtyAtStart,
          });
        },
      }),
      defineRouterTool({
        name: "steer_task",
        description: "Send mid-flight guidance or course correction to a running background Worker owned by this bot.",
        effect: "write",
        inputSchema: {
          type: "object",
          properties: {
            taskId: { type: "string", description: "Task ID or shortId." },
            instruction: { type: "string", description: "Additional guidance or correction." },
          },
          required: ["taskId", "instruction"],
        },
        validate(raw) {
          return {
            taskId: asRequiredString(raw.taskId, 128),
            instruction: asRequiredString(raw.instruction, 8000),
          };
        },
        async execute(args) {
          const res = await options.workerPool.steerTask(options.botId, String(args.taskId), String(args.instruction));
          return JSON.stringify(res);
        },
      }),
      defineRouterTool({
        name: "cancel_task",
        description: "Cancel a queued or running background Worker task owned by this bot.",
        effect: "write",
        inputSchema: {
          type: "object",
          properties: {
            taskId: { type: "string" },
            cleanupWorktree: { type: "boolean" },
          },
          required: ["taskId"],
        },
        validate(raw) {
          const taskId = asRequiredString(raw.taskId, 128);
          const cleanupWorktree = raw.cleanupWorktree === undefined ? false : Boolean(raw.cleanupWorktree);
          return { taskId, cleanupWorktree };
        },
        async execute(args) {
          const task = await options.workerPool.cancelTask(options.botId, String(args.taskId), Boolean(args.cleanupWorktree));
          return JSON.stringify({ ok: true, taskId: task.id, status: task.status, worktreeState: task.worktreeState });
        },
      }),
      defineRouterTool({
        name: "list_state",
        description: "List this bot's bound project, active/recent background tasks, and pending approvals.",
        effect: "read",
        inputSchema: { type: "object", properties: {} },
        validate() { return {}; },
        execute() {
          const bot = options.getBot();
          const projectCfg = bot ? options.registry.configs.get(bot.projectId) : undefined;
          const project = bot ? {
            projectId: bot.projectId,
            name: projectCfg ? projectSummaryName(projectCfg.workspaceRoot, projectCfg.projectName) : bot.projectId,
            workspaceRoot: projectCfg?.workspaceRoot,
            missing: !projectCfg,
          } : undefined;
          const tasks = options.store.listTasksByBot(options.botId, 25).map(t => ({
            id: t.id,
            shortId: t.shortId,
            title: t.title,
            projectId: t.projectId,
            status: t.status,
            isolationMode: t.isolationMode,
            worktreeBranch: t.worktreeBranch,
            worktreeState: t.worktreeState,
            diffArtifactRef: t.diffArtifactRef,
          }));
          const approvals = options.workerPool.listApprovals(options.botId).map(a => ({
            approvalId: a.approvalId,
            taskId: a.taskId,
            taskShortId: a.taskShortId,
            taskTitle: a.taskTitle,
            tool: a.request.name,
          }));
          return JSON.stringify({ ok: true, project, tasks, approvals });
        },
      }),
      defineRouterTool({
        name: "recall_object",
        description: "Chain-of-Recall lookup by object ID (tsk_..., trg_..., thr_..., art_...) within this bot. Returns inline summary and next-hop linked IDs.",
        effect: "read",
        inputSchema: {
          type: "object",
          properties: {
            objectId: { type: "string", description: "Object identifier or task shortId." },
          },
          required: ["objectId"],
        },
        validate(raw) {
          return { objectId: asRequiredString(raw.objectId, 200) };
        },
        execute(args) {
          return JSON.stringify(recallObject(String(args.objectId)));
        },
      }),
      defineRouterTool({
        name: "subscribe_thread",
        description: "Subscribe one of this bot's Worker tasks to receive future events on a Thread directly.",
        effect: "write",
        inputSchema: {
          type: "object",
          properties: {
            threadId: { type: "string" },
            taskId: { type: "string" },
          },
          required: ["threadId", "taskId"],
        },
        validate(raw) {
          return { threadId: asRequiredString(raw.threadId, 128), taskId: asRequiredString(raw.taskId, 128) };
        },
        execute(args) {
          const task = options.store.getTask(String(args.taskId)) ?? options.store.getTaskByShortId(String(args.taskId));
          if (!task || task.botId !== options.botId) return JSON.stringify({ ok: false, code: "TASK_NOT_FOUND" });
          options.store.ensureThread({ id: String(args.threadId), botId: options.botId });
          options.store.subscribeThread(options.botId, String(args.threadId), task.id);
          return JSON.stringify({ ok: true, threadId: String(args.threadId), taskId: task.id });
        },
      }),
      defineRouterTool({
        name: "unsubscribe_thread",
        description: "Unsubscribe one of this bot's Worker tasks from a Thread.",
        effect: "write",
        inputSchema: {
          type: "object",
          properties: {
            threadId: { type: "string" },
            taskId: { type: "string" },
          },
          required: ["threadId", "taskId"],
        },
        validate(raw) {
          return { threadId: asRequiredString(raw.threadId, 128), taskId: asRequiredString(raw.taskId, 128) };
        },
        execute(args) {
          const task = options.store.getTask(String(args.taskId)) ?? options.store.getTaskByShortId(String(args.taskId));
          if (!task || task.botId !== options.botId) return JSON.stringify({ ok: false, code: "TASK_NOT_FOUND" });
          options.store.unsubscribeThread(String(args.threadId), task.id);
          return JSON.stringify({ ok: true, threadId: String(args.threadId), taskId: task.id });
        },
      }),
    ];
  }

  async function ensureSessionAndAgent(bot: BotRecord, config: ResolvedBotRuntimeConfig): Promise<{ agent: Agent<undefined>; session: Session }> {
    const routerRole = config.router;
    if (!routerRole) {
      throw Object.assign(new Error("MODEL_REQUIRED"), { code: "MODEL_REQUIRED" });
    }
    sessionId = bot.routerSessionId || "main";
    if (!sessionStore) {
      await mkdir(dirname(options.databasePath), { recursive: true });
      sessionStore = await createSqliteSessionStore({ filename: options.databasePath });
    }
    if (!manager) {
      manager = createSessionManager({ store: sessionStore, namespace, agentKey: botRouterAgentKey });
    }
    if (!session) {
      const saved = await sessionStore.read({ namespace, id: sessionId });
      if (saved) {
        session = await manager.openSession(sessionId);
        if (messages.length === 0) {
          const snap = await session.getSnapshot();
          messages = restoreMessages(snap.data);
        }
      } else {
        session = await manager.createSession({ id: sessionId, title: bot.name });
      }
    }

    const projectCfg = options.registry.configs.get(bot.projectId);
    const projectName = projectCfg ? projectSummaryName(projectCfg.workspaceRoot, projectCfg.projectName) : bot.projectId;
    const instructions = buildBotRouterInstructions(bot, projectName, projectCfg?.workspaceRoot);
    const fingerprint = JSON.stringify({
      modelId: routerRole.modelId,
      baseURL: routerRole.baseURL,
      apiKeyEnv: routerRole.apiKeyEnv,
      noAuth: routerRole.noAuth,
      contextWindow: routerRole.contextWindow,
      maxOutputTokens: routerRole.maxOutputTokens,
      instructions,
    });

    if (agent && !configDirty && activeFingerprint === fingerprint) {
      return { agent, session };
    }

    // Hot-swap Router model/instructions safely while preserving the exact same permanent Session.
    if (agent) {
      detachAgent?.();
      detachAgent = undefined;
      detachTrace?.();
      detachTrace = undefined;
      await agent.close().catch(() => undefined);
      agent = undefined;
    }

    contextUsage = modelContext(routerRole.modelId, routerRole.contextWindow);
    if (!contextStore) {
      try { contextStore = createSqliteContextStore(`${options.databasePath}.context.db`); } catch { /* Optional derived cache. */ }
    }
    contextManager = createContextManager({
      namespace,
      sessionId,
      contextWindow: contextUsage.contextWindow,
      maxOutputTokens: routerRole.maxOutputTokens,
      auto: config.global.defaults.autoCompact,
      store: contextStore,
      onEvent(event) {
        if (event.type === "usage" && contextUsage) {
          contextUsage = {
            ...contextUsage,
            tokens: event.tokens,
            inputBudget: event.inputBudget,
            maxOutputTokens: event.maxOutputTokens,
            automatic: event.automatic,
          };
          options.onChanged();
        }
      },
    });
    await contextManager.load().catch(() => undefined);

    const syntheticAppConfig: AppConfig = {
      workspaceRoot: projectCfg?.workspaceRoot ?? config.global.configDirectory,
      databasePath: options.databasePath,
      configDirectory: config.global.configDirectory,
      modelId: routerRole.modelId,
      baseURL: routerRole.baseURL,
      apiKeyEnv: routerRole.apiKeyEnv,
      noAuth: routerRole.noAuth,
      contextWindow: routerRole.contextWindow,
      maxOutputTokens: routerRole.maxOutputTokens,
    };

    const providerOptions = options.providerForRole?.("router", syntheticAppConfig, options.botId) ?? {
      getEnv: (name: string) => {
        if (name === routerRole.apiKeyEnv) {
          const projectCred = options.registry.credentials.get(bot.projectId);
          if (projectCred) return projectCred;
          for (const cred of options.registry.credentials.values()) {
            if (cred) return cred;
          }
        }
        return process.env[name];
      },
    };

    const model = createProvider({
      providers: {
        main: {
          adapter: "openai-completions",
          options: {
            baseURL: routerRole.baseURL,
            apiKey: routerRole.noAuth ? { none: true } : { env: routerRole.apiKeyEnv },
          },
          models: { chat: { id: routerRole.modelId } },
        },
      },
    }, providerOptions).use("main", "chat");

    const created = await createAgent<undefined>({
      model,
      instructions,
      tools: buildTools(),
      limits: {
        maxModelCalls: 12,
        maxToolCalls: 24,
        timeoutMs: undefined,
        maxHistoryMessages: null,
        maxHistoryBytes: null,
      },
      plugins: [
        createSessionPlugin({ session }),
        contextManager.plugin<undefined>(),
        ...(options.trace ? [createTracePlugin<undefined>({ service: options.trace.service, scope: { namespace, sessionId } })] : []),
      ],
    });

    detachTrace = options.trace?.bind({ namespace, sessionId }, created, session);
    detachAgent = subscribeToAgent(created, event => {
      if (event.type === "assistant.start") {
        streamingMessage = { id: event.id, role: "assistant", text: "", streaming: true };
        messages = [...messages, streamingMessage];
        options.onChanged();
      } else if (event.type === "assistant.delta" && streamingMessage && streamingMessage.id === event.id) {
        streamingMessage = { ...streamingMessage, text: streamingMessage.text + event.text };
        messages = [...messages.slice(0, -1), streamingMessage];
        options.onChanged();
      } else if (event.type === "assistant.commit") {
        const committed: ChatMessage = {
          id: event.id,
          sourceId: event.sourceId,
          role: "assistant",
          text: event.text,
          streaming: false,
        };
        if (streamingMessage && streamingMessage.id === event.id) {
          messages = [...messages.slice(0, -1), committed];
        } else {
          messages = [...messages, committed];
        }
        streamingMessage = undefined;
        options.onChanged();
      } else if (event.type === "assistant.end") {
        if (streamingMessage && streamingMessage.id === event.id) {
          messages = [...messages.slice(0, -1), { ...streamingMessage, streaming: false }];
          streamingMessage = undefined;
          options.onChanged();
        }
      }
    });

    agent = created;
    activeModelId = routerRole.modelId;
    activeFingerprint = fingerprint;
    configDirty = false;
    return { agent: created, session };
  }

  function dequeueBatch(): BotTriggerRecord[] {
    const candidates = options.store.listPendingTriggers(options.botId, maxBatchSize);
    const selected: BotTriggerRecord[] = [];
    let bytes = 0;
    for (const item of candidates) {
      const size = Buffer.byteLength(item.summary, "utf8") + 160;
      if (selected.length > 0 && bytes + size > maxBatchBytes) break;
      selected.push(item);
      bytes += size;
    }
    return selected;
  }

  function formatBatchPrompt(batch: readonly BotTriggerRecord[]): string {
    const first = batch[0];
    if (batch.length === 1 && first?.source === "user_chat") {
      const full = first.payloadRef ? options.store.getPayload(options.botId, first.payloadRef) ?? first.summary : first.summary;
      return full;
    }
    const lines = ["[Trigger Batch] Handle the following events concisely in one coordinated response:"];
    for (const item of batch) {
      const links = options.store.getLinks(options.botId, item.id).slice(0, 4).map(l => `${l.relation}:${l.fromId === item.id ? l.toId : l.fromId}`);
      const full = item.source === "user_chat" && item.payloadRef
        ? (options.store.getPayload(options.botId, item.payloadRef) ?? item.summary)
        : item.summary;
      lines.push(`- id=${item.id} thread=${item.threadId} source=${item.source} kind=${item.kind} actor=${item.actor}${item.payloadRef ? ` payloadRef=${item.payloadRef}` : ""}${links.length ? ` links=[${links.join(",")}]` : ""}`);
      lines.push(`  summary: ${full}`);
    }
    return lines.join("\n");
  }

  async function processLoop() {
    if (running || closed) return;
    running = true;
    errorText = undefined;
    try {
      await hydrating.catch(() => undefined);
      while (!closed) {
        const batch = dequeueBatch();
        if (batch.length === 0) break;
        const bot = options.getBot();
        if (!bot) break;

        activeBatchTriggers = batch;
        options.store.markTriggersStatus(batch.map(t => t.id), "batched");
        phase = "thinking";
        for (const item of batch) {
          if (item.source === "user_chat") {
            const display = item.payloadRef ? (options.store.getPayload(options.botId, item.payloadRef) ?? item.summary) : item.summary;
            messages = [...messages, { id: item.id, role: "user", text: display }];
          }
        }
        options.onChanged();

        try {
          const config = await options.resolveBotConfig(bot);
          const { agent: activeAgent, session: activeSession } = await ensureSessionAndAgent(bot, config);
          const prompt = formatBatchPrompt(batch);
          const firstId = batch[0]?.id ?? "batch";
          const requestId = `bot-router-${options.botId.slice(0, 12)}-${firstId}-${randomUUID().slice(0, 8)}`;
          phase = "running";
          options.onChanged();
          const result = await activeAgent.prompt(prompt, { requestId });
          if (result.status === "failed") {
            errorText = result.error.code;
          }
          if (activeSession.state.persistence?.status === "saved" && contextManager) {
            const snap = await activeSession.getSnapshot();
            await contextManager.persist(snap.data.turns.flatMap(turn => [...turn.messages])).catch(() => undefined);
          }
          options.store.markTriggersStatus(batch.map(t => t.id), "processed");
        } catch (error) {
          errorText = (error as { code?: string })?.code ?? (error instanceof Error ? error.message : "ROUTER_FAILED");
          options.store.markTriggersStatus(batch.map(t => t.id), "processed");
        } finally {
          activeBatchTriggers = [];
          streamingMessage = undefined;
          phase = "idle";
          options.onChanged();
        }
      }
    } finally {
      running = false;
      scheduled = false;
      phase = "idle";
      options.onChanged();
      if (!closed && options.store.countPendingTriggers(options.botId) > 0) {
        schedule();
      }
    }
  }

  function schedule() {
    if (closed || running || scheduled) return;
    scheduled = true;
    activeRun = Promise.resolve().then(() => processLoop()).finally(() => {
      activeRun = undefined;
    });
  }

  // Hydrate previously persisted messages on startup without requiring model credentials.
  const hydrating = (async () => {
    try {
      const store = await createSqliteSessionStore({ filename: options.databasePath });
      try {
        const saved = await store.read({ namespace, id: sessionId });
        if (saved && !closed && messages.length === 0) {
          messages = restoreMessages(saved.data);
          options.onChanged();
        }
      } finally {
        await store.close();
      }
    } catch { /* Empty database on first launch. */ }
  })();

  return {
    get busy() {
      return running || scheduled || options.store.countPendingTriggers(options.botId) > 0;
    },
    ready() {
      return hydrating.catch(() => undefined);
    },
    snapshot() {
      return {
        sessionId,
        ...(activeModelId ? { modelId: activeModelId } : {}),
        phase,
        busy: running,
        canSend: !closed,
        canSteer: Boolean(running && agent?.state.canSteer),
        pendingTriggerCount: options.store.countPendingTriggers(options.botId),
        ...(contextUsage ? { contextUsage } : {}),
        messages,
        ...(errorText ? { error: errorText } : {}),
      };
    },
    schedule,
    markConfigDirty() {
      configDirty = true;
    },
    cancel() {
      agent?.abort();
    },
    async close() {
      closed = true;
      agent?.abort();
      await hydrating.catch(() => undefined);
      await activeRun?.catch(() => undefined);
      detachAgent?.();
      detachTrace?.();
      await agent?.close().catch(() => undefined);
      await session?.close().catch(() => undefined);
      await manager?.close().catch(() => undefined);
      await sessionStore?.close().catch(() => undefined);
      contextStore?.close();
    },
  };
}
