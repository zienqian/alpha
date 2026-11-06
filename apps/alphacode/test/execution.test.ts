import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { lstat, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createApplication } from "../src/application";
import { fixture, textResponse, toolResponse } from "./helpers";

function batchReads(count: number): Response {
  const tool_calls = Array.from({ length: count }, (_, index) => ({
    index, id: `read-${index}`, type: "function",
    function: { name: "read_file", arguments: JSON.stringify({ path: "large.txt", lineCount: 1 }) },
  }));
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls }, finish_reason: "tool_calls" }] })}\n\ndata: [DONE]\n\n`);
}

test("AlphaCode completes and resumes beyond former call and history limits", async () => {
  const app = await fixture((_body, index) => index <= 26 ? batchReads(20) : textResponse("finished"));
  try {
    await writeFile(join(app.config.workspaceRoot, "large.txt"), "x".repeat(9000));
    await app.chat.send("process all files");
    expect(app.chat.state.status).toBe("Ready");
    expect(app.requests).toHaveLength(27);
    expect(app.chat.state.messages.filter(message => message.role === "tool" && message.note === "Completed")).toHaveLength(520);
    await app.chat.close();
    const db = new Database(app.config.databasePath, { readonly: true });
    try {
      const row = db.query("SELECT body FROM sessions WHERE id = ?").get(app.chat.sessionId) as { body: string };
      const saved = JSON.parse(row.body);
      expect(saved.turns[0].messages.length).toBeGreaterThan(512);
      expect(Buffer.byteLength(JSON.stringify(saved.turns[0].messages))).toBeGreaterThan(4 * 1024 * 1024);
    } finally { db.close(); }
    let restored = false;
    const resumed = await createApplication({ ...app.config, sessionId: app.chat.sessionId }, { provider: { fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      restored = body.messages.length > 512 && Buffer.byteLength(JSON.stringify(body.messages)) > 4 * 1024 * 1024;
      return textResponse("resumed");
    } } });
    try {
      await resumed.send("continue");
      expect(restored).toBe(true);
      expect(resumed.state.status).toBe("Ready");
      expect(resumed.state.messages.at(-1)?.text).toBe("resumed");
    } finally { await resumed.close(); }
  } finally { await app.dispose(); }
}, 30000);

test("AlphaCode reads, edits, creates, lists and searches outside cwd and through links", async () => {
  let outside = "";
  const app = await fixture((_body, index) => {
    switch (index) {
      case 1: return toolResponse("read_file", { path: "../outside/original.txt" });
      case 2: return toolResponse("edit_file", { path: join(outside, "original.txt"), oldText: "before", newText: "after" });
      case 3: return toolResponse("read_file", { path: "linked/original.txt" });
      case 4: return toolResponse("edit_file", { path: "linked/original.txt", oldText: "after", newText: "linked edit" });
      case 5: return toolResponse("create_file", { path: "linked/created.txt", content: "created outside" });
      case 6: return toolResponse("list_files", { path: outside, glob: "*.txt" });
      case 7: return toolResponse("search", { path: "../outside", query: "linked edit" });
      case 8: return toolResponse("list_files", { glob: "*.txt" });
      case 9: return toolResponse("search", { query: "created outside" });
      default: return textResponse("done");
    }
  });
  try {
    outside = join(dirname(app.config.workspaceRoot), "outside");
    await mkdir(outside);
    await writeFile(join(outside, "original.txt"), "before");
    await symlink(outside, join(app.config.workspaceRoot, "linked"), process.platform === "win32" ? "junction" : "dir");
    await app.chat.send("edit linked files");
    expect(app.chat.state.status).toBe("Ready");
    expect(await readFile(join(outside, "original.txt"), "utf8")).toBe("linked edit");
    expect(await readFile(join(outside, "created.txt"), "utf8")).toBe("created outside");
    expect((await lstat(join(app.config.workspaceRoot, "linked"))).isSymbolicLink()).toBe(true);
    const results = app.requests.at(-1)?.messages.filter(message => message.role === "tool").map(message => JSON.parse(message.content)) ?? [];
    expect(results).toHaveLength(9);
    expect(results.every(result => result.ok)).toBe(true);
    expect(results[5].data.paths).toContain(join(outside, "created.txt").replaceAll("\\", "/"));
    expect(results[6].data.matches[0].text).toBe("linked edit");
    expect(results[7].data.paths).toContain(join(outside, "created.txt").replaceAll("\\", "/"));
    expect(results[8].data.matches[0].text).toBe("created outside");
  } finally { await app.dispose(); }
});

test("AlphaCode commands can run past 60 seconds in an external cwd without a deadline", async () => {
  const app = await fixture((_body, index) => index === 1
    ? toolResponse("run_command", { command: "node slow.cjs", cwd: "../outside", timeoutMs: 1 })
    : index === 2 ? toolResponse("run_command", { command: "echo longer-timeout-accepted", timeoutMs: 90000 })
      : textResponse("done"));
  try {
    const outside = join(dirname(app.config.workspaceRoot), "outside");
    await mkdir(outside);
    await writeFile(join(outside, "slow.cjs"), "setTimeout(() => console.log('finished-after-61s'), 61000);");
    await app.chat.setPermissionMode("full");
    await app.chat.send("run the long command");
    expect(app.chat.state.status).toBe("Ready");
    expect(app.chat.state.canSend).toBe(true);
    expect(JSON.stringify(app.requests.at(-1))).toContain("finished-after-61s");
    expect(JSON.stringify(app.requests.at(-1))).toContain("longer-timeout-accepted");
  } finally { await app.dispose(); }
}, 90000);
