/** Host-owned Memory service coordinating ~/.alphacode/memory/ + sessions.db.memory.db + background Stage 1/2. */
import type { Message } from "@alpha/adk/core";
import { createProvider, type CreateProviderOptions, type LanguageModel } from "@alpha/provider";
import {
  runStage1Extraction,
  runStage2Dream,
  slugifyTopic,
  type MemoryCoordinatorStore,
  type MemoryModelRunner,
  type MemoryScope,
  type MemoryStore,
  type MemoryTopic,
  type MemoryType,
  type Stage2DreamResult,
} from "@alpha/adk-memory";
import { createFsMemoryStore } from "@alpha/adk-memory/fs";
import { createSqliteMemoryStore } from "@alpha/adk-memory/sqlite";
import {
  defaultMemorySettings,
  globalConfigDirectory,
  memoryDirectoryPath,
  readGlobalDefaults,
  updateMemorySettings,
  type GlobalDefaults,
  type MemoryGlobalDefaults,
  type MemoryGlobalSettingsPatch,
} from "../global-config";

export interface MemorySettingsView extends MemoryGlobalDefaults {
  readonly memoryDir: string;
}

export interface MemoryModelConnection {
  readonly baseURL?: string;
  readonly apiKeyEnv?: string;
  readonly noAuth?: boolean;
  readonly providerOptions?: CreateProviderOptions;
}

export interface MemoryServiceOptions {
  readonly instanceId: string;
  readonly databasePath: string;
  readonly configDirectory?: string;
}

export interface MemoryService {
  readonly memoryDir: string;
  readonly store: MemoryStore;
  readonly coordinator: MemoryCoordinatorStore;
  getSettings(): Promise<MemorySettingsView>;
  updateSettings(patch: MemoryGlobalSettingsPatch): Promise<MemorySettingsView>;
  isEnabled(): Promise<boolean>;
  rememberExplicit(scope: MemoryScope, text: string, type?: MemoryType): Promise<MemoryTopic>;
  scheduleStage1(input: {
    readonly scope: MemoryScope;
    readonly sessionKey: string;
    readonly sessionId: string;
    readonly sessionRevision: number;
    readonly messages: readonly Message[];
    readonly alreadyWroteInRun: boolean;
    readonly model: LanguageModel;
    readonly connection?: MemoryModelConnection;
  }): void;
  runDream(
    scope: MemoryScope,
    model: LanguageModel,
    options?: { readonly force?: boolean; readonly connection?: MemoryModelConnection },
  ): Promise<Stage2DreamResult>;
  whenIdle(): Promise<void>;
  close(): Promise<void>;
}

function modelToRunner(model: LanguageModel, maxOutputTokensCap?: number): MemoryModelRunner {
  return async (prompt, { maxOutputTokens, signal }) => {
    const effectiveMaxTokens = maxOutputTokensCap !== undefined
      ? Math.min(maxOutputTokens, maxOutputTokensCap)
      : maxOutputTokens;
    let text = "";
    for await (const event of model.stream({
      messages: [
        { role: "system", content: "You are a precise background memory distiller. Follow the requested JSON output format strictly and do not invoke tools." },
        { role: "user", content: prompt },
      ],
      maxOutputTokens: effectiveMaxTokens,
      signal,
    })) {
      if (event.type === "text-delta") text += event.text;
      else if (event.type === "finish" && event.result.text) text = event.result.text;
    }
    return text;
  };
}

export function createMemoryService(options: MemoryServiceOptions): MemoryService {
  const configDir = options.configDirectory ?? globalConfigDirectory();
  const memoryDir = memoryDirectoryPath(configDir);
  const coordinator = createSqliteMemoryStore(`${options.databasePath}.memory.db`);
  const store = createFsMemoryStore(memoryDir, { coordinator });
  const abortController = new AbortController();
  const inFlight = new Set<Promise<void>>();
  let closed = false;

  async function readDefaults(): Promise<GlobalDefaults> {
    return readGlobalDefaults(configDir).catch(() => ({} as GlobalDefaults));
  }

  async function readSettings(): Promise<MemorySettingsView> {
    const defaults = await readDefaults();
    const memory = defaults.memory ?? defaultMemorySettings;
    return { ...memory, memoryDir };
  }

  async function resolveBackgroundRunner(
    fallbackModel: LanguageModel,
    connection?: MemoryModelConnection,
  ): Promise<MemoryModelRunner> {
    const defaults = await readDefaults();
    const override = defaults.memory?.model;
    const envModel = process.env.ALPHACODE_MEMORY_MODEL?.trim();
    const hasCustomProvider = Boolean(
      override?.baseURL
      || override?.apiKeyEnv
      || override?.noAuth !== undefined,
    );
    const modelId = envModel || override?.modelId;
    if (!modelId && !hasCustomProvider) {
      return modelToRunner(fallbackModel, override?.maxOutputTokens);
    }

    const resolvedModelId = modelId ?? fallbackModel.modelId;
    const auth = process.env.ADK_AUTH;
    const baseURL = override?.baseURL
      ?? process.env.ADK_BASE_URL
      ?? defaults.baseURL
      ?? connection?.baseURL
      ?? "https://api.openai.com/v1";
    const apiKeyEnv = override?.apiKeyEnv
      ?? process.env.ADK_API_KEY_ENV
      ?? defaults.apiKeyEnv
      ?? connection?.apiKeyEnv
      ?? "OPENAI_API_KEY";
    const noAuth = override?.noAuth !== undefined
      ? override.noAuth
      : auth
        ? auth === "none"
        : process.env.ADK_API_KEY_ENV !== undefined
          ? false
          : defaults.noAuth ?? connection?.noAuth ?? false;

    try {
      const dedicatedModel = createProvider({
        providers: {
          memory: {
            adapter: "openai-completions",
            options: {
              baseURL,
              apiKey: noAuth ? { none: true } : { env: apiKeyEnv },
            },
            models: { background: { id: resolvedModelId } },
          },
        },
      }, connection?.providerOptions).use("memory", "background");
      return modelToRunner(dedicatedModel, override?.maxOutputTokens);
    } catch {
      return modelToRunner(fallbackModel, override?.maxOutputTokens);
    }
  }

  function track(promise: Promise<void>) {
    inFlight.add(promise);
    void promise.finally(() => { inFlight.delete(promise); });
  }

  return {
    memoryDir,
    store,
    coordinator,

    getSettings: readSettings,

    async updateSettings(patch) {
      const updated = await updateMemorySettings(configDir, patch);
      return { ...updated, memoryDir };
    },

    async isEnabled() {
      return (await readSettings()).enabled;
    },

    async rememberExplicit(scope, text, type = "feedback") {
      const trimmed = text.trim();
      const firstLine = trimmed.split(/\r?\n/)[0]?.trim() || "Saved memory";
      const name = firstLine.length > 72 ? `${firstLine.slice(0, 71)}…` : firstLine;
      const description = firstLine.length > 140 ? `${firstLine.slice(0, 139)}…` : firstLine;
      const slug = slugifyTopic(name);
      const saved = await store.writeTopic(scope, {
        slug,
        name,
        description,
        type,
        owner: "user",
        body: trimmed,
      }, { actor: "user", allowOverwriteLocked: true });
      const settings = await readSettings();
      await store.rebuildIndex(scope, {
        maxLines: settings.maxIndexLines,
        maxBytes: settings.maxIndexBytes,
      });
      return saved;
    },

    scheduleStage1(input) {
      if (closed || abortController.signal.aborted) return;
      const work = (async () => {
        const settings = await readSettings();
        if (!settings.enabled || !settings.autoExtract || closed) return;
        const runModel = await resolveBackgroundRunner(input.model, input.connection);
        const stage1 = await runStage1Extraction({
          store,
          coordinator,
          scope: input.scope,
          sessionKey: input.sessionKey,
          sessionId: input.sessionId,
          sessionRevision: input.sessionRevision,
          messages: input.messages,
          leaseOwner: options.instanceId,
          alreadyWroteInRun: input.alreadyWroteInRun,
          runModel,
          signal: abortController.signal,
        });
        if (stage1.status === "extracted" && settings.autoDream && !closed) {
          await runStage2Dream({
            store,
            coordinator,
            scope: input.scope,
            leaseOwner: options.instanceId,
            runModel,
            minIntervalHours: settings.dreamMinIntervalHours,
            minNewRollouts: settings.dreamMinNewRollouts,
            maxIndexLines: settings.maxIndexLines,
            maxIndexBytes: settings.maxIndexBytes,
            signal: abortController.signal,
          });
        }
      })().catch(() => { /* Background memory extraction never interrupts foreground chat. */ });
      track(work);
    },

    async runDream(scope, model, dreamOptions) {
      const settings = await readSettings();
      const runModel = await resolveBackgroundRunner(model, dreamOptions?.connection);
      return runStage2Dream({
        store,
        coordinator,
        scope,
        leaseOwner: options.instanceId,
        runModel,
        force: dreamOptions?.force ?? true,
        minIntervalHours: settings.dreamMinIntervalHours,
        minNewRollouts: settings.dreamMinNewRollouts,
        maxIndexLines: settings.maxIndexLines,
        maxIndexBytes: settings.maxIndexBytes,
        signal: abortController.signal,
      });
    },

    async whenIdle() {
      while (inFlight.size > 0) {
        await Promise.allSettled([...inFlight]);
      }
    },

    async close() {
      if (closed) return;
      closed = true;
      abortController.abort();
      await Promise.allSettled([...inFlight]);
      coordinator.close();
    },
  };
}
