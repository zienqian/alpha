import { builtinNames } from './builtin-options';
import { createBuiltinModel } from './builtins';
import { ProviderError } from './errors';
import { createConfigSnapshot } from './validation';
import { invalid } from './validation-helpers';
import type { CheckedConfig, CreateProviderOptions, LanguageModel, Provider, ProviderConfig } from './types';

export { ProviderError } from './errors';
export type { StreamActivity } from './types';
export type { ProviderErrorCode } from './errors';
export type { OpenAIChatCompletionRequest, OpenAIChatMessage, OpenAIResponseRequest, OpenAIResponseInput, AnthropicMessageRequest, AnthropicMessageBlock } from './protocols/official-types';
export type { Fetch, AdapterContext, AnthropicContinuation, AnthropicOptions, CheckedConfig, CommonOptions, OpenAICompletionsOptions, OpenAIResponsesOptions, OpenAICodexResponsesOptions, CreateProviderOptions, Credential, HeaderValue, GenerateInput, GenerateResult, StreamEvent, Json, JsonObject, LanguageModel, Message, ModelConfig, ModelMetadata, ThinkingLevel, Provider, ProviderAdapter, ProviderConfig, ProviderEntry, ToolCall, ToolDefinition } from './types';

export function defineProviderConfig<const T extends ProviderConfig>(config: CheckedConfig<T>): T {
  return config;
}

export function createProvider<const T extends ProviderConfig>(config: CheckedConfig<T>, options: CreateProviderOptions = {}): Provider<T> {
  const adapters = { ...options.adapters };
  for (const name of Object.keys(adapters)) if (builtinNames.has(name)) invalid('adapters');
  const snapshot = createConfigSnapshot(config, adapters);
  const context = {
    getEnv: options.getEnv ?? ((name: string) => process.env[name]),
    fetch: options.fetch ?? globalThis.fetch,
  };

  function use(providerName: string, modelAlias: string): LanguageModel {
    if (!Object.hasOwn(snapshot.providers, providerName)) throw new ProviderError('PROVIDER_NOT_FOUND', 'Provider not found.');
    const entry = snapshot.providers[providerName];
    if (!Object.hasOwn(entry.models, modelAlias)) throw new ProviderError('MODEL_NOT_FOUND', 'Model alias not found.');
    const { id: modelId, ...metadata } = entry.models[modelAlias];
    let model: LanguageModel;
    if (builtinNames.has(entry.adapter)) {
      model = createBuiltinModel(entry.adapter, providerName, modelId, entry.options, context, metadata);
    } else {
      try {
        model = adapters[entry.adapter].createModel(entry.options, modelId, context);
        if (!model || typeof model.generate !== 'function' || typeof model.stream !== 'function' || typeof model.modelId !== 'string' || typeof model.provider !== 'string') throw new Error();
      } catch {
        throw new ProviderError('ADAPTER_INIT_FAILED', 'Provider adapter could not create the model.');
      }
    }
    if (!Object.keys(metadata).length) return model;
    // Wrap rather than mutate adapter-owned objects; keep its receiver intact.
    return { provider: model.provider, modelId: model.modelId, metadata: Object.freeze(metadata), generate: (input) => model.generate(input), stream: (input) => model.stream(input) };
  }

  return {
    use,
    list: () => Object.entries(snapshot.providers).map(([name, entry]) => ({
      name,
      adapter: entry.adapter,
      models: Object.entries(entry.models).map(([alias, model]) => ({ alias, ...model })),
    })),
  };
}
