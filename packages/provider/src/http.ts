import { ProviderError } from './errors';
import { applyRequestHeaders } from './http-headers';
import { anthropicProtocol } from './protocols/anthropic';
import { completionsProtocol } from './protocols/completions';
import { responsesProtocol } from './protocols/responses';
import { inputError, responseError, validateInput } from './protocols/shared';
import { readSse } from './sse';
import { createStreamCodec } from './stream-codecs';
import { applyModelPolicy } from './model-policy';
import type { ProtocolName } from './stream-codecs';
import type { Fetch, GenerateInput, LanguageModel, ModelMetadata } from './types';

type HttpOptions = {
  provider: string;
  modelId: string;
  protocol: ProtocolName;
  baseURL: string;
  apiKey?: string;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  maxOutputTokens?: number;
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  metadata: ModelMetadata;
  fetch: Fetch;
};

const protocols = { completions: completionsProtocol, responses: responsesProtocol, anthropic: anthropicProtocol };

async function contextOverflow(response: Response): Promise<boolean> {
  if (![400, 413, 422].includes(response.status) || !response.body) return false;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) return false;
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    // Structured machine codes only. Generic HTTP errors and prose never trigger replay.
    return ['context_length_exceeded', 'prompt_too_long', 'input_too_long'].includes(payload?.error?.code ?? payload?.error?.type);
  } catch { return false; }
  finally { try { await reader.cancel(); } catch { /* Failed response only. */ } reader.releaseLock(); }
}

/** Transport owns HTTP and cancellation; protocol codecs own wire formats. */
export function createHttpModel(options: HttpOptions): LanguageModel {
  const protocol = protocols[options.protocol];
  async function request(input: GenerateInput, stream: boolean): Promise<Response> {
    validateInput(input);
    if (input.previousResponseId && options.protocol !== 'responses') inputError();
    if (options.protocol !== 'anthropic' && input.messages.some((message) => message.role === 'assistant' && message.continuation)) inputError();
    if (input.signal?.aborted) throw input.signal.reason;
    const body = protocol.encode(options.modelId, input, options.maxOutputTokens);
    applyModelPolicy(body, input, options.metadata, options.protocol, options.maxOutputTokens);
    if (options.protocol === 'completions' && options.maxTokensField === 'max_completion_tokens' && body.max_tokens !== undefined) {
      body.max_completion_tokens = body.max_tokens;
      delete body.max_tokens;
    }
    if (stream) body.stream = true;
    const url = new URL(`${options.baseURL.replace(/\/+$/, '')}/${protocol.endpoint}`);
    for (const [key, value] of Object.entries(options.queryParams ?? {})) url.searchParams.set(key, value);
    const headers = new Headers(options.headers);
    applyRequestHeaders(headers, input.headers, options.protocol === 'anthropic');
    headers.set('content-type', 'application/json');
    for (const [key, value] of Object.entries(protocol.headers(options.apiKey))) headers.set(key, value);
    let response: Response;
    try { response = await options.fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: input.signal }); }
    catch (error) {
      if (input.signal?.aborted) throw input.signal.reason ?? error;
      throw new ProviderError('REQUEST_FAILED', 'Provider request failed.');
    }
    if (!response.ok) throw new ProviderError(await contextOverflow(response) ? 'CONTEXT_LENGTH_EXCEEDED' : 'REQUEST_FAILED', 'Provider request failed.', { status: response.status });
    return response;
  }
  return {
    provider: options.provider,
    modelId: options.modelId,
    async generate(input) {
      const response = await request(input, false);
      let payload: unknown;
      try { payload = await response.json(); }
      catch (error) {
        if (input.signal?.aborted) throw input.signal.reason ?? error;
        if (error instanceof SyntaxError) return responseError();
        throw new ProviderError('REQUEST_FAILED', 'Provider response could not be read.');
      }
      try { return protocol.decode(payload); }
      catch (error) { if (error instanceof ProviderError) throw error; return responseError(); }
    },
    async *stream(input) {
      const response = await request(input, true);
      if (!response.body) return responseError();
      const codec = createStreamCodec(options.protocol);
      for await (const data of readSse(response.body, input.signal)) {
        if (input.signal?.aborted) throw input.signal.reason;
        let event: ReturnType<typeof codec.push>;
        try { event = codec.push(data); }
        catch (error) { if (error instanceof ProviderError) throw error; return responseError(); }
        if (event.text) yield { type: 'text-delta', text: event.text };
        for (const activity of event.activity ?? []) yield { type: 'activity', activity };
        if (event.result) {
          for (const toolCall of event.result.toolCalls) {
            if (input.signal?.aborted) throw input.signal.reason;
            yield { type: 'tool-call', toolCall };
          }
          if (input.signal?.aborted) throw input.signal.reason;
          yield { type: 'finish', result: event.result };
          return;
        }
      }
      return responseError();
    },
  };
}
