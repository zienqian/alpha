import { resolveCredential } from './credentials';
import { createHttpModel } from './http';
import { resolveConfiguredHeaders } from './http-headers';
import type { AdapterContext, Credential, HeaderValue, Json, LanguageModel, ModelMetadata } from './types';

export function createBuiltinModel(adapter: string, providerName: string, modelId: string, options: Readonly<Record<string, Json>>, context: AdapterContext, metadata: ModelMetadata): LanguageModel {
  // Validated once when constructing the immutable configuration snapshot.
  const settings = options as unknown as { apiKey?: Credential; accessToken?: Credential; baseURL?: string; headers?: Readonly<Record<string, HeaderValue>>; queryParams?: Record<string, string>; maxOutputTokens?: number; maxTokensField?: 'max_tokens' | 'max_completion_tokens' };
  const protocol = adapter === 'anthropic-messages' ? 'anthropic' : adapter === 'openai-completions' ? 'completions' : 'responses';
  return createHttpModel({
    provider: providerName,
    modelId,
    protocol,
    baseURL: settings.baseURL ?? (adapter === 'anthropic-messages' ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1'),
    apiKey: resolveCredential((adapter === 'openai-codex-responses' ? settings.accessToken : settings.apiKey) as Credential, context.getEnv),
    headers: resolveConfiguredHeaders(settings.headers, context.getEnv, adapter === 'anthropic-messages'),
    queryParams: settings.queryParams,
    maxOutputTokens: settings.maxOutputTokens,
    maxTokensField: settings.maxTokensField,
    metadata,
    fetch: context.fetch,
  });
}
