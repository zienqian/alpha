import { TerminalLanguageProvider } from "../src/ui/i18n-provider";
import { expect, test } from "bun:test";
import { StrictMode } from "react";
import { createRoot, flushSync } from "@opentui/react";
import { createTestRenderer } from "@opentui/core/testing";
import type { Chat, ChatState } from "@alpha/alphacode-app-server/contracts";
import { App } from "../src/ui/app";
import { testRender } from "./render";

function viewChat(title: string) {
  let state: ChatState = { sessionTitle: title, messages: [], busy: false, closing: false,
    canSend: true, status: "Ready", phase: "idle", permissionMode: "ask", settingsSaving: false };
  const listeners = new Set<(state: ChatState) => void>();
  const chat: Chat = {
    get state() { return state; }, modelId: "test", workspaceRoot: "/project", sessionId: title,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    send: async () => undefined, cancel: () => undefined, answerApproval: () => undefined,
    setPermissionMode: async () => false, close: async () => undefined,
  };
  return {
    chat, listeners,
    update(patch: Partial<ChatState>) {
      flushSync(() => {
        state = { ...state, ...patch };
        for (const listener of listeners) listener(state);
      });
    },
  };
}

test("React keeps one Chat subscription and detaches it when the source changes or unmounts", async () => {
  const first = viewChat("First session"), second = viewChat("Second session");
  const onExit = () => undefined;
  const ui = await testRender(<StrictMode><App chat={first.chat} onExit={onExit} /></StrictMode>, { width: 100, height: 24 });
  try {
    expect(first.listeners.size).toBe(1);
    first.update({ sessionTitle: "Updated session" });
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("Updated session");
    expect(first.listeners.size).toBe(1);
    ui.rerender(<StrictMode><App chat={second.chat} onExit={onExit} /></StrictMode>);
    expect(first.listeners.size).toBe(0);
    expect(second.listeners.size).toBe(1);
    first.update({ sessionTitle: "Stale session" });
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("Second session");
    expect(ui.captureCharFrame()).not.toContain("Stale session");
    ui.rerender(null);
    expect(second.listeners.size).toBe(0);
  } finally { await ui.dispose(); }
});

test("React streaming updates and reordered messages preserve keyed native nodes and the draft", async () => {
  const source = viewChat("Streaming session");
  source.update({ messages: [{ id: "first", role: "user", text: "First" }, { id: "reply", role: "assistant", text: "Partial", streaming: true }] });
  const ui = await testRender(<StrictMode><App chat={source.chat} onExit={() => undefined} /></StrictMode>, { width: 100, height: 24 });
  try {
    await ui.renderOnce();
    const reply = ui.renderer.root.findDescendantById("message-reply");
    const input = ui.renderer.root.findDescendantById("prompt");
    expect(reply).toBeDefined();
    await ui.mockInput.typeText("draft stays");
    source.update({ messages: [{ id: "reply", role: "assistant", text: "Partial then complete", streaming: false }, { id: "first", role: "user", text: "First" }] });
    await ui.renderOnce();
    expect(ui.renderer.root.findDescendantById("message-reply")).toBe(reply);
    expect(ui.renderer.root.findDescendantById("prompt")).toBe(input);
    expect(ui.captureCharFrame()).toContain("Partial then complete");
    expect(ui.captureCharFrame()).toContain("draft stays");
  } finally { await ui.dispose(); }
});

test("React caches projected Chat snapshots and refreshes changes between render and subscription", async () => {
  const source = viewChat("Remote session");
  let reads = 0;
  const chat: Chat = {
    ...source.chat,
    get state() { reads++; return { ...source.chat.state, messages: [...source.chat.state.messages] }; },
    subscribe(listener) {
      source.update({ sessionTitle: "Connected session" });
      return source.chat.subscribe(listener);
    },
  };
  const ui = await testRender(<App chat={chat} onExit={() => undefined} />, { width: 100, height: 24 });
  try {
    await ui.renderOnce();
    expect(reads).toBe(2);
    expect(ui.captureCharFrame()).toContain("Connected session");
    expect(source.listeners.size).toBe(1);
    source.update({ sessionTitle: "Remote update" });
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("Remote update");
    expect(reads).toBe(2);
  } finally { await ui.dispose(); }
  expect(source.listeners.size).toBe(0);
});

test("React unmount removes keyboard, resize and animation listeners across repeated mounts", async () => {
  const source = viewChat("Busy session");
  source.update({ busy: true, canSend: false, phase: "thinking", activeRunStartedAt: performance.now() });
  const ui = await testRender(null, { width: 100, height: 24 });
  const listenerCounts = () => [
    ui.renderer.keyInput.listenerCount("keypress"),
    ...["resize", "focus", "blur", "frame", "capabilities"].map(event => ui.renderer.listenerCount(event)),
  ];
  const baseline = listenerCounts();
  try {
    for (let iteration = 0; iteration < 3; iteration++) {
      ui.rerender(<StrictMode><App chat={source.chat} onExit={() => undefined} /></StrictMode>);
      await ui.renderOnce();
      expect(source.listeners.size).toBe(1);
      expect(ui.renderer.root.findDescendantById("activity-spinner")).toBeDefined();
      ui.rerender(null);
      await ui.renderOnce();
      expect(source.listeners.size).toBe(0);
      expect(listenerCounts()).toEqual(baseline);
    }
  } finally { await ui.dispose(); }
});

test("the terminal submits queued input while busy and preserves input while disconnected", async () => {
  const source = viewChat("Queue input");
  const sent: string[] = [];
  source.chat.send = async input => { sent.push(input); };
  const ui = await createTestRenderer({ width: 100, height: 24, kittyKeyboard: true });
  try {
    flushSync(() => createRoot(ui.renderer).render(<TerminalLanguageProvider locale={{ language: "en", formatLocale: "en-US" }}><App chat={source.chat} onExit={() => undefined} /></TerminalLanguageProvider>));
    source.update({ busy: true, canSend: false, canQueue: true, queuedRequests: [{ requestId: "queued", input: "Already queued" }] });
    await ui.mockInput.typeText("Next message");
    ui.mockInput.pressEnter();
    expect(sent).toEqual(["Next message"]);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("1 message queued");
    expect(ui.captureCharFrame()).toContain("Already queued");
    source.update({ canQueue: false, connection: "reconnecting" });
    await ui.mockInput.typeText("Keep draft");
    ui.mockInput.pressEnter();
    expect(sent).toHaveLength(1);
    source.update({ canQueue: true, connection: "connected" });
    ui.mockInput.pressEnter();
    expect(sent).toEqual(["Next message", "Keep draft"]);
  } finally { await ui.dispose(); }
});

test("native keyboard events keep menu selection and Escape priority before React commits", async () => {
  const source = viewChat("Rapid input");
  let cancelled = 0;
  let mode = "ask";
  source.chat.cancel = () => { cancelled++; };
  source.chat.setPermissionMode = async value => { mode = value; return true; };
  const ui = await createTestRenderer({ width: 100, height: 24, kittyKeyboard: true });
  try {
    flushSync(() => createRoot(ui.renderer).render(<TerminalLanguageProvider locale={{ language: "en", formatLocale: "en-US" }}><App chat={source.chat} onExit={() => undefined} /></TerminalLanguageProvider>));
    await ui.mockInput.typeText("/permission");
    ui.mockInput.pressEnter();
    ui.mockInput.pressArrow("down");
    ui.mockInput.pressArrow("down");
    ui.mockInput.pressEnter();
    expect(mode).toBe("full");
    await Bun.sleep(0);
    source.update({ busy: true, canSend: false });
    await ui.mockInput.typeText("/permission");
    ui.mockInput.pressEnter();
    await ui.waitFor(() => Boolean(ui.renderer.root.findDescendantById("command-panel")));
    ui.mockInput.pressEscape();
    expect(cancelled).toBe(0);
    ui.mockInput.pressEscape();
    expect(cancelled).toBe(1);
  } finally { await ui.dispose(); }
});
