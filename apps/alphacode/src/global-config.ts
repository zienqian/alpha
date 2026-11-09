import { isLanguagePreference, type LanguagePreference } from "./i18n/locale";
import { mkdir, open, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { parseDocument } from "yaml";
import type { PermissionMode } from "./chat/contracts";
import { ConfigurationError } from "./errors";

export interface GlobalDefaults {
  language?: LanguagePreference;
  skills?: SkillsSettings;
  modelId?: string;
  baseURL?: string;
  apiKeyEnv?: string;
  noAuth?: boolean;
  permissionMode?: PermissionMode;
  databasePath?: string;
}

export interface SkillsSettings {
  sharedDirectories: boolean;
  claudeDirectories: boolean;
  trustedProjects: readonly string[];
  disabledNames: readonly string[];
}

export const defaultSkillsSettings: SkillsSettings = Object.freeze({
  sharedDirectories: true, claudeDirectories: false,
  trustedProjects: Object.freeze([]), disabledNames: Object.freeze([]),
});

const template = `# AlphaCode global defaults. Environment variables override these settings.
# model:
#   id: your-model-id
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
  const root = object(value, file, "root", ["provider", "model", "permissionMode", "databasePath", "skills", "language"]);
  const defaults: GlobalDefaults = {};
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
  if (root.model !== undefined) {
    const model = object(root.model, file, "model", ["id"]);
    if (model.id !== undefined) defaults.modelId = string(model.id, file, "model.id");
  }
  if (root.provider !== undefined) {
    const provider = object(root.provider, file, "provider", ["adapter", "options"]);
    if (provider.adapter !== undefined && provider.adapter !== "openai-completions") invalid(file, "provider.adapter (supported: openai-completions)");
    if (provider.options !== undefined) {
      const options = object(provider.options, file, "provider.options", ["baseURL", "apiKey"]);
      if (options.baseURL !== undefined) {
        const baseURL = string(options.baseURL, file, "provider.options.baseURL");
        try { if (!["https:", "http:"].includes(new URL(baseURL).protocol)) invalid(file, "provider.options.baseURL"); }
        catch { invalid(file, "provider.options.baseURL"); }
        defaults.baseURL = baseURL;
      }
      if (options.apiKey !== undefined) {
        const key = object(options.apiKey, file, "provider.options.apiKey", ["env", "none"]);
        if (Object.keys(key).length !== 1) invalid(file, "provider.options.apiKey");
        if (key.env !== undefined) {
          const name = string(key.env, file, "provider.options.apiKey.env");
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) invalid(file, "provider.options.apiKey.env");
          defaults.apiKeyEnv = name;
          defaults.noAuth = false;
        } else {
          if (key.none !== true) invalid(file, "provider.options.apiKey.none");
          defaults.noAuth = true;
        }
      }
    }
  }
  if (root.permissionMode !== undefined) {
    if (root.permissionMode !== "ask" && root.permissionMode !== "auto" && root.permissionMode !== "full") invalid(file, "permissionMode (ask / auto / full)");
    defaults.permissionMode = root.permissionMode;
  }
  if (root.databasePath !== undefined) defaults.databasePath = string(root.databasePath, file, "databasePath");
  return defaults;
}

async function readBounded(file: string, limit: number): Promise<string> {
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
    if (error instanceof ConfigurationError) throw error;
    throw new ConfigurationError(`${file}: Could not read file. Check file permissions and UTF-8 encoding.`, { code: "CONFIG_READ_FAILED", params: { file } });
  }
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
