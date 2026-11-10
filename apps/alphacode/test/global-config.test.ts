import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createApplication } from "../src/application";
import type { Chat } from "../src/chat/contracts";
import { loadConfig, readConfig } from "../src/config";
import { parseGlobalConfig } from "../src/global-config";
import { textResponse, type RequestBody } from "./helpers";

const yaml = `provider:
  adapter: openai-completions
  options:
    baseURL: https://offline.invalid/v1
    apiKey:
      none: true
model:
  id: global-model
permissionMode: auto
databasePath: data/sessions.db
`;

test("first load creates editable global files without overwriting them on later starts", async () => {
  const root = await mkdtemp(join(tmpdir(), "alphacode-config-"));
  const directory = join(root, "global");
  try {
    const env = { ALPHACODE_HOME: directory, ADK_MODEL: "env-model" };
    const initial = await loadConfig(env, [], root);
    expect(initial.modelId).toBe("env-model");
    expect(initial.permissionMode).toBe("ask");
    expect(initial.databasePath).toBe(join(directory, "sessions.db"));
    expect(initial.globalInstructions).toBe("");
    expect(await readFile(join(directory, "AGENTS.md"), "utf8")).toBe("");
    expect(await readFile(join(directory, "config.yaml"), "utf8")).toContain("permissionMode: ask");
    expect(await readFile(join(directory, "config.yaml"), "utf8")).not.toContain("enabled:");
    await writeFile(join(directory, "config.yaml"), yaml);
    await writeFile(join(directory, "AGENTS.md"), "使用中文回答。\n");
    const loaded = await loadConfig({ ALPHACODE_HOME: directory }, [], root);
    expect(loaded.modelId).toBe("global-model");
    expect(loaded.baseURL).toBe("https://offline.invalid/v1");
    expect(loaded.noAuth).toBe(true);
    expect(loaded.permissionMode).toBe("auto");
    expect(loaded.databasePath).toBe(join(directory, "data/sessions.db"));
    expect(loaded.globalInstructions).toBe("使用中文回答。");
    expect(await readFile(join(directory, "config.yaml"), "utf8")).toBe(yaml);
    expect(await readFile(join(directory, "AGENTS.md"), "utf8")).toBe("使用中文回答。\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("environment and workspace arguments override global defaults, with paths resolved from their source", () => {
  const cwd = join(tmpdir(), "workspace");
  const defaults = parseGlobalConfig(yaml, "config.yaml");
  const config = readConfig({
    ALPHACODE_HOME: "../config", ADK_MODEL: "env-model", ADK_BASE_URL: "https://env.invalid/v1",
    ADK_API_KEY_ENV: "MY_KEY", ALPHACODE_PERMISSION: "ask", ALPHACODE_DB: "archive.db", ALPHACODE_WORKSPACE: "ignored",
  }, ["project"], cwd, defaults);
  expect(config.workspaceRoot).toBe(join(cwd, "project"));
  expect(config.configDirectory).toBe(join(tmpdir(), "config"));
  expect(config.databasePath).toBe(join(cwd, "archive.db"));
  expect(config.modelId).toBe("env-model");
  expect(config.baseURL).toBe("https://env.invalid/v1");
  expect(config.apiKeyEnv).toBe("MY_KEY");
  expect(config.noAuth).toBe(false);
  expect(config.permissionMode).toBe("ask");
  expect(readConfig({ ADK_AUTH: "api_key" }, [], cwd, defaults).noAuth).toBe(false);
  expect(readConfig({ ADK_AUTH: "none", ADK_API_KEY_ENV: "MY_KEY" }, [], cwd, defaults).noAuth).toBe(true);
  expect(readConfig({ ALPHACODE_HOME: "~/.alphacode-custom" }, ["~"], cwd, defaults).configDirectory).toBe(join(homedir(), ".alphacode-custom"));
  expect(readConfig({}, ["~"], cwd, defaults).workspaceRoot).toBe(homedir());
  expect(() => readConfig({ ALPHACODE_PERMISSION: "typo" }, [], cwd, defaults)).toThrow("ALPHACODE_PERMISSION");
  expect(() => readConfig({ ADK_MODEL: "" }, [], cwd, defaults)).toThrow("ADK_MODEL");
});

test("credential references are parsed without storing secrets; malformed or ambiguous YAML is rejected", () => {
  expect(parseGlobalConfig("provider: { options: { apiKey: { env: CUSTOM_KEY } } }", "config.yaml")).toEqual({ apiKeyEnv: "CUSTOM_KEY", noAuth: false });
  expect(parseGlobalConfig("# empty defaults\n", "config.yaml")).toEqual({});
  const invalid = [
    "model: [unterminated", "model: one\nmodel: two", "permissionMode: ask\npermissionMode: full",
    "- model", "model: { id: 123 }", "permissionMode: all", "permissions: full",
    "provider: { adapter: unknown }", "provider: { options: { baseURL: 'file:///private' } }",
    "provider: { options: { apiKey: secret-value } }", "provider: { options: { apiKey: { env: KEY, none: true } } }",
    "provider: { options: { apiKey: { none: false } } }", "provider: { options: { apiKey: { env: 'bad name' } } }",
    "model: !custom secret-value", "model: &x { id: global }\nprovider: *x", "databasePath: []",
  ];
  for (const source of invalid) {
    let message = "";
    try { parseGlobalConfig(source, "config.yaml"); } catch (error) { message = (error as Error).message; }
    expect(message).toContain("config.yaml");
    expect(message).not.toContain("secret-value");
  }
});

test("oversized or invalid instruction files fail explicitly instead of silently dropping configuration", async () => {
  const root = await mkdtemp(join(tmpdir(), "alphacode-config-limits-"));
  try {
    const env = { ALPHACODE_HOME: root, ADK_MODEL: "model" };
    await loadConfig(env, [], root);
    await writeFile(join(root, "config.yaml"), " ".repeat(65537));
    await expect(loadConfig(env, [], root)).rejects.toThrow("64 KiB");
    await writeFile(join(root, "config.yaml"), yaml);
    await writeFile(join(root, "AGENTS.md"), "中".repeat(11000));
    await expect(loadConfig(env, [], root)).rejects.toThrow("32 KiB");
    await writeFile(join(root, "AGENTS.md"), Buffer.from([0xff, 0xfe]));
    await expect(loadConfig(env, [], root)).rejects.toThrow("UTF-8");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("global instructions precede project and user instructions; defaults persist per session and restore wins", async () => {
  const root = await mkdtemp(join(tmpdir(), "alphacode-global-runtime-"));
  const directory = join(root, "global"), workspace = join(root, "project");
  const chats: Chat[] = [];
  const requests: RequestBody[] = [];
  const provider = { fetch: async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as RequestBody;
    if (!body.stream) return Response.json({ choices: [{ message: { content: "Test conversation" }, finish_reason: "stop" }] });
    requests.push(body);
    return textResponse("done");
  } };
  try {
    await mkdir(directory);
    await mkdir(workspace);
    await writeFile(join(directory, "config.yaml"), yaml);
    await writeFile(join(directory, "AGENTS.md"), "GLOBAL_SENTINEL: use concise answers.");
    await writeFile(join(workspace, "AGENTS.md"), "PROJECT_SENTINEL: describe this project.");
    const env = { ALPHACODE_HOME: directory };
    const config = await loadConfig(env, [], workspace);
    const chat = await createApplication(config, { provider });
    chats.push(chat);
    expect(chat.modelId).toBe("global-model");
    expect(chat.state.permissionMode).toBe("auto");
    await chat.send("USER_SENTINEL");
    const first = requests[0];
    expect(first?.model).toBe("global-model");
    const messages = first?.messages ?? [];
    const globalIndex = messages.findIndex(message => message.content.includes("GLOBAL_SENTINEL"));
    const projectIndex = messages.findIndex(message => message.content.includes("PROJECT_SENTINEL"));
    const userIndex = messages.findIndex(message => message.content === "USER_SENTINEL");
    expect(globalIndex).toBeGreaterThan(0);
    expect(projectIndex).toBeGreaterThan(globalIndex);
    expect(userIndex).toBeGreaterThan(projectIndex);
    expect(messages.filter(message => message.content.includes("GLOBAL_SENTINEL"))).toHaveLength(1);
    await chat.setPermissionMode("full");
    await chat.close();
    expect(await readFile(join(directory, "config.yaml"), "utf8")).toBe(yaml);

    await writeFile(join(directory, "config.yaml"), yaml.replace("global-model", "new-default-model").replace("permissionMode: auto", "permissionMode: ask"));
    await writeFile(join(directory, "AGENTS.md"), "UPDATED_GLOBAL_SENTINEL");
    const updated = await loadConfig(env, [], workspace);
    const fresh = await createApplication(updated, { provider });
    chats.push(fresh);
    expect(fresh.modelId).toBe("new-default-model");
    expect(fresh.state.permissionMode).toBe("ask");
    const resumed = await createApplication({ ...updated, sessionId: chat.sessionId }, { provider });
    chats.push(resumed);
    expect(resumed.modelId).toBe("global-model");
    expect(resumed.state.permissionMode).toBe("full");
    await resumed.send("continue");
    expect(JSON.stringify(requests[1])).toContain("UPDATED_GLOBAL_SENTINEL");
    expect(JSON.stringify(requests[1])).not.toContain("GLOBAL_SENTINEL: use concise answers.");
    const db = new Database(config.databasePath, { readonly: true });
    try {
      const row = db.query("SELECT body FROM sessions WHERE id = ?").get(chat.sessionId) as { body: string };
      const stored = JSON.parse(row.body);
      expect(stored.metadata.alphacode).toEqual({ version: 1, modelId: "global-model", permissionMode: "full" });
      expect(row.body).not.toContain("GLOBAL_SENTINEL");
      expect(row.body).not.toContain("PROJECT_SENTINEL");
    } finally { db.close(); }
  } finally {
    for (const chat of chats) await chat.close();
    await rm(root, { recursive: true, force: true });
  }
});
