import { randomUUID } from "node:crypto";
import type { AgentEvent, RunStatus } from "@alpha/adk/core";
import type { CodingAction, CodingApproval } from "@alpha/coding-agent";
import type { CreateProviderOptions } from "@alpha/provider";
import { errorCode, type AppConfig } from "./config";
import { createRuntime, type Runtime } from "./runtime";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  text: string;
  streaming?: boolean;
  note?: string;
}
export interface ChatState {
  messages: readonly ChatMessage[];
  busy: boolean;
  closing: boolean;
  canSend: boolean;
  status: string;
  error?: string;
  approval?: CodingAction;
}
export interface Chat {
  readonly state: ChatState;
  readonly modelId: string;
  readonly workspaceRoot: string;
  readonly sessionId: string;
  subscribe(listener: (state: ChatState) => void): () => void;
  send(input: string): Promise<void>;
  cancel(): void;
  answerApproval(allow: boolean): void;
  close(): Promise<void>;
}

const statusLabels: Record<RunStatus, string> = {
  completed: "就绪", refused: "模型拒绝了请求", incomplete: "回复未完成",
  unknown: "结果状态未确认", limited: "已达到运行限制", cancelled: "已停止", failed: "运行失败",
};

export async function createChat(config: AppConfig, options: {
  provider?: CreateProviderOptions;
} = {}): Promise<Chat> {
  let state: ChatState = { messages: [], busy: false, closing: false, canSend: true, status: "就绪" };
  const listeners = new Set<(state: ChatState) => void>();
  const update = (patch: Partial<ChatState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  };
  const append = (message: ChatMessage) => update({ messages: [...state.messages, message] });
  const change = (id: string | undefined, patch: (message: ChatMessage) => Partial<ChatMessage>) => {
    update({ messages: state.messages.map(message => message.id === id ? { ...message, ...patch(message) } : message) });
  };
  let decide: ((allow: boolean) => void) | undefined;
  const approve: CodingApproval = (action, { signal }) => new Promise(resolve => {
    const finish = (allow: boolean) => {
      signal.removeEventListener("abort", abort);
      decide = undefined;
      update({ approval: undefined });
      resolve(allow && !signal.aborted ? "allow" : "deny");
    };
    const abort = () => finish(false);
    decide = finish;
    signal.addEventListener("abort", abort, { once: true });
    update({ approval: action, status: "等待命令确认" });
    if (signal.aborted) abort();
  });
  const runtime: Runtime = await createRuntime(config, { approve, provider: options.provider });
  let currentModel: string | undefined;
  const onEvent = (event: AgentEvent) => {
    if (event.type === "model.start") {
      currentModel = event.modelCallId;
      append({ id: currentModel, role: "assistant", text: "", streaming: true });
      update({ status: "正在生成…" });
    } else if (event.type === "model.delta") {
      change(event.modelCallId, message => ({ text: message.text + event.text }));
    } else if (event.type === "message.commit" && event.role === "assistant") {
      const message = runtime.agent.state.messages.find(message => message.id === event.messageId);
      if (message?.role === "assistant") change(currentModel, () => ({ text: message.text }));
    } else if (event.type === "model.end") {
      change(event.modelCallId, () => ({
        streaming: false,
        note: event.outcome === "failed" || event.outcome === "cancelled" ? "未完成的预览"
          : event.outcome === "completed" || event.outcome === "tool_calls" ? undefined : statusLabels[event.outcome],
      }));
    } else if (event.type === "tool.start") {
      append({ id: `${event.assistantId}:${event.callId}`, role: "tool", text: event.name, note: "执行中" });
      update({ status: `工具：${event.name}` });
    } else if (event.type === "tool.end") {
      const id = `${event.assistantId}:${event.callId}`;
      const note = event.execution === "succeeded" ? "已返回" : event.execution;
      if (state.messages.some(message => message.id === id)) change(id, () => ({ note }));
      else {
        // A denied or invalid call ends without a tool.start event.
        const assistant = runtime.agent.state.messages.find(message => message.id === event.assistantId);
        const name = assistant?.role === "assistant" ? assistant.toolCalls.find(call => call.id === event.callId)?.name : undefined;
        append({ id, role: "tool", text: name ?? "工具调用", note });
      }
    } else if (event.type === "run.end") {
      update({ status: "正在保存会话…" });
    }
  };
  const unsubscribe = runtime.agent.subscribe(onEvent);
  let closePromise: Promise<void> | undefined;
  const chat: Chat = {
    get state() { return state; },
    modelId: config.modelId,
    workspaceRoot: runtime.cwd,
    sessionId: runtime.session.id,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async send(input) {
      const text = input.trim();
      if (!text || state.busy || !state.canSend || state.closing) return;
      currentModel = undefined;
      update({ busy: true, canSend: false, status: "正在连接…", error: undefined });
      append({ id: randomUUID(), role: "user", text });
      try {
        const result = await runtime.agent.prompt(text, { requestId: randomUUID() });
        update({ status: statusLabels[result.status], error: result.status === "failed" ? result.error.code : undefined });
      } catch (error) {
        update({ status: "请求失败", error: errorCode(error) });
      } finally {
        const unsaved = runtime.session.state.persistence?.status === "pending";
        const blocked = runtime.agent.state.historyStatus === "blocked" || runtime.agent.state.boundaryStatus === "failed";
        change(currentModel, () => ({ streaming: false }));
        update({
          busy: false, canSend: !unsaved && !blocked && !state.closing,
          ...(unsaved ? { error: "会话尚未保存；退出时会再次尝试保存。" } : {}),
          ...(blocked ? { error: "本次执行状态无法确认，请退出后开启新会话。" } : {}),
        });
      }
    },
    cancel() {
      if (!state.busy) return;
      update({ status: "正在停止…" });
      runtime.agent.abort();
    },
    answerApproval(allow) { decide?.(allow); },
    close() {
      if (!closePromise) {
        update({ closing: true, canSend: false, status: "正在保存并退出…" });
        runtime.agent.abort();
        closePromise = runtime.close().then(() => {
          unsubscribe();
          listeners.clear();
        }).catch(error => {
          closePromise = undefined;
          update({ closing: false, status: "退出未完成，请按 Ctrl+C 重试", error: errorCode(error) });
          throw error;
        });
      }
      return closePromise;
    },
  };
  return chat;
}
