import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../src/app.js";
import { controlledStream, fixture, textResponse, toolResponse, waitFor } from "./helpers.js";

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
    ui.resize(60, 24);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("Enter 发送");
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
    expect(app.chat.state.status).toBe("已停止");
    expect(app.chat.state.messages.at(-1)?.note).toBe("未完成的预览");
  } finally {
    await app.dispose();
    await ui?.dispose();
  }
});
