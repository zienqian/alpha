import { checkKeys, invalid, isRecord } from './validation-helpers.js';
import { validateConfiguredHeaders } from './http-headers.js';

export const builtinNames = new Set(['anthropic-messages', 'openai-completions', 'openai-responses', 'openai-codex-responses']);

/** Validate connection options without reading secrets or constructing a model. */
export function validateBuiltinOptions(adapter: string, options: Record<string, unknown>, path: string): void {
  const codex = adapter === 'openai-codex-responses';
  const allowed = [codex ? 'accessToken' : 'apiKey', 'baseURL', 'headers',
    ...(adapter === 'anthropic-messages' ? ['maxOutputTokens'] : []),
    ...(adapter === 'openai-completions' || adapter === 'openai-responses' ? ['queryParams'] : []),
    ...(adapter === 'openai-completions' ? ['maxTokensField'] : [])];
  checkKeys(options, allowed, path);
  const credentialField = codex ? 'accessToken' : 'apiKey';
  const key = options[credentialField];
  if (!isRecord(key)) invalid(`${path}.${credentialField}`);
  if (Object.keys(key).length !== 1 || !((typeof key.env === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key.env)) ||
      (typeof key.value === 'string' && key.value.trim().length > 0 && !/[\r\n]/.test(key.value)) ||
      (!codex && adapter !== 'anthropic-messages' && key.none === true))) invalid(`${path}.${credentialField}`);
  if (options.baseURL !== undefined) {
    try {
      if (typeof options.baseURL !== 'string') invalid(`${path}.baseURL`);
      const url = new URL(options.baseURL);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) invalid(`${path}.baseURL`);
    } catch {
      invalid(`${path}.baseURL`);
    }
  }
  if (options.maxOutputTokens !== undefined && (typeof options.maxOutputTokens !== 'number' || !Number.isInteger(options.maxOutputTokens) || options.maxOutputTokens <= 0)) invalid(`${path}.maxOutputTokens`);
  if (options.maxTokensField !== undefined && options.maxTokensField !== 'max_tokens' && options.maxTokensField !== 'max_completion_tokens') invalid(`${path}.maxTokensField`);
  if (options.headers !== undefined) validateConfiguredHeaders(options.headers, `${path}.headers`, adapter === 'anthropic-messages');
  const query = options.queryParams;
  if (query !== undefined && (!isRecord(query) || Object.entries(query).some(([key, value]) => typeof value !== 'string' || /(?:key|token|secret|password|auth)/i.test(key)))) invalid(`${path}.queryParams`);
}
