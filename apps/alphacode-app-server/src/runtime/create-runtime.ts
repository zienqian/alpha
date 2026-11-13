import { mkdir, realpath } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type { Agent } from "@alpha/adk/core";
import { createTracePlugin } from "@alpha/adk-trace";
import type { RuntimeTrace } from "./trace-bridge";
import { createSessionManager, createSessionPlugin, type Session, type SessionManager, type SessionStore } from "@alpha/adk-session";
import { createSqliteSessionStore } from "@alpha/adk-session/sqlite";
import { createCodingAgent, type CodingContext, type LoadSkillsResult } from "@alpha/coding-agent";
import { createProvider, type CreateProviderOptions } from "@alpha/provider";
import type { AppConfig } from "../config";
import type { ChatEvent, ChatMessage, ChatRuntime, RequestApproval } from "../chat/contracts";
import { subscribeToAgent } from "./events";
import { permissionDecision } from "./permission-policy";
import { restoreMessages } from "./history";
import { globalInstructionsPlugin } from "./global-instructions";
import { isPermissionMode, readSessionSettings, sameSettings, settingsError, type SessionSettings } from "./session-settings";
import { loadRuntimeSkills, prepareSkillInput, skillStatus } from "./skills";
import { parseInput } from "../input";
import { displayText } from "./tool-records";
import { generateSessionTitle, titleTimeoutMs } from "./session-title";
import { estimateContext, modelContext, restoreContext } from "./context-usage";

export async function createRuntime(config: AppConfig, options: {
  approve?: RequestApproval;
  provider?: CreateProviderOptions;
  draftSessionId?: string;
  trace?: RuntimeTrace;
} = {}): Promise<ChatRuntime> {
  const cwd = await realpath(config.workspaceRoot);
  let store: SessionStore | undefined;
  let manager: SessionManager | undefined;
  let session: Session | undefined;
  let agent: Agent | undefined;
  let detachTrace: (() => void) | undefined;
  const sessionId = config.sessionId ?? options.draftSessionId ?? randomUUID();
  const subscriptions = new Map<(event: ChatEvent) => void, (() => void) | undefined>();
  let initialize: (input?: string) => Promise<{ agent: Agent; session: Session }>;
  let messages: ChatMessage[] = [];
  // An absent title stays empty in storage; each client localizes its fallback.
  let title = "";
  let titleInput: string | undefined;
  let initialTitle: string | undefined;
  let titleStarted = false;
  let titleDirty = false;
  let titleAbort: AbortController | undefined;
  let titleWork: Promise<void> | undefined;
  let titleSaving: Promise<void> | undefined;
  let loadedSkills: LoadSkillsResult = { skills: [], diagnostics: [] };
  let settings: SessionSettings = { version: 1, modelId: config.modelId, permissionMode: config.permissionMode ?? "ask" };
  let contextUsage = modelContext(config.modelId, config.contextWindow);
  try {
    await mkdir(dirname(config.databasePath), { recursive: true });
    store = await createSqliteSessionStore({ filename: config.databasePath });
    const namespace = sessionNamespace(cwd);
    const saved = config.sessionId ? await store.read({ namespace, id: config.sessionId }) : undefined;
    if (config.sessionId && !saved) throw settingsError("SESSION_NOT_FOUND");
    if (saved) settings = readSessionSettings(saved.data);
    contextUsage = restoreContext(saved?.data.metadata.alphacodeContext,
      modelContext(settings.modelId, settings.modelId === config.modelId ? config.contextWindow : undefined));
    const agentKey = saved?.data.agentKey === `alphacode-v1:${settings.modelId}`
      ? saved.data.agentKey : `alphacode-v2:${settings.modelId}`;
    loadedSkills = await loadRuntimeSkills(config, cwd);
    manager = createSessionManager({ store, namespace, agentKey });
    if (saved) {
      session = await manager.openSession(sessionId);
      if (saved.data.metadata.alphacode === undefined) {
        await manager.updateSession(session.id, { metadata: { ...saved.data.metadata, alphacode: { ...settings } } }, { expectedRevision: saved.revision });
      }
      const snapshot = await session.getSnapshot();
      messages = restoreMessages(snapshot.data);
      title = displayText(snapshot.data.title, 80);
    }
    const model = createProvider({ providers: { main: {
      adapter: "openai-completions",
      options: {
        baseURL: config.baseURL,
        apiKey: config.noAuth ? { none: true } : { env: config.apiKeyEnv },
      },
      models: { chat: { id: settings.modelId } },
    } } }, options.provider).use("main", "chat");
    const activeManager = manager;
    initialize = async (input) => {
      // A new CLI/Web session is only a draft until a valid prompt reaches here.
      if (!session) {
        session = await activeManager.createSession({ id: sessionId,
          title: "", metadata: { alphacode: { ...settings } },
        });
        title = initialTitle = "";
        titleInput = input;
        emitTitle("ready");
      }
      if (agent) return { agent, session };
      const approve = options.approve;
      const policySession = session;
      agent = await createCodingAgent({
        // The first model call happens after the Session plugin has persisted
        // admission. Title generation must not run for rejected/local prompts.
        model: { ...model, stream(input) {
          contextUsage = estimateContext(input, contextUsage);
          for (const listener of subscriptions.keys()) listener({ type: "context.usage", usage: contextUsage });
          startTitle(model);
          return model.stream(input);
        } }, cwd,
        skills: loadedSkills.skills,
        fileAccess: "host", commandTimeoutMs: null,
        limits: {
          timeoutMs: undefined, maxModelCalls: null, maxToolCalls: null,
          maxHistoryMessages: null, maxHistoryBytes: null,
        },
        policy: { decide: async action => {
          // A second process may have changed metadata before this run's admission.
          const current = readSessionSettings((await policySession.getSnapshot()).data);
          if (!sameSettings(current, settings)) return "deny";
          return permissionDecision(settings.permissionMode, action);
        } },
        approve: approve ? async (action, ctx) => {
          const scope = { namespace, sessionId };
          options.trace?.service.recordApproval(scope, ctx.runId, action.call.assistantId, action.call.callId, 'start');
          let allowed: boolean | undefined;
          try {
            allowed = await approve({
            name: action.call.name,
            assistantId: action.call.assistantId, callId: action.call.callId,
            preview: action.preview.type === "command" ? action.preview : { type: "tool" },
            }, ctx.signal);
            return allowed ? "allow" : "deny";
          } finally {
            options.trace?.service.recordApproval(scope, ctx.runId, action.call.assistantId, action.call.callId, 'end', allowed);
          }
        } : undefined,
        instructions: "You are AlphaCode. Respond in the user's language. Use Markdown for explanations and fenced blocks for code. Keep answers concise.",
        plugins: [
          ...(config.globalInstructions ? [globalInstructionsPlugin<CodingContext<undefined>>(config.globalInstructions, config.globalInstructionsPath ?? "~/.alphacode/AGENTS.md")] : []),
          createSessionPlugin({ session }),
          ...(options.trace ? [createTracePlugin<CodingContext<undefined>>({ service: options.trace.service, scope: { namespace, sessionId } })] : []),
        ],
      });
      detachTrace = options.trace?.bind({ namespace, sessionId }, agent, session);
      for (const listener of subscriptions.keys()) subscriptions.set(listener, subscribeToAgent(agent, listener));
      return { agent, session };
    };
    if (saved) await initialize();
  } catch (error) {
    detachTrace?.();
    // Startup has not accepted a prompt; release only resources created here.
    for (const resource of [agent, session, manager, store]) {
      try { await resource?.close(); } catch { /* Keep the original initialization error. */ }
    }
    throw error;
  }

  const activeStore = store, activeManager = manager;
  let changing: Promise<void> | undefined;
  let running = false;
  let cancelled = false;
  let closing: Promise<void> | undefined;
  let preparation: AbortController | undefined;
  let draining = Promise.resolve();

  function emitTitle(status: "pending" | "ready") {
    for (const listener of subscriptions.keys()) listener({ type: "session.title", title, status });
  }

  function startTitle(model: Parameters<typeof generateSessionTitle>[0]) {
    if (titleStarted || !titleInput || closing) return;
    titleStarted = true;
    titleAbort = new AbortController();
    const abort = titleAbort;
    const timeout = setTimeout(() => abort.abort(), titleTimeoutMs);
    emitTitle("pending");
    // Race the abort as well as passing its signal, so a stalled transport
    // cannot leave the sidebar loading or prevent shutdown indefinitely.
    const aborted = new Promise<undefined>(resolve => abort.signal.addEventListener("abort", () => resolve(undefined), { once: true }));
    titleWork = Promise.race([generateSessionTitle(model, titleInput, abort.signal).catch(() => undefined), aborted])
      .then(generated => {
        if (generated) { title = generated; titleDirty = title !== initialTitle; }
        emitTitle("ready");
      }).finally(() => {
        clearTimeout(timeout);
        titleAbort = undefined;
        void persistTitle();
      });
  }

  function persistTitle(): Promise<void> {
    if (titleSaving) return titleSaving;
    if (!session || !titleDirty || running || changing || session.state.persistence?.status === "pending") return Promise.resolve();
    const target = session;
    titleSaving = (async () => {
      const snapshot = await target.getSnapshot();
      if (snapshot.data.pending) return;
      // Preserve a title changed by another writer while generation was running.
      if (snapshot.data.title !== initialTitle) { titleDirty = false; return; }
      await activeManager.updateSession(target.id, { title }, { expectedRevision: snapshot.revision });
      titleDirty = false;
    })().catch(() => { /* Optional naming must never block conversation persistence. */ })
      .finally(() => { titleSaving = undefined; });
    return titleSaving;
  }

  return {
    get contextUsage() { return contextUsage; },
    skills: Object.freeze(loadedSkills.skills.map(({ name, description, argumentHint, userInvocable }) => Object.freeze({ name, description: displayText(description, 1024), argumentHint: argumentHint === undefined ? undefined : displayText(argumentHint, 256), userInvocable }))),
    modelId: settings.modelId,
    workspaceRoot: cwd,
    sessionId,
    get sessionTitle() { return title; },
    messages,
    get permissionMode() { return settings.permissionMode; },
    get canSteer() { return !closing && !cancelled && Boolean(agent?.state.canSteer); },
    async steer(input) {
      if (closing || cancelled || !agent?.state.canSteer) return false;
      const command = parseInput(input);
      if (command.kind === "command" && ["skills", "permission"].includes(command.name)) return false;
      const prepared = await prepareSkillInput(input, loadedSkills.skills, preparation?.signal ?? new AbortController().signal);
      return !closing && !cancelled && agent.state.canSteer ? agent.steer(prepared) : false;
    },
    setPermissionMode(mode) {
      if (!isPermissionMode(mode)) return Promise.reject(settingsError("SESSION_SETTINGS_INVALID"));
      if (closing || running || changing || session?.state.persistence?.status === "pending") return Promise.reject(settingsError("SESSION_BUSY"));
      const work = (async () => {
        await titleSaving;
        if (!session) { settings = { ...settings, permissionMode: mode }; return; }
        const snapshot = await session.getSnapshot();
        if (!sameSettings(readSessionSettings(snapshot.data), settings)) throw settingsError("SESSION_CONFLICT");
        const next: SessionSettings = { ...settings, permissionMode: mode };
        if (sameSettings(next, settings)) return;
        try {
          await activeManager.updateSession(session.id, {
            metadata: { ...snapshot.data.metadata, alphacode: { ...next } },
          }, { expectedRevision: snapshot.revision });
        } catch (error) {
          // A lost acknowledgement must not leave persisted and active permissions different.
          const found = await session.getSnapshot();
          if (found.revision !== snapshot.revision + 1 || found.data.pending || !sameSettings(readSessionSettings(found.data), next)) throw error;
        }
        settings = next;
      })();
      changing = work.finally(() => { changing = undefined; void persistTitle(); });
      return changing;
    },
    get unsaved() { return session?.state.persistence?.status === "pending"; },
    get blocked() {
      if (!session) return false;
      const { historyStatus, persistence } = session.state;
      return historyStatus === "blocked" || (historyStatus === "pending" && persistence?.status !== "pending")
        || agent?.state.historyStatus === "blocked" || agent?.state.boundaryStatus === "failed";
    },
    subscribe(listener) {
      const forward = (event: ChatEvent) => listener(event);
      subscriptions.set(forward, agent ? subscribeToAgent(agent, forward) : undefined);
      return () => { subscriptions.get(forward)?.(); subscriptions.delete(forward); };
    },
    async send(input, requestId) {
      if (closing || running || changing) throw settingsError("SESSION_BUSY");
      running = true;
      cancelled = false;
      preparation = new AbortController();
      let finishRun!: () => void;
      draining = new Promise<void>(resolve => { finishRun = resolve; });
      try {
        await titleSaving;
        const command = parseInput(input);
        if (command.kind === "command" && command.name === "skills" && !command.arguments.trim()) {
          return { status: "completed", localText: skillStatus(loadedSkills), localResult: { kind: "skills",
            skills: loadedSkills.skills.map(skill => ({ name: skill.name, description: displayText(skill.description, 1024),
              argumentHint: displayText(skill.argumentHint, 256), userInvocable: skill.userInvocable, disableModelInvocation: skill.disableModelInvocation })),
            diagnostics: loadedSkills.diagnostics.map(d => ({ severity: d.severity, code: d.code, path: displayText(d.path, 1024), field: displayText(d.field) })) } };
        }
        if (command.kind === "command" && command.name === "permission") {
          return { status: "completed", localText: "Use the /permission picker to change session permissions.", localResult: { kind: "permission" } };
        }
        const prepared = await prepareSkillInput(input, loadedSkills.skills, preparation.signal);
        if (!prepared.trim()) throw settingsError("SESSION_INPUT_INVALID");
        if (cancelled || closing) return { status: "cancelled" };
        const { agent: activeAgent, session: activeSession } = await initialize(input);
        const snapshot = await activeSession.getSnapshot();
        if (cancelled || closing) return { status: "cancelled" };
        if (!sameSettings(readSessionSettings(snapshot.data), settings)) throw settingsError("SESSION_CONFLICT");
        const result = await activeAgent.prompt(prepared, { requestId: requestId ?? randomUUID(), signal: preparation.signal });
        let completion: ChatMessage["completion"];
        if (activeSession.state.persistence?.status === "saved") {
          try {
            const saved = await activeSession.getSnapshot();
            const turn = saved.data.turns.findLast(turn => turn.run.runId === result.runId);
            if (turn?.durationMs !== undefined) completion = {
              durationMs: turn.durationMs, completedAt: Date.parse(turn.committedAt), status: turn.run.status,
            };
            // Store only aggregate counts so reopen/restart retains the indicator.
            // Optional display metadata must never affect a successful turn.
            if (!saved.data.pending && contextUsage.tokens) await activeManager.updateSession(activeSession.id, {
              metadata: { ...saved.data.metadata, alphacodeContext: {
                modelId: contextUsage.modelId, tokens: { ...contextUsage.tokens },
              } },
            }, { expectedRevision: saved.revision });
          } catch { /* Optional display timing must not change a completed run's outcome. */ }
        }
        return { status: result.status, error: result.status === "failed" ? result.error.code : undefined, completion };
      } catch (error) {
        if (cancelled || closing) return { status: "cancelled" };
        throw error;
      } finally { running = false; preparation = undefined; await persistTitle(); finishRun(); }
    },
    cancel() { cancelled = true; preparation?.abort(); agent?.abort(); },
    close() {
      cancelled = true;
      preparation?.abort();
      agent?.abort();
      titleAbort?.abort();
      if (!closing) closing = (async () => {
        await draining;
        await titleWork;
        await changing?.catch(() => { /* A failed settings change retains the previous mode. */ });
        try {
          await agent?.close();
        } catch (error) {
          // The Session plugin unbinds even if its final save failed. Retry the
          // captured commit only; never rerun the model or tools on shutdown.
          if (session?.state.persistence?.status !== "pending") throw error;
          const saved = await session.flush();
          if (saved.status === "pending") throw Object.assign(new Error(), { code: saved.code });
        }
        await persistTitle();
        for (const unsubscribe of subscriptions.values()) unsubscribe?.();
        subscriptions.clear();
        detachTrace?.();
        await session?.close();
        await activeManager.close();
        await activeStore.close();
      })().catch(error => {
        closing = undefined;
        throw error;
      });
      return closing;
    },
  };
}

// Preserve the existing local:<sha256> namespace so saved Windows sessions remain visible.
export function sessionNamespace(cwd: string, platform = process.platform): string {
  return `local:${createHash("sha256").update(platform === "win32" ? cwd.toLowerCase() : cwd).digest("hex")}`;
}
