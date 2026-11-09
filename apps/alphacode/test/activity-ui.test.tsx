import { createI18n, namespaces } from "../src/i18n/instance";
import { expect, test } from "bun:test";
import { flushSync } from "@opentui/react";
import { Writable } from "node:stream";
import { testRender } from "./render";
import { measureEditText, type ImageRenderable, type TextRenderable } from "@opentui/core";
import { setRendererCapabilities } from "@opentui/core/testing";
import type { Chat, ChatState } from "../src/chat/contracts";
import { createToolRecord, completeToolRecord } from "../src/runtime/tool-records";
import { App } from "../src/ui/app";
import { composerActivity } from "../src/ui/components/composer-status";
import { ShimmerText } from "../src/ui/components/shimmer-text";
import { Spinner } from "../src/ui/components/spinner";
import { formatDuration } from "../src/ui/duration";
import { brailleMorph, morphingPath, rasterMorph } from "../src/ui/morphing-infinity";
import { shimmerFrame, shimmerGlyphs } from "../src/ui/shimmer";
import { VscodeImageOutput } from "../src/ui/vscode-output";
import { waitFor } from "./helpers";

const t = createI18n("en").getFixedT(null, namespaces);

const stateFor = (): ChatState => ({ sessionTitle: "New session", messages: [], busy: true, closing: false, canSend: false, status: "Generating…", phase: "thinking", permissionMode: "ask", settingsSaving: false });

test("composer status follows the active turn, approval, stopping and persistence instead of a previous tool result", () => {
  const tool = { ...createToolRecord("a", { id: "c", name: "read_file", arguments: { path: "a" } }), status: "succeeded" as const, finishedAt: 1 };
  const state: ChatState = { ...stateFor(), messages: [{ id: tool.id, role: "tool", text: tool.name, tool }] };
  expect(composerActivity(t, state).text).toBe("Reviewing results…");
  state.messages = [...state.messages, { id: "new", role: "user", text: "next" }];
  expect(composerActivity(t, state).text).toBe("Working…");
  expect(composerActivity(t, { ...state, approval: { name: "run_command", preview: { type: "tool" } } }).animated).toBe(false);
  expect(composerActivity(t, { ...state, phase: "stopping", approval: { name: "run_command", preview: { type: "tool" } } }).text).toBe("Stopping…");
  expect(composerActivity(t, { ...state, phase: "saving" }).text).toBe("Saving session…");
  expect(composerActivity(t, { ...state, busy: false, phase: "idle", status: "Ready" }).animated).toBe(false);
});

test("shimmer keeps whole Chinese/emoji/combining graphemes, terminal widths and stable text", () => {
  const text = "验证 👩‍💻 e\u0301 状态";
  const layout = shimmerGlyphs(text, "unicode");
  expect(layout.width).toBe(measureEditText(text, { widthMethod: "unicode" }));
  expect(layout.glyphs.map(glyph => glyph.text)).toContain("👩‍💻");
  expect(layout.glyphs.map(glyph => glyph.text)).toContain("e\u0301");
  const before = shimmerFrame(layout, 0), during = shimmerFrame(layout, 1100), after = shimmerFrame(layout, 2000);
  expect(during.chunks.map(chunk => chunk.text).join("")).toBe(text);
  expect(new Set(during.chunks.map(chunk => chunk.fg?.toString())).size).toBeGreaterThan(1);
  expect(after.chunks.map(chunk => chunk.fg?.toString())).toEqual(before.chunks.map(chunk => chunk.fg?.toString()));
  expect(during.chunks.every(chunk => !chunk.attributes)).toBe(true);
});

test("flat tool records and the composer status render above the input without disrupting a draft or narrow layout", async () => {
  const tool = completeToolRecord(createToolRecord("assistant", { id: "call", name: "run_command", arguments: {
    command: "bun test", description: "验证消息状态",
  } }), { execution: "succeeded", content: JSON.stringify({ ok: false, code: "COMMAND_EXIT_NONZERO", detail: { exitCode: 1, stdout: "one test failed" } }) });
  tool.startedAt = 0;
  tool.finishedAt = 3660000;
  let state: ChatState = { ...stateFor(), messages: [{ id: "user", role: "user", text: "check" }, { id: tool.id, role: "tool", text: tool.name, tool }] };
  let notify: ((state: ChatState) => void) | undefined;
  const chat: Chat = {
    get state() { return state; }, modelId: "test", workspaceRoot: "C:/alpha", sessionId: "ui",
    subscribe(listener) { notify = listener; return () => { notify = undefined; }; },
    async send() { /* UI fixture. */ }, cancel() { /* UI fixture. */ }, answerApproval() { /* UI fixture. */ },
    async setPermissionMode() { return false; }, async close() { /* UI fixture. */ },
  };
  const ui = await testRender(<App chat={chat} onExit={() => { /* UI fixture. */ }} />, { width: 90, height: 28 });
  try {
    await ui.renderOnce();
    const frame = ui.captureCharFrame();
    expect(frame).toContain("Failed (exit 1) bun test");
    expect(frame).toContain("验证消息状态");
    expect(frame).toContain("one test failed");
    expect(frame).toContain("exit 1 · 1h 1m");
    expect(frame).not.toContain("Thinking…");
    const activity = ui.renderer.root.findDescendantById("composer-status");
    const composer = ui.renderer.root.findDescendantById("composer");
    expect(activity && composer && activity.y + activity.height + 1 === composer.y).toBe(true);
    const label = ui.renderer.root.findDescendantById("activity-label");
    const elapsed = ui.renderer.root.findDescendantById("activity-elapsed");
    expect(label && elapsed && label.x + label.width + 1 === elapsed.x).toBe(true);
    expect(frame).toContain("(0s · esc to interrupt)");
    await ui.mockInput.typeText("保留草稿");
    state = { ...state, busy: false, phase: "idle", status: "Ready", canSend: true, messages: [...state.messages, {
      id: "reply", role: "assistant", text: "已确认测试失败。", completion: { durationMs: 11000, completedAt: Date.now(), status: "completed" },
    }] };
    notify?.(state);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("Worked for 11s ·");
    expect(ui.renderer.root.findDescendantById("composer-status")).toBeUndefined();
    const reply = ui.renderer.root.findDescendantById("message-reply");
    const completion = ui.renderer.root.findDescendantById("completion-reply");
    expect(reply && completion && reply.y + reply.height < completion.y).toBe(true);
    const user = ui.renderer.root.findDescendantById("message-user");
    expect(user?.height).toBe(3);
    for (const [width, height] of [[40, 16], [28, 14]] as const) {
      ui.resize(width, height);
      await ui.renderOnce();
      expect(ui.captureCharFrame()).toContain("保留草稿");
      const footer = ui.renderer.root.findDescendantById("status-bar");
      expect(footer && footer.y + footer.height).toBe(height);
    }
  } finally { await ui.dispose(); }
});

test("unrelated state changes do not restart shimmer; ANSI-256 and unknown capabilities still animate", async () => {
  const savedNoColor = process.env.NO_COLOR, savedReduced = process.env.ALPHACODE_REDUCED_MOTION, savedTerm = process.env.TERM;
  delete process.env.NO_COLOR;
  delete process.env.ALPHACODE_REDUCED_MOTION;
  process.env.TERM = "xterm-256color";
  const text = "正在验证消息与工具状态";
  const ui = await testRender(<ShimmerText text={text} animated />, { width: 60, height: 4 });
  let updates: ReturnType<typeof setInterval> | undefined;
  try {
    setRendererCapabilities(ui.renderer, { rgb: false, ansi256: true });
    flushSync(() => ui.renderer.emit("capabilities", ui.renderer.capabilities));
    await ui.renderOnce();
    updates = setInterval(() => ui.rerender(<ShimmerText text={text} animated />), 40);
    const label = ui.renderer.root.findDescendantById("activity-label") as TextRenderable;
    await waitFor(async () => {
      await ui.renderOnce();
      const painted = ui.captureSpans().lines[0]?.spans.filter(span => span.text.trim()) ?? [];
      return new Set(painted.map(span => span.fg.toString())).size > 1;
    }, 3000);
    clearInterval(updates);
    ui.rerender(<ShimmerText text={text} animated={false} />);
    await ui.renderOnce();
    expect(label.chunks).toHaveLength(1);
    expect(label.chunks[0]?.text).toBe(text);
    setRendererCapabilities(ui.renderer, { rgb: false, ansi256: false });
    flushSync(() => ui.renderer.emit("capabilities", ui.renderer.capabilities));
    ui.rerender(<ShimmerText text={text} animated />);
    await ui.renderOnce();
    await waitFor(async () => {
      await ui.renderOnce();
      return new Set(label.chunks.map(chunk => chunk.fg?.toString())).size > 1;
    }, 2000);
    flushSync(() => ui.renderer.emit("blur"));
    await ui.renderOnce();
    expect(label.chunks).toHaveLength(1);
  } finally {
    clearInterval(updates);
    await ui.dispose();
    if (savedNoColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = savedNoColor;
    if (savedReduced === undefined) delete process.env.ALPHACODE_REDUCED_MOTION; else process.env.ALPHACODE_REDUCED_MOTION = savedReduced;
    if (savedTerm === undefined) delete process.env.TERM; else process.env.TERM = savedTerm;
  }
});

test("the circle/infinity morph animates without color and stops for approval; reduced motion stays still", async () => {
  const savedNoColor = process.env.NO_COLOR, savedReduced = process.env.ALPHACODE_REDUCED_MOTION, savedTerm = process.env.TERM;
  process.env.NO_COLOR = "1";
  delete process.env.ALPHACODE_REDUCED_MOTION;
  process.env.TERM = "xterm-256color";
  const ui = await testRender(<Spinner active />, { width: 8, height: 2 });
  try {
    await ui.renderOnce();
    const first = ui.captureCharFrame();
    expect(first).toContain(brailleMorph(0));
    await waitFor(async () => { await ui.renderOnce(); return ui.captureCharFrame() !== first; });
    ui.rerender(<Spinner active={false} />);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain(brailleMorph(0));
    process.env.ALPHACODE_REDUCED_MOTION = "1";
    const reduced = await testRender(<Spinner active />, { width: 8, height: 2 });
    try { await reduced.renderOnce(); expect(reduced.captureCharFrame()).toContain(brailleMorph(0)); }
    finally { await reduced.dispose(); }
  } finally {
    await ui.dispose();
    if (savedNoColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = savedNoColor;
    if (savedReduced === undefined) delete process.env.ALPHACODE_REDUCED_MOTION; else process.env.ALPHACODE_REDUCED_MOTION = savedReduced;
    if (savedTerm === undefined) delete process.env.TERM; else process.env.TERM = savedTerm;
  }
});

test("morph geometry preserves the supplied keyframes, reversed circle and five-second loop", () => {
  expect(morphingPath(0)[0]).toEqual([12, 8]);
  expect(morphingPath(1250)[0]).toEqual([12, 12]);
  expect(morphingPath(2500)[0]).toEqual([12, 16]);
  expect(morphingPath(3750)).toEqual(morphingPath(1250));
  expect(morphingPath(5000)).toEqual(morphingPath(0));
  expect(rasterMorph(1250)).not.toEqual(rasterMorph(0));
  const frames = new Set<string>();
  for (let elapsed = 0; elapsed < 5000; elapsed += 40) {
    const path = morphingPath(elapsed), frame = brailleMorph(elapsed);
    expect(path.at(-1)).toEqual(path[0]);
    expect(measureEditText(frame, { widthMethod: "unicode" })).toBe(4);
    expect(frame.replaceAll("⠀", "").length).toBeGreaterThan(0);
    frames.add(frame);
  }
  expect(frames.size).toBeGreaterThan(5);
});

test("graphics-capable terminals render changing antialiased morph images and can fall back to dots", async () => {
  const savedNoColor = process.env.NO_COLOR, savedReduced = process.env.ALPHACODE_REDUCED_MOTION, savedTerm = process.env.TERM;
  delete process.env.NO_COLOR;
  delete process.env.ALPHACODE_REDUCED_MOTION;
  process.env.TERM = "xterm-256color";
  const ui = await testRender(<Spinner active />, { width: 16, height: 3 });
  try {
    setRendererCapabilities(ui.renderer, { kitty_graphics: true, multiplexer: "none", image_protocol: "auto" });
    flushSync(() => ui.renderer.emit("capabilities", ui.renderer.capabilities));
    const image = () => ui.renderer.root.findDescendantById("activity-spinner-image") as ImageRenderable | undefined;
    await waitFor(async () => { await ui.renderOnce(); return Boolean(image()?.image); });
    expect(image()?.effectiveProtocol).toBe("kitty");
    const first = Array.from(image()?.image?.raw().data ?? []);
    expect(first.some((alpha, index) => index % 4 === 3 && alpha > 0 && alpha < 255)).toBe(true);
    await waitFor(async () => {
      await ui.renderOnce();
      return image()?.image?.raw().data.some((byte, index) => byte !== first[index]) === true;
    });
    setRendererCapabilities(ui.renderer, { kitty_graphics: false, sixel: false, image_protocol: "auto" });
    flushSync(() => ui.renderer.emit("capabilities", ui.renderer.capabilities));
    await ui.renderOnce();
    expect(image()).toBeUndefined();
    expect(ui.renderer.root.findDescendantById("activity-spinner-dots")).toBeDefined();
  } finally {
    await ui.dispose();
    if (savedNoColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = savedNoColor;
    if (savedReduced === undefined) delete process.env.ALPHACODE_REDUCED_MOTION; else process.env.ALPHACODE_REDUCED_MOTION = savedReduced;
    if (savedTerm === undefined) delete process.env.TERM; else process.env.TERM = savedTerm;
  }
});

test("duration text handles short and long runs", () => {
  expect(formatDuration(0)).toBe("0s");
  expect(formatDuration(59999)).toBe("59s");
  expect(formatDuration(60000)).toBe("1m 0s");
  expect(formatDuration(11999)).toBe("11s");
  expect(formatDuration(65000)).toBe("1m 5s");
  expect(formatDuration(3599999)).toBe("59m 59s");
  expect(formatDuration(3600000)).toBe("1h 0m");
  expect(formatDuration(3660000)).toBe("1h 1m");
  expect(formatDuration(86399999)).toBe("23h 59m");
  expect(formatDuration(86400000)).toBe("1d 0h");
  expect(formatDuration(183845000)).toBe("2d 3h");
});

test("native spinner output uses visible VS Code image layers and removes the image on completion", async () => {
  const savedNoColor = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  const pieces: Buffer[] = [];
  const destination = new Writable({ write(chunk, _encoding, done) { pieces.push(Buffer.from(chunk)); done(); } });
  Object.assign(destination, { isTTY: true, columns: 16, rows: 3 });
  const output = new VscodeImageOutput(destination as unknown as NodeJS.WriteStream);
  const ui = await testRender(<Spinner active={false} />, {
    width: 16, height: 3, bufferedOutput: "stdout", remote: false,
    stdout: output as unknown as NodeJS.WriteStream,
    environment: { TERM: "xterm-256color", TERM_PROGRAM: "vscode", OPENTUI_GRAPHICS: "1", OPENTUI_IMAGE_PROTOCOL: "kitty" },
  });
  const encoded = () => Buffer.concat(pieces).toString();
  try {
    await ui.renderer.setupTerminal();
    setRendererCapabilities(ui.renderer, { kitty_graphics: true, multiplexer: "none", image_protocol: "kitty" });
    flushSync(() => ui.renderer.emit("capabilities", ui.renderer.capabilities));
    await waitFor(async () => { await ui.renderOnce(); return encoded().includes("a=p,"); });
    const placements = encoded().split("\x1b_G").filter(command => command.startsWith("a=p,")).map(command => command.split("\x1b\\")[0] ?? "");
    expect(placements.every(command => /,z=\d+,q=2/.test(command))).toBe(true);
    expect(placements.some(command => command.includes(",z=-"))).toBe(false);
    pieces.length = 0;
    ui.rerender(<text>Done</text>);
    await waitFor(async () => { await ui.renderOnce(); return encoded().includes("a=d,d=I,"); });
    expect(ui.renderer.root.findDescendantById("activity-spinner-image")).toBeUndefined();
  } finally {
    await ui.dispose();
    output.end();
    if (savedNoColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = savedNoColor;
  }
});
