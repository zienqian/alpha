import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { SessionData } from "@alpha/adk-session";
import type { Chat } from "../src/chat/contracts";
import { createApplication } from "../src/application";
import { fixture, textResponse, type RequestBody } from "./helpers";

function archive(db: Database, id: string): SessionData {
  const row = db.query("SELECT body FROM sessions WHERE id = ?").get(id) as { body: string };
  return JSON.parse(row.body);
}

test("draft settings stay in memory until the first message, then remain isolated and restore with history", async () => {
  const app = await fixture(() => textResponse("original reply"));
  const db = new Database(app.config.databasePath);
  const chats: Chat[] = [];
  const requests: RequestBody[] = [];
  const provider = { fetch: async (_url: unknown, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)) as RequestBody);
    return textResponse("restored reply");
  } };
  try {
    expect(db.query("SELECT id FROM sessions").all()).toHaveLength(0);
    expect(await app.chat.setPermissionMode("full")).toBe(true);
    expect(db.query("SELECT id FROM sessions").all()).toHaveLength(0);
    const other = await createApplication({ ...app.config, modelId: "other-model" }, { provider });
    chats.push(other);
    expect(other.sessionId).not.toBe(app.chat.sessionId);
    expect(other.modelId).toBe("other-model");
    expect(other.state.permissionMode).toBe("ask");
    await app.chat.send("remember this request");
    expect(archive(db, app.chat.sessionId).metadata.alphacode).toEqual({ version: 1, modelId: "test-model", permissionMode: "full" });
    await app.chat.close();

    const resumed = await createApplication({ ...app.config, sessionId: app.chat.sessionId, modelId: "changed-environment-model" }, { provider });
    chats.push(resumed);
    expect(resumed.sessionId).toBe(app.chat.sessionId);
    expect(resumed.modelId).toBe("test-model");
    expect(resumed.state.permissionMode).toBe("full");
    expect(resumed.state.messages.map(message => message.text)).toEqual(["remember this request", "original reply"]);
    await resumed.send("continue");
    expect(requests[0]?.model).toBe("test-model");
    expect(JSON.stringify(requests[0])).toContain("remember this request");
    expect(JSON.stringify(requests[0])).toContain("original reply");
    expect(await resumed.setPermissionMode("auto")).toBe(true);
    await resumed.close();
    const again = await createApplication({ ...app.config, sessionId: resumed.sessionId }, { provider });
    chats.push(again);
    expect(again.state.permissionMode).toBe("auto");
    expect(db.query("SELECT id FROM sessions WHERE id = ?").get(other.sessionId)).toBeNull();
  } finally {
    for (const chat of chats) await chat.close();
    db.close();
    await app.dispose();
  }
});

test("failed settings writes keep the old permission active and persisted, then allow retry", async () => {
  const app = await fixture(() => textResponse("unused"));
  const db = new Database(app.config.databasePath);
  try {
    await app.chat.send("create persisted session");
    app.requests.length = 0;
    db.exec("CREATE TRIGGER reject_settings BEFORE UPDATE ON sessions BEGIN SELECT RAISE(ABORT, 'private storage detail'); END");
    expect(await app.chat.setPermissionMode("full")).toBe(false);
    expect(app.chat.state.permissionMode).toBe("ask");
    expect(app.chat.state.settingsSaving).toBe(false);
    expect(app.chat.state.canSend).toBe(true);
    expect(app.chat.state.error).toContain("Could not save permissions");
    expect(app.chat.state.error).not.toContain("private storage detail");
    expect(archive(db, app.chat.sessionId).metadata.alphacode).toEqual({ version: 1, modelId: "test-model", permissionMode: "ask" });
    db.exec("DROP TRIGGER reject_settings");
    expect(await app.chat.setPermissionMode("auto")).toBe(true);
    expect(app.chat.state.error).toBeUndefined();
    expect(archive(db, app.chat.sessionId).metadata.alphacode).toEqual({ version: 1, modelId: "test-model", permissionMode: "auto" });
    expect(app.requests).toHaveLength(0);
  } finally { db.close(); await app.dispose(); }
});

test("settings changes block sending and duplicate changes, and closing waits for the write", async () => {
  const app = await fixture(() => textResponse("must not run"));
  const db = new Database(app.config.databasePath);
  try {
    const changing = app.chat.setPermissionMode("full");
    expect(app.chat.state.settingsSaving).toBe(true);
    expect(app.chat.state.permissionMode).toBe("ask");
    expect(app.chat.state.canSend).toBe(false);
    const duplicate = app.chat.setPermissionMode("auto");
    const sending = app.chat.send("must wait for settings");
    const closing = app.chat.close();
    expect(await duplicate).toBe(false);
    expect(await changing).toBe(true);
    await sending;
    await closing;
    expect(app.requests).toHaveLength(0);
    expect(app.chat.state.canSend).toBe(false);
    expect(db.query("SELECT id FROM sessions").all()).toHaveLength(0);
  } finally { db.close(); await app.dispose(); }
});

test("legacy sessions recover their recorded model, default to ask, and preserve unrelated metadata", async () => {
  const app = await fixture(() => textResponse("unused"));
  const db = new Database(app.config.databasePath);
  let resumed: Chat | undefined;
  try {
    await app.chat.send("create legacy fixture");
    await app.chat.close();
    const old = archive(db, app.chat.sessionId);
    db.query("UPDATE sessions SET body = ? WHERE id = ?").run(JSON.stringify({ ...old, agentKey: "alphacode-v1:test-model", metadata: { note: "keep me" } }), app.chat.sessionId);
    resumed = await createApplication({ ...app.config, sessionId: app.chat.sessionId, modelId: "different-default" });
    expect(resumed.modelId).toBe("test-model");
    expect(resumed.state.permissionMode).toBe("ask");
    expect(archive(db, resumed.sessionId).metadata).toEqual({ note: "keep me", alphacode: { version: 1, modelId: "test-model", permissionMode: "ask" } });
    await resumed.setPermissionMode("auto");
    expect(archive(db, resumed.sessionId).metadata.note).toBe("keep me");
  } finally { await resumed?.close(); db.close(); await app.dispose(); }
});

test("invalid saved settings and missing sessions fail before any model call", async () => {
  const app = await fixture(() => textResponse("unused"));
  const db = new Database(app.config.databasePath);
  try {
    await app.chat.send("create persisted fixture");
    app.requests.length = 0;
    await app.chat.close();
    const original = archive(db, app.chat.sessionId);
    for (const invalid of [null, [], { version: 2, modelId: "test-model", permissionMode: "full" }, { version: 1, modelId: "test-model", permissionMode: "typo" }]) {
      db.query("UPDATE sessions SET body = ? WHERE id = ?").run(JSON.stringify({ ...original, metadata: { alphacode: invalid } }), app.chat.sessionId);
      await expect(createApplication({ ...app.config, sessionId: app.chat.sessionId })).rejects.toMatchObject({ code: "SESSION_SETTINGS_INVALID" });
    }
    await expect(createApplication({ ...app.config, sessionId: "missing-session" })).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
    expect(app.requests).toHaveLength(0);
  } finally { db.close(); await app.dispose(); }
});

test("an open session cannot overwrite or execute with settings changed by another handle", async () => {
  const app = await fixture(() => textResponse("must not run"));
  let second: Chat | undefined;
  try {
    expect(await app.chat.setPermissionMode("full")).toBe(true);
    await app.chat.send("create persisted session");
    app.requests.length = 0;
    second = await createApplication({ ...app.config, sessionId: app.chat.sessionId });
    expect(await second.setPermissionMode("ask")).toBe(true);
    expect(await app.chat.setPermissionMode("auto")).toBe(false);
    expect(app.chat.state.error).toContain("SESSION_CONFLICT");
    await app.chat.send("must not execute under stale full access");
    expect(app.chat.state.error).toBe("SESSION_CONFLICT");
    expect(app.requests).toHaveLength(0);
  } finally { await second?.close(); await app.dispose(); }
});
