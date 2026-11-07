import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { PermissionMode } from "./chat/contracts";
import { ConfigurationError } from "./errors";
import { readGlobalConfig, type GlobalDefaults, type SkillsSettings } from "./global-config";

export { ConfigurationError } from "./errors";

export interface AppConfig {
  skills?: SkillsSettings;
  workspaceRoot: string;
  databasePath: string;
  modelId: string;
  baseURL: string;
  apiKeyEnv: string;
  noAuth: boolean;
  sessionId?: string;
  permissionMode?: PermissionMode;
  configDirectory?: string;
  globalInstructions?: string;
  globalInstructionsPath?: string;
}

function expandHome(path: string): string {
  return path === "~" ? homedir() : /^~[/\\]/.test(path) ? join(homedir(), path.slice(2)) : path;
}

function configDirectory(env: Record<string, string | undefined>, cwd: string): string {
  return resolve(cwd, expandHome(env.ALPHACODE_HOME?.trim() || join(homedir(), ".alphacode")));
}

export async function loadConfig(
  env: Record<string, string | undefined> = process.env,
  args: readonly string[] = process.argv.slice(2),
  cwd = process.cwd(),
): Promise<AppConfig> {
  const directory = configDirectory(env, cwd);
  const global = await readGlobalConfig(directory);
  return {
    ...readConfig(env, args, cwd, global.defaults),
    globalInstructions: global.instructions,
    globalInstructionsPath: global.instructionsPath,
  };
}

export function readConfig(
  env: Record<string, string | undefined> = process.env,
  args: readonly string[] = process.argv.slice(2),
  cwd = process.cwd(),
  defaults: GlobalDefaults = {},
): AppConfig {
  if (args.length > 1 || args[0]?.startsWith("-")) {
    throw new ConfigurationError("Usage: alphacode [workspace path]");
  }
  const directory = configDirectory(env, cwd);
  const modelId = env.ADK_MODEL?.trim() ?? defaults.modelId;
  if (!modelId) throw new ConfigurationError(`Set ADK_MODEL or model.id in ${join(directory, "config.yaml")}.`);
  if (env.ADK_AUTH && env.ADK_AUTH !== "none" && env.ADK_AUTH !== "api_key") {
    throw new ConfigurationError("ADK_AUTH must be none or api_key. Set the API key in the environment variable named by ADK_API_KEY_ENV.");
  }
  const permissionMode = env.ALPHACODE_PERMISSION ?? defaults.permissionMode ?? "ask";
  if (permissionMode !== "ask" && permissionMode !== "auto" && permissionMode !== "full") throw new ConfigurationError("ALPHACODE_PERMISSION must be ask, auto, or full.");
  const noAuth = env.ADK_AUTH ? env.ADK_AUTH === "none" : env.ADK_API_KEY_ENV !== undefined ? false : defaults.noAuth ?? false;
  return {
    workspaceRoot: resolve(cwd, expandHome(args[0] ?? env.ALPHACODE_WORKSPACE ?? cwd)),
    databasePath: env.ALPHACODE_DB !== undefined ? resolve(cwd, expandHome(env.ALPHACODE_DB))
      : resolve(directory, expandHome(defaults.databasePath ?? "sessions.db")),
    modelId,
    baseURL: env.ADK_BASE_URL ?? defaults.baseURL ?? "https://api.openai.com/v1",
    apiKeyEnv: env.ADK_API_KEY_ENV ?? defaults.apiKeyEnv ?? "OPENAI_API_KEY",
    noAuth,
    permissionMode,
    skills: defaults.skills,
    configDirectory: directory,
    ...(env.ALPHACODE_SESSION?.trim() ? { sessionId: env.ALPHACODE_SESSION.trim() } : {}),
  };
}
