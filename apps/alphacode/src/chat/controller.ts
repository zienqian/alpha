import { randomUUID } from "node:crypto";
import { errorCode } from "../errors";
import type { Approvals } from "./approval";
import type { Chat, ChatMessage, ChatRunStatus, ChatRuntime, ChatState } from "./contracts";
import { applyApproval, applyChatEvent, settlePendingTools, statusLabels } from "./messages";

export function createChat(runtime: ChatRuntime, approvals: Approvals): Chat {
  let state: ChatState = {
    messages: runtime.messages, busy: false, closing: false,
    canSend: !runtime.unsaved && !runtime.blocked, status: "Ready", phase: "idle",
    permissionMode: runtime.permissionMode, settingsSaving: false, approval: approvals.pending,
  };
  const listeners = new Set<(state: ChatState) => void>();
  const update = (patch: Partial<ChatState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  };
  const unsubscribe = runtime.subscribe(event => {
    const next = applyChatEvent(state, event);
    update(state.phase === "stopping" && event.type !== "run.end" ? { ...next, phase: "stopping", status: "Stopping…" } : next);
  });
  const unsubscribeApproval = approvals.subscribe(approval => update(applyApproval(state, approval)));
  let closePromise: Promise<void> | undefined;
  return {
    get state() { return state; },
    modelId: runtime.modelId,
    workspaceRoot: runtime.workspaceRoot,
    sessionId: runtime.sessionId,
    skills: runtime.skills,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async send(input) {
      const text = input.trimStart().startsWith("/") ? input : input.trim();
      if (!text.trim() || state.busy || !state.canSend || state.closing) return;
      const started = performance.now();
      let outcome: ChatRunStatus = "failed";
      let completion: ChatMessage["completion"];
      let local = false;
      update({
        busy: true, canSend: false, status: "Connecting…", phase: "thinking", error: undefined, activeRunStartedAt: started,
        messages: [...state.messages.filter(message => message.role !== "tool")
          .map(message => message.completion ? { ...message, completion: undefined } : message),
          { id: randomUUID(), role: "user", text }],
      });
      try {
        const result = await runtime.send(text);
        outcome = result.status;
        completion = result.completion;
        if (result.localText !== undefined) {
          local = true;
          update({ messages: [...state.messages, { id: randomUUID(), role: "assistant", text: result.localText }] });
        }
        update({ status: statusLabels[result.status], error: result.error });
      } catch (error) {
        update({ status: "Request failed", error: errorCode(error) });
      } finally {
        const { unsaved, blocked } = runtime;
        const messages = settlePendingTools(state.messages).map(message => message.streaming ? { ...message, streaming: false } : message);
        const last = messages.at(-1);
        if (last && !local) messages[messages.length - 1] = { ...last, completion: completion ?? {
          durationMs: Math.max(0, Math.round(performance.now() - started)), completedAt: Date.now(), status: outcome,
        } };
        update({
          messages,
          busy: false, phase: "idle", activeRunStartedAt: undefined, canSend: !unsaved && !blocked && !state.closing,
          ...(unsaved ? { error: "Session not saved. Saving will be retried on exit." } : {}),
          ...(blocked ? { error: "Execution state could not be confirmed. Exit and start a new session." } : {}),
        });
      }
    },
    cancel() {
      if (!state.busy) return;
      update({ status: "Stopping…", phase: "stopping" });
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
