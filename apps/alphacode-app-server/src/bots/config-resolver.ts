import type { AppConfig } from "../config";
import {
  globalConfigDirectory,
  readGlobalDefaults,
  worktreeRootPath,
  type BotRoleModelDefaults,
  type GlobalDefaults,
} from "../global-config";
import type { BotModelOverride, BotRecord, BotRoleModelView, BotsGlobalConfigView } from "./contracts";

export interface ResolvedBotsGlobalConfig {
  configDirectory: string;
  defaults: GlobalDefaults;
  maxConcurrentWorkers: number;
  perBotMaxWorkers: number;
  worktreeRoot: string;
  router?: BotRoleModelView;
  worker?: BotRoleModelView;
  view: BotsGlobalConfigView;
}

export interface ResolvedBotRuntimeConfig {
  global: ResolvedBotsGlobalConfig;
  maxConcurrentWorkers: number;
  router?: BotRoleModelView;
  worker?: BotRoleModelView;
}

function hasModelFields(override: BotRoleModelDefaults | undefined): boolean {
  if (!override) return false;
  return Boolean(
    override.modelId
    || override.baseURL
    || override.apiKeyEnv
    || override.noAuth !== undefined
    || override.contextWindow !== undefined
    || override.maxOutputTokens !== undefined,
  );
}

function resolveRole(
  role: "router" | "worker",
  defaults: GlobalDefaults,
  botOverride?: BotModelOverride,
  fallbackProject?: AppConfig,
): BotRoleModelView | undefined {
  const globalOverride = defaults.bots?.[role];
  const envModel = (role === "router" ? process.env.ALPHACODE_BOTS_ROUTER_MODEL : process.env.ALPHACODE_BOTS_WORKER_MODEL)?.trim();
  const globalModel = process.env.ADK_MODEL?.trim() || defaults.modelId || fallbackProject?.modelId;
  const modelId = botOverride?.modelId || envModel || globalOverride?.modelId || globalModel;
  if (!modelId) return undefined;

  const source: BotRoleModelView["source"] = hasModelFields(botOverride)
    ? "bot"
    : (Boolean(envModel) || hasModelFields(globalOverride))
      ? "global_bots"
      : "inherited";

  const auth = process.env.ADK_AUTH;
  const baseURL = botOverride?.baseURL
    ?? globalOverride?.baseURL
    ?? process.env.ADK_BASE_URL
    ?? defaults.baseURL
    ?? fallbackProject?.baseURL
    ?? "https://api.openai.com/v1";

  const apiKeyEnv = botOverride?.apiKeyEnv
    ?? globalOverride?.apiKeyEnv
    ?? process.env.ADK_API_KEY_ENV
    ?? defaults.apiKeyEnv
    ?? fallbackProject?.apiKeyEnv
    ?? "OPENAI_API_KEY";

  const noAuth = botOverride?.noAuth !== undefined
    ? botOverride.noAuth
    : globalOverride?.noAuth !== undefined
      ? globalOverride.noAuth
      : auth
        ? auth === "none"
        : process.env.ADK_API_KEY_ENV !== undefined
          ? false
          : defaults.noAuth ?? fallbackProject?.noAuth ?? false;

  const sameAsGlobalModel = modelId === (defaults.modelId ?? fallbackProject?.modelId);
  const contextWindow = botOverride?.contextWindow
    ?? globalOverride?.contextWindow
    ?? (sameAsGlobalModel ? (defaults.contextWindow ?? fallbackProject?.contextWindow) : undefined);
  const maxOutputTokens = botOverride?.maxOutputTokens
    ?? globalOverride?.maxOutputTokens
    ?? (sameAsGlobalModel ? (defaults.maxOutputTokens ?? fallbackProject?.maxOutputTokens) : undefined);

  return {
    modelId,
    baseURL,
    apiKeyEnv,
    noAuth,
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    source,
  };
}

export async function resolveBotsGlobalConfig(options: {
  configDirectory?: string;
  fallbackProject?: AppConfig;
}): Promise<ResolvedBotsGlobalConfig> {
  const configDirectory = options.configDirectory ?? options.fallbackProject?.configDirectory ?? globalConfigDirectory();
  const defaults = await readGlobalDefaults(configDirectory).catch(() => ({} as GlobalDefaults));
  const maxConcurrentWorkers = defaults.bots?.maxConcurrentWorkers ?? 4;
  const perBotMaxWorkers = defaults.bots?.perBotMaxWorkers ?? 2;
  const worktreeRoot = worktreeRootPath(configDirectory, defaults);
  const router = resolveRole("router", defaults, undefined, options.fallbackProject);
  const worker = resolveRole("worker", defaults, undefined, options.fallbackProject);
  const globalModelId = process.env.ADK_MODEL?.trim() || defaults.modelId || options.fallbackProject?.modelId;

  return {
    configDirectory,
    defaults,
    maxConcurrentWorkers,
    perBotMaxWorkers,
    worktreeRoot,
    router,
    worker,
    view: {
      maxConcurrentWorkers,
      perBotMaxWorkers,
      worktreeRoot,
      ...(globalModelId ? { globalModelId } : {}),
      ...(router ? { router } : {}),
      ...(worker ? { worker } : {}),
    },
  };
}

export function resolveBotRuntimeConfig(
  global: ResolvedBotsGlobalConfig,
  bot: Pick<BotRecord, "routerModel" | "workerModel" | "maxConcurrentWorkers">,
  projectConfig?: AppConfig,
): ResolvedBotRuntimeConfig {
  const router = resolveRole("router", global.defaults, bot.routerModel, projectConfig);
  const worker = resolveRole("worker", global.defaults, bot.workerModel, projectConfig);
  const maxConcurrentWorkers = Math.max(1, Math.min(4, bot.maxConcurrentWorkers ?? global.perBotMaxWorkers));
  return {
    global,
    maxConcurrentWorkers,
    router,
    worker,
  };
}
