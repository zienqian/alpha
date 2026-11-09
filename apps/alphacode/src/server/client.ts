import { randomUUID } from "node:crypto";
import type { Chat, ChatState } from "../chat/contracts";
import type { SessionView } from "./protocol";
import type { AlphaClient } from "./transport";
import type { AppConfig } from "../config";
import { ensureServer } from "./lifecycle";
import { openBrowser } from "./web";
import { createNativeClient } from "./http";

export function remoteChat(client: AlphaClient, initial: SessionView, launch = openBrowser): Chat {
  let view = initial;
  let connected = false;
  let closed = false;
  let notice: string | undefined;
  const listeners = new Set<(state: ChatState) => void>();
  const abort = new AbortController();
  const path = `/api/sessions/${encodeURIComponent(initial.session.id)}`;
  const state = (): ChatState => ({
    ...view.state, closing: closed,
    messages: view.state.messages.map(message => !message.tool ? message : { ...message, tool: { ...message.tool,
      startedAt: message.tool.startedAt === undefined ? undefined : message.tool.startedAt - performance.timeOrigin,
      finishedAt: message.tool.finishedAt === undefined ? undefined : message.tool.finishedAt - performance.timeOrigin,
    } }),
    canSend: connected && !closed && view.state.canSend,
    activeRunStartedAt: view.state.activeRunStartedAt === undefined ? undefined : view.state.activeRunStartedAt - performance.timeOrigin,
    error: notice ?? view.state.error,
    ...(!connected ? { status: "Reconnecting to local server…" } : {}),
  });
  const publish = () => { for (const listener of listeners) listener(state()); };
  const report = (error: unknown) => { notice = error instanceof Error ? error.message : "SERVER_UNAVAILABLE"; publish(); };
  const action = async <T>(suffix: string, body: unknown) => {
    if (!connected || closed) throw new Error("SERVER_DISCONNECTED");
    notice = undefined;
    return client.request<T>(`${path}/${suffix}`, body, AbortSignal.timeout(15000));
  };
  void client.subscribe<SessionView>(`${path}/events`, next => {
    view = next; connected = true; publish();
  }, abort.signal, online => { if (connected !== online) { connected = online; publish(); } });
  return {
    get state() { return state(); },
    get modelId() { return view.modelId; },
    get workspaceRoot() { return view.session.workspaceRoot; },
    get sessionId() { return view.session.id; },
    get skills() { return view.skills; },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async send(input, requestId = randomUUID()) {
      if (closed) return;
      try {
        if (input.trim() === "/web") {
          const result = await client.request<{ url: string }>("/api/web", { sessionId: view.session.id });
          try { await launch(result.url); }
          catch { notice = `Open this URL in your browser: ${result.url}`; publish(); }
          return;
        }
        await action("requests", { requestId, input });
      } catch (error) { report(error); }
    },
    cancel() { void action("cancel", { requestId: view.requestId }).catch(report); },
    answerApproval(allow) { void action("approval", { requestId: view.requestId, approvalId: view.approvalId, allow }).catch(report); },
    async setPermissionMode(mode) {
      try {
        const next = await action<SessionView>("permission", { mode });
        if (next.instanceId !== view.instanceId || next.sequence >= view.sequence) view = next;
        publish(); return true;
      }
      catch (error) { report(error); return false; }
    },
    async close() { if (closed) return; closed = true; abort.abort(); listeners.clear(); },
  };
}

export async function connectApplication(config: AppConfig): Promise<Chat> {
  const descriptor = await ensureServer(config.databasePath);
  const client = createNativeClient(descriptor);
  const view = await client.request<SessionView>("/api/connect", {
    config: { ...config, databasePath: descriptor.databasePath },
    credential: config.noAuth ? undefined : process.env[config.apiKeyEnv],
  }, AbortSignal.timeout(30000));
  return remoteChat(client, view);
}
