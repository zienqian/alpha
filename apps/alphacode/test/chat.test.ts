import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { controlledStream, fixture, textResponse, toolResponse, waitFor } from "./helpers";

test("Provider → ADK → coding tools → streaming reply → SQLite; subsequent prompts retain context", async () => {
  const stream = controlledStream();
  const app = await fixture((_body, index) => index === 1
    ? toolResponse("read_file", { path: "hello.txt" })
    : index === 2 ? stream.response : textResponse("第二轮回复"));
  try {
    const running = app.chat.send("读取 hello.txt，再用 Markdown 回答。");
    await waitFor(() => app.requests.length === 2);
    expect(app.requests[0]?.tools.map(tool => tool.function.name).sort()).toEqual([
      "create_file", "edit_file", "list_files", "read_file", "run_command", "search",
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
    await app.chat.send("继续");
    expect(JSON.stringify(app.requests[2])).toContain("const answer = 42");
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
