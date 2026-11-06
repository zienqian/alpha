import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface AppConfig {
  workspaceRoot: string;
  databasePath: string;
  modelId: string;
  baseURL: string;
  apiKeyEnv: string;
  noAuth: boolean;
  sessionId?: string;
}

export class ConfigurationError extends Error {}

export function readConfig(
  env: Record<string, string | undefined> = process.env,
  args: readonly string[] = process.argv.slice(2),
  cwd = process.cwd(),
): AppConfig {
  if (args.length > 1 || args[0]?.startsWith("-")) {
    throw new ConfigurationError("用法：alphacode [工作区路径]");
  }
  const modelId = env.ADK_MODEL?.trim();
  if (!modelId) throw new ConfigurationError("请配置 ADK_MODEL；本地开发可从仓库根目录的 .env.example 创建 .env.local。");
  if (env.ADK_AUTH && env.ADK_AUTH !== "none") {
    throw new ConfigurationError("无认证端点使用 ADK_AUTH=none；需要密钥时请移除此变量并配置 ADK_API_KEY_ENV。");
  }
  return {
    workspaceRoot: resolve(cwd, args[0] ?? env.ALPHACODE_WORKSPACE ?? cwd),
    databasePath: resolve(cwd, env.ALPHACODE_DB ?? join(homedir(), ".alphacode", "sessions.db")),
    modelId,
    baseURL: env.ADK_BASE_URL ?? "https://api.openai.com/v1",
    apiKeyEnv: env.ADK_API_KEY_ENV ?? "OPENAI_API_KEY",
    noAuth: env.ADK_AUTH === "none",
    ...(env.ALPHACODE_SESSION?.trim() ? { sessionId: env.ALPHACODE_SESSION.trim() } : {}),
  };
}
