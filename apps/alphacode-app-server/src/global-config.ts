export type LanguagePreference = "system" | "en" | "zh-CN";
export const isLanguagePreference = (value: unknown): value is LanguagePreference =>
  value === "system" || value === "en" || value === "zh-CN";
import { mkdir, open, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { parseDocument } from "yaml";
import type { PermissionMode } from "./chat/contracts";
import { ConfigurationError } from "./errors";

export interface BotRoleModelDefaults {
  modelId?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  baseURL?: string;
  apiKeyEnv?: string;
  noAuth?: boolean;
}

export interface BotRoleModelPatch {
  modelId?: string | null;
  contextWindow?: number | null;
  maxOutputTokens?: number | null;
  baseURL?: string | null;
  apiKeyEnv?: string | null;
  noAuth?: boolean | null;
}

export interface BotsGlobalDefaults {
  maxConcurrentWorkers?: number;
  perBotMaxWorkers?: number;
  worktreeRoot?: string;
  router?: BotRoleModelDefaults;
  worker?: BotRoleModelDefaults;
}

export interface BotsGlobalSettingsPatch {
  maxConcurrentWorkers?: number | null;
  perBotMaxWorkers?: number | null;
  worktreeRoot?: string | null;
  router?: BotRoleModelPatch | null;
  worker?: BotRoleModelPatch | null;
}

export interface GlobalDefaults {
  language?: LanguagePreference;
  skills?: SkillsSettings;
  modelId?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  autoCompact?: boolean;
  baseURL?: string;
  apiKeyEnv?: string;
  noAuth?: boolean;
  permissionMode?: PermissionMode;
  databasePath?: string;
  defaultWorkspace?: string;
  bots?: BotsGlobalDefaults;
}

export function expandHome(path: string): string {
  return path === "~" ? homedir() : /^~[/\\]/.test(path) ? join(homedir(), path.slice(2)) : path;
}

export function globalConfigDirectory(env = process.env, cwd = process.cwd()): string {
  return resolve(cwd, expandHome(env.ALPHACODE_HOME?.trim() || join(homedir(), ".alphacode")));
}

export function defaultWorkspacePath(directory: string, defaults: GlobalDefaults): string {
  return resolve(directory, expandHome(defaults.defaultWorkspace ?? "workspace"));
}

export function worktreeRootPath(directory: string, defaults: GlobalDefaults): string {
  return resolve(directory, expandHome(defaults.bots?.worktreeRoot ?? "worktrees"));
}

export interface SkillsSettings {
  sharedDirectories: boolean;
  claudeDirectories: boolean;
  trustedProjects: readonly string[];
  disabledNames: readonly string[];
}

export interface SkillsSettingsPatch {
  sharedDirectories?: boolean;
  claudeDirectories?: boolean;
  trustedProjects?: readonly string[];
  disabledNames?: readonly string[];
}

export const defaultSkillsSettings: SkillsSettings = Object.freeze({
  sharedDirectories: true, claudeDirectories: false,
  trustedProjects: Object.freeze([]), disabledNames: Object.freeze([]),
});

const template = `# AlphaCode global defaults. Environment variables override these settings.
# model:
#   id: your-model-id
#   contextWindow: 500000 # Optional override for your endpoint's actual limit.
#   maxOutputTokens: 8192 # Reserved and sent as the actual output limit.
# context:
#   autoCompact: true
# provider:
#   adapter: openai-completions
#   options:
#     baseURL: https://api.openai.com/v1
#     apiKey:
#       env: OPENAI_API_KEY
#       # For a local endpoint without authentication, use { none: true } instead.
language: system
permissionMode: ask
skills:
  sharedDirectories: true
  claudeDirectories: false
  trustedProjects: []
  disabledNames: []
# databasePath: sessions.db
# Workspace for new chats without a selected project. Relative to this config directory.
# defaultWorkspace: workspace
`;

function invalid(file: string, field: string): never {
  throw new ConfigurationError(`${file}: Invalid ${field} configuration. Check field names, types, and allowed values.`, { code: "INVALID_CONFIG", params: { file, field } });
}

function object(value: unknown, file: string, field: string, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(file, field);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !allowed.includes(key))) invalid(file, field);
  return result;
}

function string(value: unknown, file: string, field: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(file, field);
  return value.trim();
}

function parseModelSection(raw: unknown, file: string, prefix: string): Pick<BotRoleModelDefaults, "modelId" | "contextWindow" | "maxOutputTokens"> {
  const model = object(raw, file, prefix, ["id", "contextWindow", "maxOutputTokens"]);
  const result: Pick<BotRoleModelDefaults, "modelId" | "contextWindow" | "maxOutputTokens"> = {};
  if (model.id !== undefined) result.modelId = string(model.id, file, `${prefix}.id`);
  if (model.contextWindow !== undefined) {
    if (typeof model.contextWindow !== "number" || !Number.isSafeInteger(model.contextWindow) || model.contextWindow <= 0) invalid(file, `${prefix}.contextWindow`);
    result.contextWindow = model.contextWindow;
  }
  if (model.maxOutputTokens !== undefined) {
    if (typeof model.maxOutputTokens !== "number" || !Number.isSafeInteger(model.maxOutputTokens) || model.maxOutputTokens <= 0) invalid(file, `${prefix}.maxOutputTokens`);
    result.maxOutputTokens = model.maxOutputTokens;
  }
  return result;
}

function parseProviderSection(raw: unknown, file: string, prefix: string): Pick<BotRoleModelDefaults, "baseURL" | "apiKeyEnv" | "noAuth"> {
  const provider = object(raw, file, prefix, ["adapter", "options"]);
  const result: Pick<BotRoleModelDefaults, "baseURL" | "apiKeyEnv" | "noAuth"> = {};
  if (provider.adapter !== undefined && provider.adapter !== "openai-completions") invalid(file, `${prefix}.adapter (supported: openai-completions)`);
  if (provider.options !== undefined) {
    const options = object(provider.options, file, `${prefix}.options`, ["baseURL", "apiKey"]);
    if (options.baseURL !== undefined) {
      const baseURL = string(options.baseURL, file, `${prefix}.options.baseURL`);
      try { if (!["https:", "http:"].includes(new URL(baseURL).protocol)) invalid(file, `${prefix}.options.baseURL`); }
      catch { invalid(file, `${prefix}.options.baseURL`); }
      result.baseURL = baseURL;
    }
    if (options.apiKey !== undefined) {
      const key = object(options.apiKey, file, `${prefix}.options.apiKey`, ["env", "none"]);
      if (Object.keys(key).length !== 1) invalid(file, `${prefix}.options.apiKey`);
      if (key.env !== undefined) {
        const name = string(key.env, file, `${prefix}.options.apiKey.env`);
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) invalid(file, `${prefix}.options.apiKey.env`);
        result.apiKeyEnv = name;
        result.noAuth = false;
      } else {
        if (key.none !== true) invalid(file, `${prefix}.options.apiKey.none`);
        result.noAuth = true;
      }
    }
  }
  return result;
}

function parseBotRole(raw: unknown, file: string, prefix: string): BotRoleModelDefaults {
  const role = object(raw, file, prefix, ["model", "provider"]);
  const result: BotRoleModelDefaults = {};
  if (role.model !== undefined) Object.assign(result, parseModelSection(role.model, file, `${prefix}.model`));
  if (role.provider !== undefined) Object.assign(result, parseProviderSection(role.provider, file, `${prefix}.provider`));
  return result;
}

export function parseGlobalConfig(source: string, file: string): GlobalDefaults {
  let value: unknown;
  try {
    const document = parseDocument(source, { prettyErrors: false, uniqueKeys: true, stringKeys: true, merge: false });
    if (document.errors.length || document.warnings.length) throw new Error();
    value = document.toJS({ maxAliasCount: 0 });
  } catch {
    // Parser diagnostics may contain credentials or source excerpts.
    throw new ConfigurationError(`${file}: Invalid YAML. Check indentation, duplicate keys, or unsupported tags and aliases.`, { code: "INVALID_YAML", params: { file } });
  }
  if (value === null) return {};
  const root = object(value, file, "root", ["provider", "model", "context", "permissionMode", "databasePath", "defaultWorkspace", "skills", "language", "bots"]);
  const defaults: GlobalDefaults = {};
  if (root.context !== undefined) {
    const context = object(root.context, file, "context", ["autoCompact"]);
    if (context.autoCompact !== undefined) {
      if (typeof context.autoCompact !== "boolean") invalid(file, "context.autoCompact");
      defaults.autoCompact = context.autoCompact;
    }
  }
  if (root.language !== undefined) {
    if (!isLanguagePreference(root.language)) invalid(file, "language (system / en / zh-CN)");
    defaults.language = root.language;
  }
  if (root.skills !== undefined) {
    const skills = object(root.skills, file, "skills", ["sharedDirectories", "claudeDirectories", "trustedProjects", "disabledNames"]);
    const settings = { ...defaultSkillsSettings };
    for (const field of ["sharedDirectories", "claudeDirectories"] as const) {
      if (skills[field] === undefined) continue;
      if (typeof skills[field] !== "boolean") invalid(file, `skills.${field}`);
      settings[field] = skills[field];
    }
    for (const field of ["trustedProjects", "disabledNames"] as const) {
      const entries = skills[field];
      if (entries === undefined) continue;
      if (!Array.isArray(entries) || entries.some(entry => typeof entry !== "string" || (field === "trustedProjects"
        ? !isAbsolute(entry) || entry.includes("\0") : entry.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry)))) invalid(file, `skills.${field}`);
      settings[field] = [...entries];
    }
    defaults.skills = settings;
  }
  if (root.model !== undefined) Object.assign(defaults, parseModelSection(root.model, file, "model"));
  if (root.provider !== undefined) Object.assign(defaults, parseProviderSection(root.provider, file, "provider"));
  if (root.permissionMode !== undefined) {
    if (root.permissionMode !== "ask" && root.permissionMode !== "auto" && root.permissionMode !== "full") invalid(file, "permissionMode (ask / auto / full)");
    defaults.permissionMode = root.permissionMode;
  }
  if (root.databasePath !== undefined) defaults.databasePath = string(root.databasePath, file, "databasePath");
  if (root.defaultWorkspace !== undefined) {
    defaults.defaultWorkspace = string(root.defaultWorkspace, file, "defaultWorkspace");
    if (defaults.defaultWorkspace.includes("\0") || defaults.defaultWorkspace.length > 4096) invalid(file, "defaultWorkspace");
  }
  if (root.bots !== undefined) {
    const rawBots = object(root.bots, file, "bots", ["maxConcurrentWorkers", "perBotMaxWorkers", "worktreeRoot", "router", "worker"]);
    const bots: BotsGlobalDefaults = {};
    if (rawBots.maxConcurrentWorkers !== undefined) {
      if (typeof rawBots.maxConcurrentWorkers !== "number" || !Number.isSafeInteger(rawBots.maxConcurrentWorkers) || rawBots.maxConcurrentWorkers < 1 || rawBots.maxConcurrentWorkers > 12) {
        invalid(file, "bots.maxConcurrentWorkers (1..12)");
      }
      bots.maxConcurrentWorkers = rawBots.maxConcurrentWorkers;
    }
    if (rawBots.perBotMaxWorkers !== undefined) {
      if (typeof rawBots.perBotMaxWorkers !== "number" || !Number.isSafeInteger(rawBots.perBotMaxWorkers) || rawBots.perBotMaxWorkers < 1 || rawBots.perBotMaxWorkers > 4) {
        invalid(file, "bots.perBotMaxWorkers (1..4)");
      }
      bots.perBotMaxWorkers = rawBots.perBotMaxWorkers;
    }
    if (rawBots.worktreeRoot !== undefined) {
      bots.worktreeRoot = string(rawBots.worktreeRoot, file, "bots.worktreeRoot");
      if (bots.worktreeRoot.includes("\0") || bots.worktreeRoot.length > 4096) invalid(file, "bots.worktreeRoot");
    }
    if (rawBots.router !== undefined) bots.router = parseBotRole(rawBots.router, file, "bots.router");
    if (rawBots.worker !== undefined) bots.worker = parseBotRole(rawBots.worker, file, "bots.worker");
    defaults.bots = bots;
  }
  return defaults;
}

async function readBounded(file: string, limit: number, missingIsEmpty = false): Promise<string> {
  try {
    const handle = await open(file, "r");
    try {
      if (!(await handle.stat()).isFile()) throw new ConfigurationError(`${file}: Expected a regular file.`, { code: "CONFIG_NOT_FILE", params: { file } });
      const buffer = Buffer.alloc(limit + 1);
      let size = 0;
      while (size < buffer.length) {
        const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
        if (!bytesRead) break;
        size += bytesRead;
      }
      if (size > limit) throw new ConfigurationError(`${file}: File exceeds the ${limit / 1024} KiB limit.`, { code: "CONFIG_TOO_LARGE", params: { file, limit: limit / 1024 } });
      return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size));
    } finally { await handle.close(); }
  } catch (error) {
    if (missingIsEmpty && (error as NodeJS.ErrnoException).code === "ENOENT") return "";
    if (error instanceof ConfigurationError) throw error;
    throw new ConfigurationError(`${file}: Could not read file. Check file permissions and UTF-8 encoding.`, { code: "CONFIG_READ_FAILED", params: { file } });
  }
}

// Read display metadata without initializing files during an index request.
export async function readGlobalDefaults(directory: string): Promise<GlobalDefaults> {
  const file = join(directory, "config.yaml");
  return parseGlobalConfig(await readBounded(file, 64 * 1024, true), file);
}

export async function readGlobalConfig(directory: string): Promise<{
  defaults: GlobalDefaults; instructions: string; instructionsPath: string;
}> {
  const configPath = join(directory, "config.yaml");
  const instructionsPath = join(directory, "AGENTS.md");
  try {
    await mkdir(directory, { recursive: true });
    for (const [file, content] of [[configPath, template], [instructionsPath, ""]] as const) {
      try { await writeFile(file, content, { flag: "wx" }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    }
  } catch { throw new ConfigurationError(`${directory}: Could not initialize the global configuration directory. Check directory permissions.`, { code: "CONFIG_INIT_FAILED", params: { file: directory } }); }
  const defaults = parseGlobalConfig(await readBounded(configPath, 64 * 1024), configPath);
  const instructions = (await readBounded(instructionsPath, 32 * 1024)).trim();
  return { defaults, instructions, instructionsPath };
}

export async function updateSkillsSettings(directory: string, patch: SkillsSettingsPatch): Promise<SkillsSettings> {
  const configPath = join(directory, "config.yaml");
  await mkdir(directory, { recursive: true });
  try { await writeFile(configPath, template, { flag: "wx" }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const source = await readBounded(configPath, 64 * 1024);
  const current = parseGlobalConfig(source, configPath).skills ?? defaultSkillsSettings;
  const next: SkillsSettings = {
    sharedDirectories: patch.sharedDirectories ?? current.sharedDirectories,
    claudeDirectories: patch.claudeDirectories ?? current.claudeDirectories,
    trustedProjects: [...new Set(patch.trustedProjects ?? current.trustedProjects)],
    disabledNames: [...new Set(patch.disabledNames ?? current.disabledNames)],
  };
  const doc = parseDocument(source || template, { prettyErrors: false, uniqueKeys: true, stringKeys: true, merge: false });
  if (doc.errors.length || doc.warnings.length) {
    throw new ConfigurationError(`${configPath}: Invalid YAML. Check indentation, duplicate keys, or unsupported tags and aliases.`, { code: "INVALID_YAML", params: { file: configPath } });
  }
  if (!doc.contents) doc.contents = parseDocument("{}").contents;
  doc.setIn(["skills", "sharedDirectories"], next.sharedDirectories);
  doc.setIn(["skills", "claudeDirectories"], next.claudeDirectories);
  doc.setIn(["skills", "trustedProjects"], [...next.trustedProjects]);
  doc.setIn(["skills", "disabledNames"], [...next.disabledNames]);
  const updated = doc.toString();
  // Validate the serialized output before touching config.yaml.
  const verified = parseGlobalConfig(updated, configPath).skills ?? defaultSkillsSettings;
  const temporary = `${configPath}.${randomUUID()}.tmp`;
  await writeFile(temporary, updated, { mode: 0o600 });
  await rename(temporary, configPath);
  return verified;
}

function applyRolePatch(doc: ReturnType<typeof parseDocument>, role: "router" | "worker", patch: BotRoleModelPatch | null) {
  if (patch === null) {
    doc.deleteIn(["bots", role]);
    return;
  }
  if (patch.modelId !== undefined) {
    if (patch.modelId === null) doc.deleteIn(["bots", role, "model", "id"]);
    else doc.setIn(["bots", role, "model", "id"], patch.modelId);
  }
  if (patch.contextWindow !== undefined) {
    if (patch.contextWindow === null) doc.deleteIn(["bots", role, "model", "contextWindow"]);
    else doc.setIn(["bots", role, "model", "contextWindow"], patch.contextWindow);
  }
  if (patch.maxOutputTokens !== undefined) {
    if (patch.maxOutputTokens === null) doc.deleteIn(["bots", role, "model", "maxOutputTokens"]);
    else doc.setIn(["bots", role, "model", "maxOutputTokens"], patch.maxOutputTokens);
  }
  if (patch.baseURL !== undefined) {
    if (patch.baseURL === null) doc.deleteIn(["bots", role, "provider", "options", "baseURL"]);
    else doc.setIn(["bots", role, "provider", "options", "baseURL"], patch.baseURL);
  }
  if (patch.noAuth === true) {
    doc.deleteIn(["bots", role, "provider", "options", "apiKey"]);
    doc.setIn(["bots", role, "provider", "options", "apiKey", "none"], true);
  } else if (patch.apiKeyEnv !== undefined) {
    doc.deleteIn(["bots", role, "provider", "options", "apiKey"]);
    if (patch.apiKeyEnv !== null) doc.setIn(["bots", role, "provider", "options", "apiKey", "env"], patch.apiKeyEnv);
  } else if (patch.noAuth === false || patch.noAuth === null) {
    doc.deleteIn(["bots", role, "provider", "options", "apiKey", "none"]);
  }
  // Remove empty nested maps so YAML stays clean and passes strict parsing.
  for (const path of [
    ["bots", role, "model"],
    ["bots", role, "provider", "options", "apiKey"],
    ["bots", role, "provider", "options"],
    ["bots", role, "provider"],
    ["bots", role],
  ]) {
    const node = doc.getIn(path);
    if (node && typeof node === "object" && "items" in node && Array.isArray((node as { items: unknown[] }).items) && (node as { items: unknown[] }).items.length === 0) {
      doc.deleteIn(path);
    }
  }
}

export async function updateBotsGlobalSettings(directory: string, patch: BotsGlobalSettingsPatch): Promise<BotsGlobalDefaults> {
  const configPath = join(directory, "config.yaml");
  await mkdir(directory, { recursive: true });
  try { await writeFile(configPath, template, { flag: "wx" }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const source = await readBounded(configPath, 64 * 1024);
  parseGlobalConfig(source, configPath);
  const doc = parseDocument(source || template, { prettyErrors: false, uniqueKeys: true, stringKeys: true, merge: false });
  if (doc.errors.length || doc.warnings.length) {
    throw new ConfigurationError(`${configPath}: Invalid YAML. Check indentation, duplicate keys, or unsupported tags and aliases.`, { code: "INVALID_YAML", params: { file: configPath } });
  }
  if (!doc.contents) doc.contents = parseDocument("{}").contents;
  if (patch.maxConcurrentWorkers !== undefined) {
    if (patch.maxConcurrentWorkers === null) doc.deleteIn(["bots", "maxConcurrentWorkers"]);
    else doc.setIn(["bots", "maxConcurrentWorkers"], patch.maxConcurrentWorkers);
  }
  if (patch.perBotMaxWorkers !== undefined) {
    if (patch.perBotMaxWorkers === null) doc.deleteIn(["bots", "perBotMaxWorkers"]);
    else doc.setIn(["bots", "perBotMaxWorkers"], patch.perBotMaxWorkers);
  }
  if (patch.worktreeRoot !== undefined) {
    if (patch.worktreeRoot === null) doc.deleteIn(["bots", "worktreeRoot"]);
    else doc.setIn(["bots", "worktreeRoot"], patch.worktreeRoot);
  }
  if (patch.router !== undefined) applyRolePatch(doc, "router", patch.router);
  if (patch.worker !== undefined) applyRolePatch(doc, "worker", patch.worker);
  const botsNode = doc.getIn(["bots"]);
  if (botsNode && typeof botsNode === "object" && "items" in botsNode && Array.isArray((botsNode as { items: unknown[] }).items) && (botsNode as { items: unknown[] }).items.length === 0) {
    doc.deleteIn(["bots"]);
  }
  const updated = doc.toString();
  const verified = parseGlobalConfig(updated, configPath).bots ?? {};
  const temporary = `${configPath}.${randomUUID()}.tmp`;
  await writeFile(temporary, updated, { mode: 0o600 });
  await rename(temporary, configPath);
  return verified;
}
