import { expect, test } from "bun:test";
import { createApprovals } from "../src/chat/approval";
import { createChat } from "../src/chat/controller";
import type { ChatEvent, ChatRuntime } from "../src/chat/contracts";

test("injected runtime supports streaming and a failed close retries persistence without resending", async () => {
  let listener: ((event: ChatEvent) => void) | undefined;
  let sends = 0, closes = 0, unsubscribes = 0;
  const runtime: ChatRuntime = {
    modelId: "memory-model", workspaceRoot: "/project", sessionId: "memory-session",
    unsaved: false, blocked: false,
    permissionMode: "ask", messages: [],
    async setPermissionMode() { /* This runtime does not execute tools. */ },
    subscribe(value) {
      listener = value;
      return () => { listener = undefined; unsubscribes++; };
    },
    async send() {
      sends++;
      listener?.({ type: "assistant.start", id: "reply" });
      listener?.({ type: "assistant.delta", id: "reply", text: "draft" });
      listener?.({ type: "assistant.commit", id: "reply", text: "committed reply" });
      listener?.({ type: "assistant.end", id: "reply", outcome: "completed" });
      return { status: "completed" };
    },
    cancel() { /* This runtime has no pending work. */ },
    async close() {
      if (++closes === 1) throw Object.assign(new Error("private storage detail"), { code: "STORE_UNAVAILABLE" });
    },
  };
  const chat = createChat(runtime, createApprovals());
  await chat.send("first");
  expect(chat.state.messages.at(-1)?.text).toBe("committed reply");
  expect(chat.state.messages.at(-1)?.streaming).toBe(false);
  expect(chat.state.messages.at(-1)?.completion?.durationMs).toBeGreaterThanOrEqual(0);
  expect(chat.state.messages.at(-1)?.completion?.status).toBe("completed");
  expect(chat.state.activeRunStartedAt).toBeUndefined();
  await expect(chat.close()).rejects.toThrow("private storage detail");
  expect(chat.state.error).toBe("STORE_UNAVAILABLE");
  expect(chat.state.closing).toBe(false);
  expect(chat.state.canSend).toBe(false);
  expect(unsubscribes).toBe(0);
  await chat.send("must not replay");
  expect(sends).toBe(1);
  const closing = chat.close();
  expect(chat.close()).toBe(closing);
  await closing;
  expect(closes).toBe(2);
  expect(unsubscribes).toBe(1);
  expect(sends).toBe(1);
});
