import { mkdir, realpath } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type { Agent } from "@alpha/adk/core";
import { createSessionManager, createSessionPlugin, type Session, type SessionManager, type SessionStore } from "@alpha/adk-session";
import { createSqliteSessionStore } from "@alpha/adk-session/sqlite";
import { createCodingAgent } from "@alpha/coding-agent";
import { createProvider, type CreateProviderOptions } from "@alpha/provider";
import type { AppConfig } from "../config";
import type { ChatMessage, ChatRuntime, RequestApproval } from "../chat/contracts";
import { subscribeToAgent } from "./events";
import { permissionDecision } from "./permission-policy";
import { restoreMessages } from "./history";
import { isPermissionMode, readSessionSettings, sameSettings, settingsError, type SessionSettings } from "./session-settings";

export async function createRuntime(config: AppConfig, options: {
  approve?: RequestApproval;
  provider?: CreateProviderOptions;
} = {}): Promise<ChatRuntime> {
  const cwd = await realpath(config.workspaceRoot);
  let store: SessionStore | undefined;
  let manager: SessionManager | undefined;
  let session: Session | undefined;
  let agent: Agent | undefined;
  let messages: ChatMessage[];
  let settings: SessionSettings = { version: 1, modelId: config.modelId, permissionMode: "ask" };
  try {
    await mkdir(dirname(config.databasePath), { recursive: true });
    store = await createSqliteSessionStore({ filename: config.databasePath });
    const namespace = sessionNamespace(cwd);
    const saved = config.sessionId ? await store.read({ namespace, id: config.sessionId }) : undefined;
    if (config.sessionId && !saved) throw settingsError("SESSION_NOT_FOUND");
    if (saved) settings = readSessionSettings(saved.data);
    manager = createSessionManager({ store, namespace, agentKey: `alphacode-v1:${settings.modelId}` });
    session = config.sessionId ? await manager.openSession(config.sessionId) : await manager.createSession({
      title: "AlphaCode", metadata: { alphacode: { ...settings } },
    });
    if (saved && saved.data.metadata.alphacode === undefined) {
      await manager.updateSession(session.id, { metadata: { ...saved.data.metadata, alphacode: { ...settings } } }, { expectedRevision: saved.revision });
    }
    messages = restoreMessages((await session.getSnapshot()).data);
    const model = createProvider({ providers: { main: {
      adapter: "openai-completions",
      options: {
        baseURL: config.baseURL,
        apiKey: config.noAuth ? { none: true } : { env: config.apiKeyEnv },
      },
      models: { chat: { id: settings.modelId } },
    } } }, options.provider).use("main", "chat");
    const approve = options.approve;
    const policySession = session;
    agent = await createCodingAgent({
      model, cwd,
      policy: { decide: async action => {
        // A second process may have changed metadata before this run's admission.
        const current = readSessionSettings((await policySession.getSnapshot()).data);
        if (!sameSettings(current, settings)) return "deny";
        return permissionDecision(settings.permissionMode, action);
      } },
      approve: approve ? async (action, { signal }) => {
        const allowed = await approve({
          name: action.call.name,
          preview: action.preview.type === "command" ? action.preview : { type: "tool" },
        }, signal);
        return allowed ? "allow" : "deny";
      } : undefined,
      instructions: "You are AlphaCode. Respond in the user's language. Use Markdown for explanations and fenced blocks for code. Keep answers concise.",
      plugins: [createSessionPlugin({ session })],
    });
  } catch (error) {
    // Startup has not accepted a prompt; release only resources created here.
    for (const resource of [agent, session, manager, store]) {
      try { await resource?.close(); } catch { /* Keep the original initialization error. */ }
    }
    throw error;
  }

  const activeAgent = agent, activeSession = session, activeStore = store, activeManager = manager;
  let changing: Promise<void> | undefined;
  let running = false;
  let cancelled = false;
  let closing: Promise<void> | undefined;
  return {
    modelId: settings.modelId,
    workspaceRoot: cwd,
    sessionId: activeSession.id,
    messages,
    get permissionMode() { return settings.permissionMode; },
    setPermissionMode(mode) {
      if (!isPermissionMode(mode)) return Promise.reject(settingsError("SESSION_SETTINGS_INVALID"));
      if (closing || running || changing || activeSession.state.persistence?.status === "pending") return Promise.reject(settingsError("SESSION_BUSY"));
      const work = (async () => {
        const snapshot = await activeSession.getSnapshot();
        if (!sameSettings(readSessionSettings(snapshot.data), settings)) throw settingsError("SESSION_CONFLICT");
        const next: SessionSettings = { ...settings, permissionMode: mode };
        if (sameSettings(next, settings)) return;
        try {
          await activeManager.updateSession(activeSession.id, {
            metadata: { ...snapshot.data.metadata, alphacode: { ...next } },
          }, { expectedRevision: snapshot.revision });
        } catch (error) {
          // A lost acknowledgement must not leave persisted and active permissions different.
          const found = await activeSession.getSnapshot();
          if (found.revision !== snapshot.revision + 1 || found.data.pending || !sameSettings(readSessionSettings(found.data), next)) throw error;
        }
        settings = next;
      })();
      changing = work.finally(() => { changing = undefined; });
      return changing;
    },
    get unsaved() { return activeSession.state.persistence?.status === "pending"; },
    get blocked() {
      const { historyStatus, persistence } = activeSession.state;
      return historyStatus === "blocked" || (historyStatus === "pending" && persistence?.status !== "pending")
        || activeAgent.state.historyStatus === "blocked" || activeAgent.state.boundaryStatus === "failed";
    },
    subscribe(listener) { return subscribeToAgent(activeAgent, listener); },
    async send(input) {
      if (closing || running || changing) throw settingsError("SESSION_BUSY");
      running = true;
      cancelled = false;
      try {
        const snapshot = await activeSession.getSnapshot();
        if (cancelled || closing) return { status: "cancelled" };
        if (!sameSettings(readSessionSettings(snapshot.data), settings)) throw settingsError("SESSION_CONFLICT");
        const result = await activeAgent.prompt(input, { requestId: randomUUID() });
        return { status: result.status, error: result.status === "failed" ? result.error.code : undefined };
      } finally { running = false; }
    },
    cancel() { cancelled = true; activeAgent.abort(); },
    close() {
      cancelled = true;
      if (!closing) closing = (async () => {
        await changing?.catch(() => { /* A failed settings change retains the previous mode. */ });
        try {
          await activeAgent.close();
        } catch (error) {
          // The Session plugin unbinds even if its final save failed. Retry the
          // captured commit only; never rerun the model or tools on shutdown.
          if (activeSession.state.persistence?.status !== "pending") throw error;
          const saved = await activeSession.flush();
          if (saved.status === "pending") throw Object.assign(new Error(), { code: saved.code });
        }
        await activeSession.close();
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
