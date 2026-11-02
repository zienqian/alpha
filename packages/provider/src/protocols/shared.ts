import { ProviderError } from '../errors.js';
import type { GenerateInput, GenerateResult, JsonObject } from '../types.js';

export interface Protocol {
  readonly endpoint: string;
  headers(apiKey?: string): Record<string, string>;
  encode(modelId: string, input: GenerateInput, defaultMaxOutputTokens?: number): Record<string, unknown>;
  decode(data: unknown): GenerateResult;
}

export function inputError(): never {
  throw new ProviderError('INVALID_INPUT', 'Invalid model input.');
}

export function responseError(): never {
  throw new ProviderError('INVALID_RESPONSE', 'Provider returned an invalid or unsupported response.');
}

export function responseFailed(): never {
  throw new ProviderError('RESPONSE_FAILED', 'Provider reported a failed response.');
}

export function parseArguments(value: unknown): JsonObject {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { return responseError(); }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return responseError();
  return parsed as JsonObject;
}

export function validateInput(input: GenerateInput): void {
  if (!input || !Array.isArray(input.messages) || input.messages.length === 0) inputError();
  if (input.maxOutputTokens !== undefined && (!Number.isInteger(input.maxOutputTokens) || input.maxOutputTokens <= 0)) inputError();
  if (input.thinkingLevel !== undefined && !['minimal', 'low', 'medium', 'high', 'xhigh'].includes(input.thinkingLevel)) inputError();
  if (input.temperature !== undefined && (typeof input.temperature !== 'number' || !Number.isFinite(input.temperature))) inputError();
  if (input.previousResponseId !== undefined && (typeof input.previousResponseId !== 'string' || !input.previousResponseId.trim())) inputError();
  const names = new Set<string>();
  if (input.tools !== undefined && !Array.isArray(input.tools)) inputError();
  for (const tool of input.tools ?? []) {
    if (!tool || typeof tool.name !== 'string' || !tool.name.trim() || names.has(tool.name) || !tool.inputSchema || typeof tool.inputSchema !== 'object' || Array.isArray(tool.inputSchema)) inputError();
    names.add(tool.name);
  }
  for (const message of input.messages) {
    if (!message || !['system', 'developer', 'user', 'assistant', 'tool'].includes(message.role) || typeof message.content !== 'string') inputError();
    if (message.role === 'tool' && (typeof message.toolCallId !== 'string' || !message.toolCallId)) inputError();
    if (message.role === 'assistant' && message.toolCalls !== undefined) {
      if (!Array.isArray(message.toolCalls)) inputError();
      for (const call of message.toolCalls) {
        if (!call || !call.id || !call.name || !call.arguments || typeof call.arguments !== 'object' || Array.isArray(call.arguments)) inputError();
      }
    }
    if (message.role === 'assistant' && message.continuation !== undefined && (message.continuation.protocol !== 'anthropic-messages' || !Array.isArray(message.continuation.content))) inputError();
  }
}

export function bearerHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}
