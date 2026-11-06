import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import type { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core";
import type { Chat, ChatState } from "../src/chat/contracts";
import { App } from "../src/ui/app";
import { controlledStream, fixture, textResponse, toolResponse, waitFor } from "./helpers";

test("slash commands filter, complete and select permissions locally, with Escape preserving the draft", async () => {
  const app = await fixture(() => textResponse("普通消息回复"));
  const ui = await testRender(() => <App chat={app.chat} onExit={() => { /* No exit in this test. */ }} />, { width: 100, height: 32 });
  const input = ui.renderer.root.findDescendantById("prompt") as TextareaRenderable;
  try {
    await ui.renderOnce();
    await ui.mockInput.typeText("/");
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("/permission");
    await ui.mockInput.typeText("per");
    ui.mockInput.pressTab();
    expect(input.plainText).toBe("/permission");
    ui.mockInput.pressEnter();
    await ui.renderOnce();
    for (const label of ["Ask for approval", "Approve for me", "Full access"]) expect(ui.captureCharFrame()).toContain(label);
    ui.mockInput.pressArrow("down");
    ui.mockInput.pressEnter();
    await waitFor(() => !app.chat.state.settingsSaving);
    await ui.renderOnce();
    expect(app.chat.state.permissionMode).toBe("auto");
    expect(input.plainText).toBe("");
    expect(Boolean(ui.renderer.root.findDescendantById("command-panel"))).toBe(false);
    expect(app.requests).toHaveLength(0);
    expect(app.chat.state.messages).toHaveLength(0);

    await ui.mockInput.typeText("/permission");
    ui.mockInput.pressEnter();
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("Approve for me ✓");
    ui.mockInput.pressArrow("down");
    ui.mockInput.pressEscape();
    await waitFor(() => !ui.renderer.root.findDescendantById("command-panel"));
    await ui.renderOnce();
    expect(app.chat.state.permissionMode).toBe("auto");
    expect(input.plainText).toBe("/permission");
    expect(Boolean(ui.renderer.root.findDescendantById("command-panel"))).toBe(false);

    ui.mockInput.pressEnter();
    ui.mockInput.pressArrow("down");
    ui.mockInput.pressEnter();
    await waitFor(() => !app.chat.state.settingsSaving);
    expect(app.chat.state.permissionMode).toBe("full");
    await ui.mockInput.typeText("/permission");
    ui.mockInput.pressEnter();
    ui.mockInput.pressArrow("down");
    ui.mockInput.pressEnter();
    await waitFor(() => !app.chat.state.settingsSaving);
    expect(app.chat.state.permissionMode).toBe("ask");

    input.setText("/unknown");
    ui.mockInput.pressEnter();
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("No matching commands");
    expect(app.requests).toHaveLength(0);
    input.setText("hello");
    ui.mockInput.pressEnter();
    await waitFor(() => !app.chat.state.busy && app.requests.length === 1);
    expect(app.requests[0]?.messages.at(-1)?.content).toBe("hello");
  } finally { await app.dispose(); await ui.dispose(); }
});

test("Escape closes the command picker before cancelling a running task, and a busy task keeps its permission", async () => {
  const stream = controlledStream();
  const app = await fixture(() => stream.response);
  const ui = await testRender(() => <App chat={app.chat} onExit={() => { /* No exit in this test. */ }} />, { width: 60, height: 20 });
  try {
    await ui.renderOnce();
    await ui.mockInput.typeText("hello");
    ui.mockInput.pressEnter();
    await waitFor(() => app.requests.length === 1);
    await ui.mockInput.typeText("/permission");
    ui.mockInput.pressEnter();
    ui.mockInput.pressArrow("down");
    ui.mockInput.pressEnter();
    await ui.renderOnce();
    expect(app.chat.state.permissionMode).toBe("ask");
    expect(ui.captureCharFrame()).toContain("Available after this task");
    ui.mockInput.pressEscape();
    await waitFor(() => !ui.renderer.root.findDescendantById("command-panel"));
    await ui.renderOnce();
    expect(app.chat.state.busy).toBe(true);
    expect(Boolean(ui.renderer.root.findDescendantById("command-panel"))).toBe(false);
    ui.mockInput.pressEscape();
    await waitFor(() => !app.chat.state.busy);
    expect(app.chat.state.status).toBe("Stopped");
  } finally { await app.dispose(); await ui.dispose(); }
});

test("composer grows with wrapped text and newlines, caps tall drafts, and shrinks after deleting or sending", async () => {
  const app = await fixture(() => textResponse("收到"));
  const ui = await testRender(() => <App chat={app.chat} onExit={() => { /* No exit in this test. */ }} />, { width: 100, height: 32 });
  const input = ui.renderer.root.findDescendantById("prompt") as TextareaRenderable;
  const composer = ui.renderer.root.findDescendantById("composer");
  const footer = ui.renderer.root.findDescendantById("status-bar");
  if (!composer || !footer) throw new Error("Missing composer or footer");
  const checkHeight = async (rows: number, terminalHeight = 32) => {
    await ui.renderOnce();
    expect(input.height).toBe(rows);
    expect(composer.height).toBe(rows + 2);
    expect(composer.y + composer.height).toBe(footer.y);
    expect(footer.y + footer.height).toBe(terminalHeight);
  };
  try {
    await checkHeight(1);
    ui.resize(28, 14);
    await checkHeight(1, 14);
    ui.resize(100, 32);
    await checkHeight(1);
    await ui.mockInput.typeText("短消息");
    await checkHeight(1);
    ui.mockInput.pressKey("j", { ctrl: true });
    await checkHeight(2);
    ui.mockInput.pressBackspace();
    await checkHeight(1);

    // Wide glyphs must wrap using terminal cell widths, not string length.
    await ui.mockInput.pasteBracketedText("中文🙂".repeat(10));
    await checkHeight(1);
    ui.resize(40, 32);
    await checkHeight(2);
    ui.resize(100, 32);
    await checkHeight(1);

    await ui.mockInput.pasteBracketedText("\n下一行".repeat(10));
    await checkHeight(6);
    expect(ui.captureCharFrame()).toContain("下一行");
    ui.resize(100, 16);
    await checkHeight(4, 16);
    ui.resize(100, 32);
    await checkHeight(6);

    ui.mockInput.pressKey("HOME", { shift: true });
    ui.mockInput.pressBackspace();
    expect(input.plainText).toBe("");
    await checkHeight(1);
    await ui.mockInput.pasteBracketedText("发送后\n收回一行");
    await checkHeight(2);
    ui.mockInput.pressEnter();
    await waitFor(() => app.requests.length === 1 && !app.chat.state.busy);
    await checkHeight(1);
    expect(app.requests[0]?.messages.at(-1)?.content).toBe("发送后\n收回一行");
    expect(input.plainText).toBe("");
  } finally {
    await app.dispose();
    await ui.dispose();
  }
});

test("composer and context stay at the bottom across empty, overflowing, approval, error and resized layouts", async () => {
  let state: ChatState = { messages: [], busy: false, closing: false, canSend: true, status: "Ready", phase: "idle", permissionMode: "ask", settingsSaving: false };
  let listener: ((state: ChatState) => void) | undefined;
  const chat: Chat = {
    get state() { return state; },
    modelId: "test-model-with-a-long-name", workspaceRoot: "C:/projects/一个很长的项目目录/alpha/workspace", sessionId: "layout",
    subscribe(callback) { listener = callback; return () => { listener = undefined; }; },
    async send() { /* Layout-only fixture. */ },
    cancel() { /* Layout-only fixture. */ },
    answerApproval() { /* Layout-only fixture. */ },
    async setPermissionMode() { return false; },
    async close() { /* Layout-only fixture. */ },
  };
  const ui = await testRender(() => <App chat={chat} onExit={() => { /* No exit in this test. */ }} />, { width: 100, height: 32 });
  const element = (id: string) => {
    const node = ui.renderer.root.findDescendantById(id);
    if (!node) throw new Error(`Missing ${id}`);
    return node;
  };
  const assertDock = (height: number) => {
    const composer = element("composer");
    const footer = element("status-bar");
    expect(footer.y + footer.height).toBe(height);
    expect(composer.y + composer.height).toBe(footer.y);
    expect(element("conversation").y + element("conversation").height).toBeLessThanOrEqual(composer.y);
    expect(element("model-info").height).toBe(1);
    expect(element("cwd-info").height).toBe(1);
    expect(footer.height).toBe(1);
    const frame = ui.captureCharFrame();
    expect(element("model-info").width).toBeGreaterThan(0);
    expect(frame).toContain("C:/");
    const footerLine = frame.split("\n")[height - 1] ?? "";
    expect(footerLine).toContain(" · ");
    expect(footerLine).not.toContain("model ");
    expect(footerLine).not.toContain("cwd ");
    expect(footerLine).not.toContain("Ready");
    expect(footerLine).not.toContain("Send");
    expect(footerLine).not.toContain("Newline");
  };
  const update = async (patch: Partial<ChatState>) => {
    state = { ...state, ...patch };
    listener?.(state);
    await ui.renderOnce();
  };
  try {
    await ui.renderOnce();
    assertDock(32);
    const initialY = element("composer").y;
    await ui.mockInput.typeText("保留输入草稿");
    await update({ busy: true, canSend: false, status: "Generating…", messages: [
      { id: "user", role: "user", text: "检查这个项目" },
      { id: "assistant", role: "assistant", text: Array.from({ length: 60 }, (_, i) => `Line ${i}`).join("\n"), streaming: true },
    ] });
    assertDock(32);
    expect(element("composer").y).toBe(initialY);
    expect(ui.captureCharFrame()).toContain("Line 59");
    const conversation = element("conversation") as ScrollBoxRenderable;
    conversation.scrollTo(0);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("检查这个项目");
    expect(element("composer").y).toBe(initialY);
    await update({ approval: { name: "run_command", preview: {
      type: "command", shell: "powershell", cwd: chat.workspaceRoot, command: "Write-Output 'approval'\n".repeat(20),
    } } });
    assertDock(32);
    expect(element("composer").y).toBe(initialY);
    expect(ui.captureCharFrame()).toContain("Run this command?");
    ui.resize(40, 16);
    await ui.renderOnce();
    assertDock(16);
    expect(ui.captureCharFrame()).toContain("Run this command?");
    ui.resize(100, 32);
    await ui.renderOnce();
    await update({ approval: undefined, busy: false, error: "Could not save session. Please retry.", status: "Run failed" });
    assertDock(32);
    expect(ui.captureCharFrame()).toContain("Could not save session");
    for (const [width, height] of [[60, 24], [40, 16], [28, 14], [100, 32]] as const) {
      ui.resize(width, height);
      await ui.renderOnce();
      assertDock(height);
      expect(ui.captureCharFrame()).toContain("保留输入草稿");
    }
  } finally {
    await ui.dispose();
  }
});

test("typing and Enter send a prompt; Markdown appears before completion and finishes after the stream", async () => {
  const stream = controlledStream();
  const app = await fixture(() => stream.response);
  let exits = 0;
  let ui: Awaited<ReturnType<typeof testRender>> | undefined;
  try {
    ui = await testRender(() => <App chat={app.chat} onExit={() => { exits++; }} />, { width: 100, height: 32 });
    const screen = ui;
    await ui.renderOnce();
    await ui.mockInput.typeText("hello");
    ui.mockInput.pressKey("j", { ctrl: true });
    await ui.mockInput.typeText("world");
    ui.mockInput.pressEnter();
    await waitFor(() => app.requests.length === 1);
    expect(app.requests[0]?.messages.at(-1)?.content).toBe("hello\nworld");
    stream.text("# Streaming title\n\nFirst **bold** paragraph.\n\n- item one\n");
    await waitFor(() => app.chat.state.messages.at(-1)?.text.includes("item one") ?? false);
    await ui.waitForFrame(frame => frame.includes("Streaming title") && frame.includes("item one"));
    expect(app.chat.state.busy).toBe(true);
    stream.text("\n```text\ncode block\n```\n\nFinished.");
    stream.end();
    await waitFor(() => !app.chat.state.busy);
    // Markdown highlighting settles on a worker, independently of the HTTP stream.
    await waitFor(async () => {
      await screen.renderOnce();
      const frame = screen.captureCharFrame();
      return frame.includes("Finished.") && frame.includes("code block");
    });
    const frame = ui.captureCharFrame();
    expect(frame).toContain("First bold paragraph.");
    expect(frame).not.toContain("**bold**");
    const boldSpans = ui.captureSpans().lines.flatMap(line => line.spans).filter(span => span.text.includes("bold"));
    expect(boldSpans.length).toBeGreaterThan(0);
    for (const span of boldSpans) expect(span.fg.equals(span.bg)).toBe(false);
    ui.resize(60, 24);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("test-model · ");
    expect(ui.captureCharFrame()).not.toContain("Enter Send");
    ui.mockInput.pressCtrlC();
    expect(exits).toBe(1);
  } finally {
    await app.dispose();
    await ui?.dispose();
  }
});

test("approval keys do not leak into the input; Escape cancels an active stream", async () => {
  const stream = controlledStream();
  const app = await fixture((_body, index) => index === 1
    ? toolResponse("run_command", { command: "Write-Output 'needs-approval'" })
    : index === 2 ? textResponse("已拒绝命令") : stream.response);
  let ui: Awaited<ReturnType<typeof testRender>> | undefined;
  try {
    ui = await testRender(() => <App chat={app.chat} onExit={() => { /* No exit in this test. */ }} />, { width: 100, height: 36 });
    await ui.renderOnce();
    await ui.mockInput.typeText("command");
    ui.mockInput.pressEnter();
    await waitFor(() => Boolean(app.chat.state.approval));
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("needs-approval");
    ui.mockInput.pressKey("n");
    await waitFor(() => !app.chat.state.busy);
    expect(app.chat.state.approval).toBeUndefined();
    await ui.mockInput.typeText("next");
    ui.mockInput.pressEnter();
    await waitFor(() => app.requests.length === 3);
    expect(app.requests[2]?.messages.at(-1)?.content).toBe("next");
    stream.text("partial");
    await waitFor(() => app.chat.state.messages.at(-1)?.text === "partial");
    ui.mockInput.pressEscape();
    await waitFor(() => !app.chat.state.busy);
    expect(app.chat.state.status).toBe("Stopped");
    expect(app.chat.state.messages.at(-1)?.note).toBe("Incomplete preview");
  } finally {
    await app.dispose();
    await ui?.dispose();
  }
});
