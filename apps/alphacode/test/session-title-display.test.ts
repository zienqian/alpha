import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { SessionData } from "@alpha/adk-session";
import type { Chat } from "../src/chat/contracts";
import { createApplication } from "../src/application";
import { fixture, textResponse } from "./helpers";

function archive(database: Database, id: string): SessionData {
  const row = database.query("SELECT body FROM sessions WHERE id = ?").get(id) as { body: string };
  return JSON.parse(row.body);
}

test("sending and restoring messages never extracts or saves a session title", async () => {
  const app = await fixture(() => textResponse("done"));
  const database = new Database(app.config.databasePath);
  let resumed: Chat | undefined;
  try {
    database.exec("CREATE TRIGGER reject_title BEFORE UPDATE ON sessions WHEN json_extract(NEW.body, '$.title') <> json_extract(OLD.body, '$.title') BEGIN SELECT RAISE(ABORT, 'Unexpected title write'); END");
    expect(app.chat.state.sessionTitle).toBe("AlphaCode");
    await app.chat.send("Do not extract this task as the title");
    expect(app.chat.state.error).toBeUndefined();
    expect(app.chat.state.sessionTitle).toBe("AlphaCode");
    expect(archive(database, app.chat.sessionId).title).toBe("AlphaCode");
    expect(app.requests).toHaveLength(1);
    await app.chat.close();

    resumed = await createApplication({ ...app.config, sessionId: app.chat.sessionId }, { provider: { fetch: async () => textResponse("continued") } });
    expect(resumed.state.sessionTitle).toBe("AlphaCode");
    await resumed.send("Do not replace the existing title either");
    expect(resumed.state.error).toBeUndefined();
    expect(archive(database, resumed.sessionId).title).toBe("AlphaCode");
  } finally {
    await resumed?.close();
    database.close();
    await app.dispose();
  }
});

test("saved titles are sanitized for display without changing the stored title", async () => {
  const app = await fixture(() => textResponse("done"));
  const database = new Database(app.config.databasePath);
  let resumed: Chat | undefined;
  try {
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
