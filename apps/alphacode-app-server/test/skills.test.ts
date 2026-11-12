import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, mkdir, writeFile, unlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { SessionData } from "@alpha/adk-session";
import type { AppConfig } from "../src/config";
import type { ChatRuntime } from "../src/chat/contracts";
import { createApprovals } from "../src/chat/approval";
import { createChat } from "../src/chat/controller";
import { createRuntime } from "../src/runtime/create-runtime";
import { loadRuntimeSkills, prepareSkillInput } from "../src/runtime/skills";
import { parseGlobalConfig, type SkillsSettings } from "../src/global-config";
import { parseInput, skillInputDisplay, skillInputPrefix } from "../src/input";
import { completeToolRecord, createToolRecord } from "../src/runtime/tool-records";
import { textResponse, toolResponse, type RequestBody } from "./helpers";

const document = (name: string, body = "Full skill instructions.\n", fields = "") => `---\nname: ${name}\ndescription: Review source carefully\n${fields}---\n${body}`;

async function setup(reply: (body: RequestBody, index: number) => Response = () => textResponse("done")) {
  const directory = await mkdtemp(join(tmpdir(), "alphacode-skills-"));
  const config: AppConfig & { skills: SkillsSettings } = {
    workspaceRoot: join(directory, "workspace"), configDirectory: join(directory, "config"), databasePath: join(directory, "sessions.db"),
    modelId: "test-model", baseURL: "https://offline.invalid/v1", apiKeyEnv: "UNUSED_KEY", noAuth: true,
    skills: { sharedDirectories: false, claudeDirectories: false, trustedProjects: [], disabledNames: [] },
  };
  await mkdir(config.workspaceRoot);
  const runtimes: ChatRuntime[] = [], requests: RequestBody[] = [];
  const provider = { fetch: async (_url: unknown, init?: RequestInit) => {
    init?.signal?.throwIfAborted();
    const body = JSON.parse(String(init?.body)) as RequestBody;
    if (!body.stream) return Response.json({ choices: [{ message: { content: "Review source" }, finish_reason: "stop" }] });
    requests.push(body);
    return reply(body, requests.length);
  } };
  return {
    config, requests,
    async write(path: string, text: string) {
      const target = join(directory, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, text);
      return target;
    },
    async open(overrides: Partial<AppConfig> = {}) {
      const runtime = await createRuntime({ ...config, ...overrides }, { provider });
      runtimes.push(runtime);
      return runtime;
    },
    snapshot(id: string): SessionData {
      const database = new Database(config.databasePath);
      try { return JSON.parse((database.query("SELECT body FROM sessions WHERE id = ?").get(id) as { body: string }).body); }
      finally { database.close(); }
    },
    hasSession(id: string): boolean {
      const database = new Database(config.databasePath);
      try { return database.query("SELECT id FROM sessions WHERE id = ?").get(id) !== null; }
      finally { database.close(); }
    },
    async [Symbol.asyncDispose]() {
      for (const runtime of runtimes) await runtime.close();
      expect(dirname(resolve(directory))).toBe(resolve(tmpdir()));
      expect(basename(directory).startsWith("alphacode-skills-")).toBe(true);
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("skills settings validate booleans, absolute trust roots, names and unknown keys", () => {
  expect(parseGlobalConfig("skills: {}", "config.yaml").skills).toEqual({ sharedDirectories: true, claudeDirectories: false, trustedProjects: [], disabledNames: [] });
  const settings = parseGlobalConfig(`skills:\n  trustedProjects: [${JSON.stringify(process.cwd())}]\n  disabledNames: [review]\n`, "config.yaml").skills;
  expect(settings?.disabledNames).toEqual(["review"]);
  for (const field of ["enabled: true", "enabled: false", "trustedProjects: [relative]", "disabledNames: [Bad]", "refresh: true", "sharedDirectories: 1"]) {
    expect(() => parseGlobalConfig(`skills: {${field}}`, "config.yaml")).toThrow("Invalid");
  }
});

test("project trust is exact and independent of full permissions, with project-first precedence", async () => {
  await using workspace = await setup();
  await workspace.write("workspace/.alphacode/skills/review/SKILL.md", document("review", "project body"));
  await workspace.write("config/skills/review/SKILL.md", document("review", "user body"));
  let loaded = await loadRuntimeSkills({ ...workspace.config, permissionMode: "full" }, workspace.config.workspaceRoot);
  expect(loaded.skills[0]?.source).toBe("user");
  expect(loaded.diagnostics.some(entry => entry.code === "SKILL_ROOT_UNTRUSTED")).toBe(true);
  loaded = await loadRuntimeSkills({ ...workspace.config, skills: { ...workspace.config.skills, trustedProjects: [dirname(workspace.config.workspaceRoot)] } }, workspace.config.workspaceRoot);
  expect(loaded.skills[0]?.source).toBe("user");
  loaded = await loadRuntimeSkills({ ...workspace.config, skills: { ...workspace.config.skills, trustedProjects: [workspace.config.workspaceRoot] } }, workspace.config.workspaceRoot);
  expect(loaded.skills[0]?.source).toBe("project");
  expect(loaded.diagnostics.some(entry => entry.code === "SKILL_SHADOWED")).toBe(true);
});

test("directory settings select shared and Claude roots without disabling native skills", async () => {
  await using workspace = await setup();
  await workspace.write("workspace/.agents/skills/shared/SKILL.md", document("shared"));
  await workspace.write("workspace/.claude/skills/claude/SKILL.md", document("claude"));
  await workspace.write("workspace/.alphacode/skills/native/SKILL.md", document("native"));
  const config = { ...workspace.config, skills: { ...workspace.config.skills, trustedProjects: [workspace.config.workspaceRoot] } };
  expect((await loadRuntimeSkills(config, config.workspaceRoot)).skills.map(skill => skill.name)).toEqual(["native"]);
  const loaded = await loadRuntimeSkills({ ...config, skills: { ...config.skills, sharedDirectories: true, claudeDirectories: true } }, config.workspaceRoot);
  expect(loaded.skills.some(skill => skill.name === "shared")).toBe(true);
  expect(loaded.skills.some(skill => skill.name === "claude")).toBe(true);
  expect(loaded.skills.some(skill => skill.name === "native")).toBe(true);
});

test("manual invocation preserves literal arguments and persists full deterministic input, not fake tool calls", async () => {
  await using workspace = await setup();
  const path = await workspace.write("config/skills/review/SKILL.md", document("review", "Literal $ARGUMENTS and !`echo never`.\n", "disable-model-invocation: true\nargument-hint: <path>\n"));
  const loaded = await loadRuntimeSkills(workspace.config, workspace.config.workspaceRoot);
  const command = "/review   src/file.ts\n  $HOME !`echo nope`  ";
  const signal = new AbortController().signal;
  const first = await prepareSkillInput(command, loaded.skills, signal);
  expect(await prepareSkillInput(command, loaded.skills, signal)).toBe(first);
  expect(skillInputDisplay(first)).toBe(command);
  const runtime = await workspace.open();
  const chat = createChat(runtime, createApprovals());
  await chat.send(command);
  expect(chat.state.error).toBeUndefined();
  expect(chat.state.messages.find(message => message.role === "user")?.text).toBe(command);
  const sent = workspace.requests[0]?.messages.find(message => message.content.startsWith(skillInputPrefix));
  expect(sent?.content).toBe(first);
  const encoded = JSON.parse(first.slice(skillInputPrefix.length));
  expect(encoded.arguments).toBe("  src/file.ts\n  $HOME !`echo nope`  ");
  expect(encoded.skill.content).toBe("Literal $ARGUMENTS and !`echo never`.\n");
  const saved = workspace.snapshot(runtime.sessionId);
  expect(saved.title).toBe("Review source");
  expect(chat.state.sessionTitle).toBe(saved.title);
  expect(saved.agentKey).toBe("alphacode-v2:test-model");
  expect(saved.turns[0]?.messages[0]).toMatchObject({ role: "user", content: first });
  expect(saved.turns[0]?.messages.some(message => message.role === "toolResult")).toBe(false);
  await chat.close();
  await unlink(path);
  const resumed = await workspace.open({ sessionId: runtime.sessionId });
  expect(resumed.sessionTitle).toBe(saved.title);
  expect(resumed.messages[0]?.text).toBe(command);
  expect(resumed.messages[0]?.rawText).toBe(first);
});

test("listing and bad slash commands never enter a Session run; escaped slash is normal text", async () => {
  await using workspace = await setup();
  const path = await workspace.write("config/skills/review/SKILL.md", document("review"));
  const runtime = await workspace.open();
  await writeFile(path, "changed after loading");
  const chat = createChat(runtime, createApprovals());
  await chat.send("/skills");
  expect(chat.state.messages.at(-1)?.text).toContain("/review");
  expect(chat.state.messages.at(-1)?.completion).toBeUndefined();
  expect(workspace.requests).toHaveLength(0);
  await expect(runtime.send("/unknown")).rejects.toMatchObject({ code: "SKILL_NOT_FOUND" });
  await expect(runtime.send("/review argument")).rejects.toMatchObject({ code: "SKILL_CHANGED" });
  expect(workspace.hasSession(runtime.sessionId)).toBe(false);
  await runtime.send("//review not a command");
  expect(workspace.requests[0]?.messages.at(-1)?.content).toBe("/review not a command");
  await chat.close();
});

test("model calls readSkill with complete content and UI recognizes business failures", async () => {
  await using workspace = await setup((_body, index) => index === 1 ? toolResponse("readSkill", { name: "review" }) : textResponse("reviewed"));
  await workspace.write("config/skills/review/SKILL.md", document("review", "Body visible only after readSkill.\n", "user-invocable: false\n"));
  const runtime = await workspace.open();
  await expect(runtime.send("/review")).rejects.toMatchObject({ code: "SKILL_USER_INVOCATION_DISABLED" });
  await runtime.send("review this code");
  expect(workspace.requests[0]?.tools.some(tool => tool.function.name === "readSkill")).toBe(true);
  expect(JSON.stringify(workspace.requests[0]?.messages)).not.toContain("Body visible only");
  expect(JSON.stringify(workspace.requests[1]?.messages)).toContain("Body visible only after readSkill.");
  const record = createToolRecord("assistant", { id: "call", name: "readSkill", arguments: { name: "review" } });
  expect(record.description).toBe("Read skill: review");
  const failed = completeToolRecord(record, { execution: "succeeded", content: '{"ok":false,"code":"SKILL_CHANGED"}' });
  expect(failed.status).toBe("failed");
});

test("manual preparation cancels and closes without model calls or pending Session input", async () => {
  await using workspace = await setup();
  await workspace.write("config/skills/review/SKILL.md", document("review"));
  const runtime = await workspace.open();
  const sending = runtime.send("/review");
  await expect(runtime.setPermissionMode("full")).rejects.toMatchObject({ code: "SESSION_BUSY" });
  runtime.cancel();
  expect((await sending).status).toBe("cancelled");
  expect(workspace.hasSession(runtime.sessionId)).toBe(false);
  const again = runtime.send("/review");
  const closing = runtime.close();
  expect((await again).status).toBe("cancelled");
  await closing;
  expect(workspace.requests).toHaveLength(0);
  expect(workspace.hasSession(runtime.sessionId)).toBe(false);
});

test("legacy sessions always load skills and include readSkill when resumed", async () => {
  await using workspace = await setup();
  await workspace.write("config/skills/review/SKILL.md", document("review"));
  const legacy = await workspace.open();
  await legacy.send("create legacy fixture");
  workspace.requests.length = 0;
  await legacy.close();
  const saved = workspace.snapshot(legacy.sessionId);
  const database = new Database(workspace.config.databasePath);
  try {
    database.query("UPDATE sessions SET body = ? WHERE id = ?").run(JSON.stringify({ ...saved, agentKey: "alphacode-v1:test-model" }), legacy.sessionId);
  } finally { database.close(); }
  const resumed = await workspace.open({ sessionId: legacy.sessionId });
  expect(resumed.skills?.map(skill => skill.name)).toEqual(["review"]);
  await resumed.send("hi");
  expect(workspace.requests[0]?.tools).toHaveLength(7);
  expect(workspace.requests[0]?.tools.some(tool => tool.function.name === "readSkill")).toBe(true);
  await resumed.send("/review");
  expect(workspace.requests[1]?.messages.at(-1)?.content).toContain(skillInputPrefix);
});

test("input limits reject before model execution; history envelopes are display-only and validated", async () => {
  await using workspace = await setup();
  await workspace.write("config/skills/review/SKILL.md", document("review", '"'.repeat(30000)));
  const runtime = await workspace.open();
  await expect(runtime.send("/review " + "x".repeat(8193))).rejects.toMatchObject({ code: "SKILL_ARGUMENTS_TOO_LARGE" });
  await expect(runtime.send("/review")).rejects.toMatchObject({ code: "SKILL_CONTENT_TOO_LARGE" });
  expect(workspace.requests).toHaveLength(0);
  expect(workspace.hasSession(runtime.sessionId)).toBe(false);
  for (const input of [skillInputPrefix + "not json", skillInputPrefix + JSON.stringify({ kind: "alpha.skill-input", version: 2, displayText: "hidden" })]) expect(skillInputDisplay(input)).toBe(input);
  expect(parseInput("  /review  arg ")).toMatchObject({ name: "review", arguments: " arg ", displayText: "  /review  arg " });
});
