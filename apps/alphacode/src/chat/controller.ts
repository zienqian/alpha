import { randomUUID } from "node:crypto";
import { errorCode } from "../errors";
import type { Approvals } from "./approval";
import type { Chat, ChatRuntime, ChatState } from "./contracts";
import { applyChatEvent, statusLabels } from "./messages";

export function createChat(runtime: ChatRuntime, approvals: Approvals): Chat {
  let state: ChatState = { messages: [], busy: false, closing: false, canSend: true, status: "就绪", approval: approvals.pending };
  const listeners = new Set<(state: ChatState) => void>();
  const update = (patch: Partial<ChatState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  };
  const unsubscribe = runtime.subscribe(event => update(applyChatEvent(state, event)));
  const unsubscribeApproval = approvals.subscribe(approval => update({
    approval, ...(approval ? { status: "等待命令确认" } : {}),
  }));
  let closePromise: Promise<void> | undefined;
  return {
    get state() { return state; },
    modelId: runtime.modelId,
    workspaceRoot: runtime.workspaceRoot,
    sessionId: runtime.sessionId,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async send(input) {
      const text = input.trim();
      if (!text || state.busy || !state.canSend || state.closing) return;
      update({
        busy: true, canSend: false, status: "正在连接…", error: undefined,
        messages: [...state.messages, { id: randomUUID(), role: "user", text }],
      });
      try {
        const result = await runtime.send(text);
        update({ status: statusLabels[result.status], error: result.error });
      } catch (error) {
        update({ status: "请求失败", error: errorCode(error) });
      } finally {
        const { unsaved, blocked } = runtime;
        update({
          messages: state.messages.map(message => message.streaming ? { ...message, streaming: false } : message),
          busy: false, canSend: !unsaved && !blocked && !state.closing,
          ...(unsaved ? { error: "会话尚未保存；退出时会再次尝试保存。" } : {}),
          ...(blocked ? { error: "本次执行状态无法确认，请退出后开启新会话。" } : {}),
        });
      }
    },
    cancel() {
      if (!state.busy) return;
      update({ status: "正在停止…" });
      approvals.answer(false);
      runtime.cancel();
    },
    answerApproval(allow) { approvals.answer(allow); },
    close() {
      if (!closePromise) {
        update({ closing: true, canSend: false, status: "正在保存并退出…" });
        approvals.answer(false);
        runtime.cancel();
        closePromise = runtime.close().then(() => {
          unsubscribe();
          unsubscribeApproval();
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
}
