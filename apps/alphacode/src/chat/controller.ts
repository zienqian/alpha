import { randomUUID } from "node:crypto";
import { errorCode } from "../errors";
import type { Approvals } from "./approval";
import type { Chat, ChatRuntime, ChatState } from "./contracts";
import { applyChatEvent, statusLabels } from "./messages";

export function createChat(runtime: ChatRuntime, approvals: Approvals): Chat {
  let state: ChatState = {
    messages: runtime.messages, busy: false, closing: false,
    canSend: !runtime.unsaved && !runtime.blocked, status: "Ready",
    permissionMode: runtime.permissionMode, settingsSaving: false, approval: approvals.pending,
  };
  const listeners = new Set<(state: ChatState) => void>();
  const update = (patch: Partial<ChatState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  };
  const unsubscribe = runtime.subscribe(event => update(applyChatEvent(state, event)));
  const unsubscribeApproval = approvals.subscribe(approval => update({
    approval, ...(approval ? { status: "Awaiting command approval" } : {}),
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
        busy: true, canSend: false, status: "Connecting…", error: undefined,
        messages: [...state.messages, { id: randomUUID(), role: "user", text }],
      });
      try {
        const result = await runtime.send(text);
        update({ status: statusLabels[result.status], error: result.error });
      } catch (error) {
        update({ status: "Request failed", error: errorCode(error) });
      } finally {
        const { unsaved, blocked } = runtime;
        update({
          messages: state.messages.map(message => message.streaming ? { ...message, streaming: false } : message),
          busy: false, canSend: !unsaved && !blocked && !state.closing,
          ...(unsaved ? { error: "Session not saved. Saving will be retried on exit." } : {}),
          ...(blocked ? { error: "Execution state could not be confirmed. Exit and start a new session." } : {}),
        });
      }
    },
    cancel() {
      if (!state.busy) return;
      update({ status: "Stopping…" });
      approvals.answer(false);
      runtime.cancel();
    },
    answerApproval(allow) { approvals.answer(allow); },
    async setPermissionMode(mode) {
      if (state.busy || state.closing || state.settingsSaving || !state.canSend || state.approval || !["ask", "auto", "full"].includes(mode)) return false;
      update({ settingsSaving: true, canSend: false, error: undefined });
      try {
        await runtime.setPermissionMode(mode);
        update({ permissionMode: runtime.permissionMode });
        return true;
      } catch (error) {
        update({ error: `Could not save permissions: ${errorCode(error)}. Previous permissions remain active.` });
        return false;
      } finally {
        update({ settingsSaving: false, canSend: !state.closing && !runtime.unsaved && !runtime.blocked });
      }
    },
    close() {
      if (!closePromise) {
        update({ closing: true, canSend: false, status: "Saving and exiting…" });
        approvals.answer(false);
        runtime.cancel();
        closePromise = runtime.close().then(() => {
          unsubscribe();
          unsubscribeApproval();
          listeners.clear();
        }).catch(error => {
          closePromise = undefined;
          update({ closing: false, status: "Exit failed. Press Ctrl+C to retry.", error: errorCode(error) });
          throw error;
        });
      }
      return closePromise;
    },
  };
}
