import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { SessionData } from "@alpha/adk-session";
import type { Chat } from "../src/chat/contracts";
import { createApplication } from "../src/application";
import { controlledStream, fixture, textResponse, waitFor } from "./helpers";

const titleResponse = (title: string) => Response.json({ choices: [{ message: { content: title }, finish_reason: "stop" }] });

function archive(database: Database, id: string): SessionData {
  const row = database.query("SELECT body FROM sessions WHERE id = ?").get(id) as { body: string };
  return JSON.parse(row.body);
}

test("generates once alongside the first reply, then saves and restores the title without changing history", async () => {
  const stream = controlledStream();
  const app = await fixture(() => stream.response, () => titleResponse("“修复登录问题。”"));
  const database = new Database(app.config.databasePath);
  let resumed: Chat | undefined;
  try {
    expect(app.chat.state.sessionTitle).toBe("");
    const sending = app.chat.send("帮我修复登录问题");
    await waitFor(() => app.chat.state.sessionTitle === "修复登录问题");
    expect(app.chat.state.busy).toBe(true);
    expect(app.chat.state.titleStatus).toBe("ready");
    expect(archive(database, app.chat.sessionId).title).toBe("");
    stream.text("done"); stream.end();
    await sending;
    expect(app.chat.state.error).toBeUndefined();
    expect(archive(database, app.chat.sessionId).title).toBe("修复登录问题");
    expect(app.chat.state.messages.map(message => message.text)).toEqual(["帮我修复登录问题", "done"]);
    expect(app.titleRequests).toHaveLength(1);
    expect(app.titleRequests[0]?.tools).toBeUndefined();
    expect(app.requests).toHaveLength(1);
    await app.chat.close();

    resumed = await createApplication({ ...app.config, sessionId: app.chat.sessionId }, { provider: { fetch: async () => textResponse("continued") } });
    expect(resumed.state.sessionTitle).toBe("修复登录问题");
    await resumed.send("Do not replace the existing title either");
    expect(resumed.state.error).toBeUndefined();
    expect(archive(database, resumed.sessionId).title).toBe("修复登录问题");
  } finally {
    stream.end(); await resumed?.close();
    database.close();
    await app.dispose();
  }
});

test("a slow title never delays the reply and a late title is saved while idle", async () => {
  let finish!: (response: Response) => void;
  const app = await fixture(() => textResponse("done"), () => new Promise(resolve => { finish = resolve; }));
  const database = new Database(app.config.databasePath);
  try {
    await app.chat.send("first message");
    expect(app.chat.state.busy).toBe(false);
    expect(app.chat.state.titleStatus).toBe("pending");
    await app.chat.send("second message");
    expect(app.titleRequests).toHaveLength(1);
    finish(titleResponse("Conversation title"));
    await waitFor(() => archive(database, app.chat.sessionId).title === "Conversation title");
    expect(app.chat.state.titleStatus).toBe("ready");
    expect(archive(database, app.chat.sessionId).turns).toHaveLength(2);
  } finally { database.close(); await app.dispose(); }
});

test("failed naming leaves the title absent for localized client fallbacks without failing the conversation", async () => {
  const app = await fixture(() => textResponse("done"), () => new Response("offline", { status: 503 }));
  const database = new Database(app.config.databasePath);
  try {
    await app.chat.send("修复\n登录页面的错误");
    await waitFor(() => app.chat.state.titleStatus === "ready");
    expect(app.chat.state.sessionTitle).toBe("");
    expect(archive(database, app.chat.sessionId).title).toBe("");
    expect(app.chat.state.error).toBeUndefined();
    await app.chat.send("继续");
    expect(app.titleRequests).toHaveLength(1);
  } finally { database.close(); await app.dispose(); }
});

test("a stalled title times out and shutdown does not wait for a non-cooperating transport", async () => {
  const app = await fixture(() => textResponse("done"), () => new Promise(() => { /* Simulate a stalled transport. */ }));
  try {
    await app.chat.send("fallback title");
    expect(app.chat.state.titleStatus).toBe("pending");
    await waitFor(() => app.chat.state.titleStatus === "ready");
    expect(app.chat.state.sessionTitle).toBe("");
    expect(app.chat.state.error).toBeUndefined();
  } finally { await app.dispose(); }
}, 12_000);

test("closing cancels naming immediately and preserves the fallback", async () => {
  let signal: AbortSignal | undefined;
  const app = await fixture(() => textResponse("done"), (_body, abort) => { signal = abort ?? undefined; return new Promise(() => { /* Ignores cancellation. */ }); });
  try {
    await app.chat.send("fallback title");
    await app.chat.close();
    expect(signal?.aborted).toBe(true);
    expect(app.chat.state.titleStatus).toBe("ready");
  } finally { await app.dispose(); }
}, 2_000);

test("title write failure does not block replies, settings, or shutdown", async () => {
  const app = await fixture(() => textResponse("done"));
  const database = new Database(app.config.databasePath);
  try {
    database.exec("CREATE TRIGGER reject_title BEFORE UPDATE ON sessions WHEN json_extract(NEW.body, '$.title') <> json_extract(OLD.body, '$.title') BEGIN SELECT RAISE(ABORT, 'Rejected title write'); END");
    await app.chat.send("fallback title");
    expect(app.chat.state.error).toBeUndefined();
    expect(await app.chat.setPermissionMode("auto")).toBe(true);
    await app.chat.send("second message");
    expect(app.chat.state.error).toBeUndefined();
    await app.chat.close();
    expect(archive(database, app.chat.sessionId).title).toBe("");
    expect(archive(database, app.chat.sessionId).turns).toHaveLength(2);
  } finally { database.close(); await app.dispose(); }
});

test("saved titles are sanitized for display without changing the stored title", async () => {
  const app = await fixture(() => textResponse("done"));
  const database = new Database(app.config.databasePath);
  let resumed: Chat | undefined;
  try {
    await app.chat.send("create saved title fixture");
    await app.chat.close();
    const saved = archive(database, app.chat.sessionId);
    const title = "Saved\n\x1b[31mreview\x1b[0m";
    database.query("UPDATE sessions SET body = ? WHERE id = ?").run(JSON.stringify({ ...saved, title }), saved.id);
    resumed = await createApplication({ ...app.config, sessionId: saved.id }, { provider: { fetch: async () => textResponse("continued") } });
    expect(resumed.state.sessionTitle).toBe("Saved review");
    await resumed.send("Continue this session");
    expect(resumed.state.sessionTitle).toBe("Saved review");
    expect(archive(database, saved.id).title).toBe(title);
  } finally {
    await resumed?.close();
    database.close();
    await app.dispose();
  }
});
