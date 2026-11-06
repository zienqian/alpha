import { mkdir, open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseDocument } from "yaml";
import type { PermissionMode } from "./chat/contracts";
import { ConfigurationError } from "./errors";

export interface GlobalDefaults {
  modelId?: string;
  baseURL?: string;
  apiKeyEnv?: string;
  noAuth?: boolean;
  permissionMode?: PermissionMode;
  databasePath?: string;
}

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
permissionMode: ask
# databasePath: sessions.db
`;

function invalid(file: string, field: string): never {
  throw new ConfigurationError(`${file}: Invalid ${field} configuration. Check field names, types, and allowed values.`);
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
    throw new ConfigurationError(`${file}: Invalid YAML. Check indentation, duplicate keys, or unsupported tags and aliases.`);
  }
  if (value === null) return {};
  const root = object(value, file, "root", ["provider", "model", "permissionMode", "databasePath"]);
  const defaults: GlobalDefaults = {};
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
      if (!(await handle.stat()).isFile()) throw new ConfigurationError(`${file}: Expected a regular file.`);
      const buffer = Buffer.alloc(limit + 1);
      let size = 0;
      while (size < buffer.length) {
        const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
        if (!bytesRead) break;
        size += bytesRead;
      }
      if (size > limit) throw new ConfigurationError(`${file}: File exceeds the ${limit / 1024} KiB limit.`);
      return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size));
    } finally { await handle.close(); }
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    throw new ConfigurationError(`${file}: Could not read file. Check file permissions and UTF-8 encoding.`);
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
  } catch { throw new ConfigurationError(`${directory}: Could not initialize the global configuration directory. Check directory permissions.`); }
  const defaults = parseGlobalConfig(await readBounded(configPath, 64 * 1024), configPath);
  const instructions = (await readBounded(instructionsPath, 32 * 1024)).trim();
  return { defaults, instructions, instructionsPath };
}
