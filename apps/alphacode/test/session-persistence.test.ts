import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createApplication } from "../src/application";
import { controlledStream, fixture, textResponse, waitFor } from "./helpers";

test("opening, local commands, draft settings and closing never save an unused session", async () => {
  const app = await fixture(() => textResponse("unused"));
  const db = new Database(app.config.databasePath);
  try {
    await app.chat.send("   ");
    await app.chat.send("/skills");
    await app.chat.send("/unknown");
    expect(await app.chat.setPermissionMode("full")).toBe(true);
    expect(db.query("SELECT id FROM sessions").all()).toHaveLength(0);
    await app.chat.close();
    for (let index = 0; index < 3; index++) {
      const draft = await createApplication(app.config);
      await draft.close();
    }
    expect(db.query("SELECT id FROM sessions").all()).toHaveLength(0);
    expect(app.requests).toHaveLength(0);
  } finally { db.close(); await app.dispose(); }
});

test("the first message persists its admission before the model runs and keeps the draft ID", async () => {
  const stream = controlledStream();
  const app = await fixture(() => stream.response);
  const db = new Database(app.config.databasePath);
  const id = app.chat.sessionId;
  try {
    expect(db.query("SELECT id FROM sessions").all()).toHaveLength(0);
    await app.chat.setPermissionMode("auto");
    const sending = app.chat.send("first message", "first-request");
    await waitFor(() => app.requests.length === 1);
    const row = db.query("SELECT body FROM sessions WHERE id = ?").get(id) as { body: string };
    const pending = JSON.parse(row.body);
    expect(pending.pending.requestId).toBe("first-request");
    expect(pending.metadata.alphacode.permissionMode).toBe("auto");
    stream.text("saved reply"); stream.end();
    await sending;
    expect(app.chat.sessionId).toBe(id);
    expect(app.chat.state.messages.map(message => message.text)).toEqual(["first message", "saved reply"]);
    await app.chat.close();
    const restored = await createApplication({ ...app.config, sessionId: id });
    try {
      expect(restored.state.messages.map(message => message.text)).toEqual(["first message", "saved reply"]);
      expect(restored.state.permissionMode).toBe("auto");
    } finally { await restored.close(); }
  } finally { stream.end(); db.close(); await app.dispose(); }
});

test("failed first persistence never calls the model and can retry with the same session ID", async () => {
  const app = await fixture(() => textResponse("saved on retry"));
  const db = new Database(app.config.databasePath);
  const id = app.chat.sessionId;
  try {
    db.exec("CREATE TRIGGER reject_create BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT, 'private storage detail'); END");
    await app.chat.send("first message");
    expect(app.requests).toHaveLength(0);
    expect(db.query("SELECT id FROM sessions").all()).toHaveLength(0);
    expect(app.chat.state.error).toBe("STORE_UNAVAILABLE");
    db.exec("DROP TRIGGER reject_create");
    await app.chat.send("first message");
    expect(app.chat.state.error).toBeUndefined();
    expect(app.requests).toHaveLength(1);
    expect(db.query("SELECT id FROM sessions").all()).toEqual([{ id }]);
  } finally { db.close(); await app.dispose(); }
});
