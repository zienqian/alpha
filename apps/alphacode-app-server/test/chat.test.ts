import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createApplication } from "../src/application";
import { controlledStream, fixture, textResponse, toolResponse, waitFor } from "./helpers";

test("steering before the first text leaves no empty replies and saves a single continued turn", async () => {
  const stream = controlledStream();
  const app = await fixture((_body, index) => index === 1 ? stream.response : textResponse("guided result"));
  try {
    const running = app.chat.send("original");
    await waitFor(() => app.requests.length === 1 && Boolean(app.chat.canSteer));
    expect(await app.chat.steer?.("new direction")).toBe(true);
    await running;
    expect(app.chat.state.messages.map(message => message.text)).toEqual(["original", "new direction", "guided result"]);
    expect(app.chat.state.lastRunStatus).toBe("completed");
    expect(app.chat.state.error).toBeUndefined();
    await app.chat.close();
    const db = new Database(app.config.databasePath, { readonly: true });
    try {
      const row = db.query("SELECT body FROM sessions WHERE id = ?").get(app.chat.sessionId) as { body: string };
      const saved = JSON.parse(row.body);
      expect(saved.turns).toHaveLength(1);
      expect(saved.turns[0].messages.map((message: { content?: string; text?: string }) => message.content ?? message.text))
        .toEqual(["original", "new direction", "guided result"]);
    } finally { db.close(); }
  } finally { stream.end(); await app.dispose(); }
});

test("Provider → ADK → coding tools → streaming reply → SQLite; subsequent prompts retain context", async () => {
  const stream = controlledStream();
  const app = await fixture((_body, index) => index === 1
    ? toolResponse("read_file", { path: "hello.txt" })
    : index === 2 ? stream.response : textResponse("第二轮回复"));
  try {
    const running = app.chat.send("读取 hello.txt，再用 Markdown 回答。");
    await waitFor(() => app.requests.length === 2);
    expect(app.requests[0]?.tools.map(tool => tool.function.name).sort()).toEqual([
      "create_file", "edit_file", "list_files", "readSkill", "read_file", "run_command", "search",
    ]);
    expect(JSON.stringify(app.requests[0])).toContain("Project fixture instruction");
    expect(JSON.stringify(app.requests[1])).toContain("hello-from-workspace");
    stream.text("# 回复\n\n第一段");
    await waitFor(() => app.chat.state.messages.some(message => message.text.includes("第一段")));
    expect(app.chat.state.busy).toBe(true);
    expect(app.chat.state.messages.at(-1)?.streaming).toBe(true);
    await app.chat.send("不应并发发送");
    expect(app.requests).toHaveLength(2);
    stream.text("\n\n- 列表\n\n```ts\nconst answer = 42;\n```\n");
    stream.end();
    await running;
    expect(app.chat.state.messages.at(-1)?.streaming).toBe(false);
    expect(app.chat.state.canSend).toBe(true);
    expect(app.chat.state.error).toBeUndefined();
    const completion = app.chat.state.messages.at(-1)?.completion;
    expect(completion?.status).toBe("completed");
    expect(app.chat.state.activeRunStartedAt).toBeUndefined();
    expect(app.chat.state.messages.some(message => message.role === "tool")).toBe(true);
    const nextRun = app.chat.send("继续");
    expect(app.chat.state.busy).toBe(true);
    expect(app.chat.state.messages.some(message => message.completion)).toBe(false);
    expect(app.chat.state.messages.filter(message => message.role === "tool")).toHaveLength(1);
    expect(app.chat.state.messages.find(message => message.tool)?.tool?.output).toContain("hello-from-workspace");
    expect(app.chat.state.messages.some(message => message.text.includes("const answer = 42"))).toBe(true);
    await nextRun;
    const completedTurns = app.chat.state.messages.filter(message => message.completion);
    expect(completedTurns).toHaveLength(1);
    expect(completedTurns[0]?.text).toBe("第二轮回复");
    expect(completedTurns[0]?.completion).not.toBe(completion);
    expect(JSON.stringify(app.requests[2])).toContain("const answer = 42");
    expect(JSON.stringify(app.requests[2])).toContain("hello-from-workspace");
    await app.chat.close();
    const db = new Database(app.config.databasePath, { readonly: true });
    try {
      const row = db.query("SELECT body FROM sessions WHERE id = ?").get(app.chat.sessionId) as { body: string };
      const saved = JSON.parse(row.body);
      expect(saved.pending).toBeNull();
      expect(saved.turns).toHaveLength(2);
      expect(saved.turns[0].run.status).toBe("completed");
      expect(saved.turns[1].run.text).toBe("第二轮回复");
    } finally { db.close(); }
    const restored = await createApplication({ ...app.config, sessionId: app.chat.sessionId }, { provider: { fetch: async () => textResponse("restored") } });
    try {
      expect(restored.state.messages.filter(message => message.role === "tool")).toHaveLength(1);
      expect(restored.state.messages.find(message => message.tool)?.tool?.output).toContain("hello-from-workspace");
      expect(restored.state.messages.filter(message => message.completion)).toHaveLength(1);
      expect(restored.state.messages.at(-1)?.completion).toEqual(completedTurns[0]?.completion);
      expect(restored.state.messages.some(message => message.text.includes("const answer = 42"))).toBe(true);
    } finally { await restored.close(); }
  } finally { await app.dispose(); }
});

test("a failed stream keeps an incomplete preview and accepts a later prompt without duplicating text", async () => {
  const stream = controlledStream();
  const app = await fixture((_body, index) => index === 1 ? stream.response : textResponse("恢复后的回复"));
  try {
    const running = app.chat.send("first");
    await waitFor(() => app.requests.length === 1);
    stream.text("暂存中的半句");
    await waitFor(() => app.chat.state.messages.at(-1)?.text === "暂存中的半句");
    stream.fail();
    await running;
    expect(app.chat.state.messages.at(-1)?.note).toBe("Incomplete preview");
    expect(app.chat.state.messages.at(-1)?.streaming).toBe(false);
    expect(app.chat.state.error).toBeDefined();
    expect(JSON.stringify(app.chat.state)).not.toContain("private upstream");
    await app.chat.send("second");
    expect(app.chat.state.messages.filter(message => message.text === "恢复后的回复")).toHaveLength(1);
    expect(app.chat.state.error).toBeUndefined();
  } finally { await app.dispose(); }
});

test("cancelling a response stops streaming and allows another prompt", async () => {
  const stream = controlledStream();
  const app = await fixture((_body, index) => index === 1 ? stream.response : textResponse("继续成功"));
  try {
    await app.chat.send("  ");
    expect(app.requests).toHaveLength(0);
    const running = app.chat.send("cancel this");
    await waitFor(() => app.requests.length === 1);
    stream.text("还在生成");
    await waitFor(() => app.chat.state.messages.at(-1)?.text === "还在生成");
    app.chat.cancel();
    await running;
    expect(app.chat.state.status).toBe("Stopped");
    expect(app.chat.state.busy).toBe(false);
    expect(app.chat.state.messages.at(-1)?.streaming).toBe(false);
    await app.chat.send("continue");
    expect(app.chat.state.messages.at(-1)?.text).toBe("继续成功");
  } finally { await app.dispose(); }
});

test("commands require a one-shot decision; denial, approval, and closing a pending approval settle", async () => {
  const app = await fixture((_body, index) => index % 2 === 1
    ? toolResponse("run_command", { command: "echo alphacode-approved" })
    : textResponse("命令已处理"));
  try {
    const denied = app.chat.send("command one");
    await waitFor(() => Boolean(app.chat.state.approval));
    expect(app.chat.state.approval?.preview.type).toBe("command");
    expect(app.requests).toHaveLength(1);
    app.chat.answerApproval(false);
    await denied;
    expect(app.chat.state.messages.find(message => message.role === "tool")?.note).toBe("denied");
    const allowed = app.chat.send("command two");
    await waitFor(() => Boolean(app.chat.state.approval));
    app.chat.answerApproval(true);
    await allowed;
    expect(JSON.stringify(app.requests[3])).toContain("alphacode-approved");
    const pending = app.chat.send("command three");
    await waitFor(() => Boolean(app.chat.state.approval));
    await app.chat.close();
    await pending;
    expect(app.chat.state.approval).toBeUndefined();
    expect(app.requests).toHaveLength(5);
  } finally { await app.dispose(); }
});

test("an incomplete model result remains labelled after a later successful turn", async () => {
  const stream = controlledStream();
  stream.text("达到输出上限");
  stream.end("length");
  const app = await fixture((_body, index) => index === 1 ? stream.response : textResponse("继续完成"));
  try {
    await app.chat.send("first");
    expect(app.chat.state.status).toBe("Response incomplete");
    await app.chat.send("continue");
    expect(app.chat.state.messages.find(message => message.text === "达到输出上限")?.note).toBe("Response incomplete");
  } finally { await app.dispose(); }
});

test("a failed SQLite save blocks sending; shutdown retries only persistence", async () => {
  const stream = controlledStream();
  const app = await fixture(() => stream.response);
  const lock = new Database(app.config.databasePath);
  try {
    const running = app.chat.send("save this");
    await waitFor(() => app.requests.length === 1);
    lock.exec("BEGIN IMMEDIATE");
    stream.text("需要保存的结果");
    stream.end();
    await running;
    expect(app.chat.state.error).toContain("Session not saved");
    expect(app.chat.state.canSend).toBe(false);
    await app.chat.send("must not run");
    expect(app.requests).toHaveLength(1);
    lock.exec("ROLLBACK");
    await app.chat.close();
    const row = lock.query("SELECT body FROM sessions WHERE id = ?").get(app.chat.sessionId) as { body: string };
    const saved = JSON.parse(row.body);
    expect(saved.pending).toBeNull();
    expect(saved.turns[0].run.text).toBe("需要保存的结果");
    expect(app.requests).toHaveLength(1);
  } finally {
    if (lock.inTransaction) lock.exec("ROLLBACK");
    lock.close();
    await app.dispose();
  }
});
