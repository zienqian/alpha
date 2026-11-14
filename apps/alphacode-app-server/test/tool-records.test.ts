import { expect, test } from "bun:test";
import { createApplication } from "../src/application";
import type { ChatState } from "../src/chat/contracts";
import { applyChatEvent, applyApproval, settlePendingTools } from "../src/chat/messages";
import { completeToolRecord, createToolRecord } from "../src/runtime/tool-records";
import { controlledStream, fixture, textResponse, toolResponse, waitFor } from "./helpers";

const command = (args: Record<string, unknown> = {}) => createToolRecord("assistant", {
  id: "call", name: "run_command", arguments: { command: "bun test", ...args },
});
const initial = (): ChatState => ({ sessionTitle: "New session", messages: [], busy: true, canSend: false, closing: false, status: "Generating…", phase: "thinking", permissionMode: "ask", settingsSaving: false });

test("display metadata is bounded plain text without changing the command or using another assistant's text", () => {
  const args = { command: "echo one\necho two", description: "\x1b[31m验证测试\x1b[0m\n完成前检查\x07" };
  const tool = command(args);
  expect(tool.description).toBe("验证测试 完成前检查");
  expect(tool.descriptionSource).toBe("model");
  expect(tool.command).toBe("echo one echo two");
  expect(args.command).toBe("echo one\necho two");
  expect(command().description).toBe("Run command: bun test");
  expect(command().descriptionSource).toBe("fallback");
  expect(createToolRecord("other-assistant", { id: "call", name: "run_command", arguments: {} }).id).not.toBe(tool.id);
});

test("known coding results distinguish transport success, business failure, nonzero exit and unconfirmed outcomes", () => {
  const failed = completeToolRecord(command(), { execution: "succeeded", content: JSON.stringify({ ok: false, code: "COMMAND_EXIT_NONZERO", detail: { exitCode: 7, stdout: "partial", stderr: "test failed", outputIncomplete: true } }) });
  expect(failed.status).toBe("failed");
  expect(failed.exitCode).toBe(7);
  expect(failed.output).toContain("stderr:\ntest failed");
  expect(failed.outputIncomplete).toBe(true);
  expect(completeToolRecord(command(), { execution: "succeeded", content: JSON.stringify({ ok: true, data: { exitCode: 9 } }) }).status).toBe("failed");
  expect(completeToolRecord(command(), { execution: "succeeded", content: "invalid" }).status).toBe("outcome_unknown");
  expect(completeToolRecord(command(), { execution: "succeeded", content: '{"ok":true,"data":{}}' }).status).toBe("outcome_unknown");
  expect(completeToolRecord(command(), { execution: "outcome_unknown", content: "may have executed" }).status).toBe("outcome_unknown");
  expect(completeToolRecord(command(), { execution: "denied", content: "denied" }).status).toBe("denied");
  const custom = createToolRecord("a", { id: "c", name: "custom", arguments: {} });
  expect(completeToolRecord(custom, { execution: "succeeded", content: '{"ok":false}' }).status).toBe("succeeded");
});

test("large output keeps a bounded head and tail, strips terminal controls and preserves truncation facts", () => {
  const stdout = Array.from({ length: 100 }, (_, index) => `line ${index}`).join("\n");
  const tool = completeToolRecord(command(), { execution: "succeeded", content: JSON.stringify({ ok: true, data: { exitCode: 0, stdout: `\x1b[2J${stdout}`, truncated: true } }) });
  expect(tool.output?.split("\n")).toHaveLength(8);
  expect(tool.output).toContain("line 0");
  expect(tool.output).toContain("line 99");
  expect(tool.output).not.toContain("\x1b");
  expect(tool.omittedLines).toBe(93);
  expect(tool.truncated).toBe(true);
});

test("context reads display lookup failures and preserve paging versus incomplete-capture flags", () => {
  const tool = createToolRecord('assistant', { id: 'read', name: 'read_context', arguments: { reference: 'context://example' } });
  const failed = completeToolRecord(tool, { execution: 'succeeded', content: JSON.stringify({ ok: false, code: 'CONTEXT_NOT_FOUND' }) });
  expect(failed).toMatchObject({ status: 'failed', errorCode: 'CONTEXT_NOT_FOUND' });
  const page = completeToolRecord(tool, { execution: 'succeeded', content: JSON.stringify({ ok: true, data: {
    content: 'exact evidence', hasMore: true, complete: true,
  } }) });
  expect(page).toMatchObject({ status: 'succeeded', output: 'exact evidence', truncated: true, outputIncomplete: false });
  const incomplete = completeToolRecord(tool, { execution: 'succeeded', content: JSON.stringify({ ok: true, data: {
    content: 'partial capture', hasMore: false, complete: false,
  } }) });
  expect(incomplete).toMatchObject({ status: 'succeeded', truncated: false, outputIncomplete: true });
});

test("committed calls appear before approval; denial without a start and repeated updates do not duplicate records", () => {
  let state = applyChatEvent(initial(), { type: "assistant.start", id: "model" });
  const tool = command({ description: "运行相关测试" });
  state = applyChatEvent(state, { type: "assistant.commit", id: "model", text: "先检查测试。", tools: [tool] });
  const approval = { name: "run_command", assistantId: tool.assistantId, callId: tool.callId, preview: { type: "tool" as const } };
  state = { ...state, ...applyApproval(state, approval) };
  expect(state.messages[1]?.tool?.status).toBe("awaiting_approval");
  expect(state.messages[0]?.text).toBe("先检查测试。");
  state = { ...state, ...applyApproval(state, undefined) };
  const denied = completeToolRecord(tool, { execution: "denied", content: "Denied" });
  state = applyChatEvent(state, { type: "tool.end", tool: denied });
  state = applyChatEvent(state, { type: "tool.end", tool: denied });
  const before = state;
  state = applyChatEvent(state, { type: "tool.start", tool: { ...tool, status: "running" } });
  expect(state).toBe(before);
  expect(state.messages).toHaveLength(2);
  expect(state.messages[1]?.tool?.status).toBe("denied");
});

test("run settlement preserves results and distinguishes a never-started tool from an uncertain running command", () => {
  const done = completeToolRecord(command(), { execution: "succeeded", content: '{"ok":true,"data":{"exitCode":0}}' });
  const messages = [done, { ...command(), id: "queued" }, { ...command(), id: "running", status: "running" as const }]
    .map(tool => ({ id: tool.id, role: "tool" as const, text: tool.name, tool }));
  expect(settlePendingTools(messages).map(message => message.tool?.status)).toEqual(["succeeded", "not_executed", "outcome_unknown"]);
});

test("a model description is visible before execution and survives a failed command, follow-up generation and SQLite restore", async () => {
  const followup = controlledStream();
  const app = await fixture((_body, index) => index === 1 ? toolResponse("run_command", {
    command: "Write-Output 'description-result'; exit 7", description: "验证命令描述与失败状态",
  }) : followup.response);
  try {
    const run = app.chat.send("run test");
    await waitFor(() => Boolean(app.chat.state.approval));
    const pending = app.chat.state.messages.find(message => message.tool)?.tool;
    expect(pending?.status).toBe("awaiting_approval");
    expect(pending?.description).toBe("验证命令描述与失败状态");
    expect(pending?.output).toBeUndefined();
    expect(pending?.startedAt).toBeUndefined();
    expect(app.requests).toHaveLength(1);
    app.chat.answerApproval(true);
    await waitFor(() => app.requests.length === 2);
    const result = app.chat.state.messages.find(message => message.tool)?.tool;
    expect(result?.status).toBe("failed");
    expect(result?.exitCode).toBe(7);
    expect(result?.output).toContain("description-result");
    expect(app.chat.state.busy).toBe(true);
    expect(app.chat.state.phase).toBe("thinking");
    followup.text("检查结束，命令失败。");
    followup.end();
    await run;
    expect(app.chat.state.messages.find(message => message.tool)?.tool?.status).toBe("failed");
    const completed = app.chat.state.messages.at(-1)?.completion;
    await app.chat.close();
    const restored = await createApplication({ ...app.config, sessionId: app.chat.sessionId }, { provider: { fetch: async () => textResponse("restored") } });
    try {
      const saved = restored.state.messages.find(message => message.tool)?.tool;
      expect(saved?.id).toBe(result?.id);
      expect(saved?.description).toBe(result?.description);
      expect(saved?.descriptionSource).toBe("model");
      expect(saved?.exitCode).toBe(7);
      expect(saved?.status).toBe("failed");
      expect(saved?.output).toBe(result?.output);
      expect(saved?.startedAt).toBeUndefined();
      const completion = restored.state.messages.at(-1)?.completion;
      expect(completion).toEqual(completed);
      expect(completion?.durationMs).toBeGreaterThanOrEqual(0);
      expect(completion?.completedAt).toBeLessThanOrEqual(Date.now());
      expect(completion?.status).toBe("completed");
    } finally { await restored.close(); }
  } finally { await app.dispose(); }
});
