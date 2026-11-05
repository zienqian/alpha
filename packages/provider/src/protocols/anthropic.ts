import type { GenerateInput, GenerateResult, Json, Message, ToolCall } from '../types';
import { inputError, parseArguments, responseError, responseFailed } from './shared';
import type { Protocol } from './shared';
import type { AnthropicMessageRequest, AnthropicMessageBlock } from './official-types';

function messagesForAnthropic(messages: Message[]): AnthropicMessageRequest['messages'] {
  const result: AnthropicMessageRequest['messages'] = [];
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'developer') return inputError();
    const role = message.role === 'tool' ? 'user' : message.role;
    const blocks: AnthropicMessageBlock[] = message.role === 'tool'
      ? [{ type: 'tool_result', tool_use_id: message.toolCallId, content: message.content }]
      : message.role === 'assistant' && message.continuation
        ? message.continuation.content as unknown as AnthropicMessageBlock[]
      : message.role === 'assistant'
        ? [...(message.content ? [{ type: 'text' as const, text: message.content }] : []), ...(message.toolCalls ?? []).map((call) => ({ type: 'tool_use' as const, id: call.id, name: call.name, input: call.arguments }))]
        : [{ type: 'text', text: message.content }];
    const previous = result.at(-1);
    if (previous?.role === role) previous.content.push(...blocks);
    else result.push({ role, content: blocks });
  }
  return result;
}

function encode(modelId: string, input: GenerateInput, defaultMaxOutputTokens?: number): Record<string, unknown> {
  const max = input.maxOutputTokens ?? defaultMaxOutputTokens;
  if (!max) inputError();
  const tools = input.tools?.length ? input.tools : undefined;
  return {
    model: modelId, messages: messagesForAnthropic(input.messages), max_tokens: max,
    ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
    ...(input.messages.some((message) => message.role === 'system') ? { system: input.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n') } : {}),
    ...(tools ? { tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema })) } : {}),
  } satisfies AnthropicMessageRequest;
}

function decode(data: unknown): GenerateResult {
  const payload = data as { error?: unknown; content?: Array<{ type?: string; text?: string; id?: string; name?: string; input?: unknown }>; stop_reason?: string | null; usage?: { input_tokens?: number; output_tokens?: number } };
  if (!payload || typeof payload !== 'object') return responseError();
  if (payload.error) return responseFailed();
  if (!Array.isArray(payload.content) || (payload.stop_reason != null && typeof payload.stop_reason !== 'string')) return responseError();
  const reason = payload.stop_reason ?? null;
  const incomplete = reason === 'max_tokens' || reason === 'model_context_window_exceeded' || reason === 'pause_turn';
  const text: string[] = [];
  const toolCalls: ToolCall[] = [];
  for (const block of payload.content) {
    if (block.type === 'text' && typeof block.text === 'string') text.push(block.text);
    if (block.type === 'tool_use' && reason === 'tool_use') {
      if (typeof block.id !== 'string' || !block.id.trim() || typeof block.name !== 'string' || !block.name.trim()) return responseError();
      toolCalls.push({ id: block.id, name: block.name, arguments: parseArguments(block.input) });
    }
  }
  const textValue = text.join('');
  const outcome = reason === 'refusal' ? 'refused' : incomplete ? 'incomplete' : reason === 'tool_use' && toolCalls.length ? 'tool_calls' : (reason === 'end_turn' || reason === 'stop_sequence') && textValue ? 'completed' : 'unknown';
  const needsContinuation = reason === 'tool_use' && payload.content.some((block) => block.type === 'thinking' || block.type === 'redacted_thinking');
  return { outcome, text: textValue, toolCalls, finishReason: reason, ...(needsContinuation ? { continuation: { protocol: 'anthropic-messages' as const, content: payload.content as unknown as Json[] } } : {}), ...(reason === 'refusal' && textValue ? { refusal: textValue } : {}), ...(incomplete ? { incompleteReason: reason } : {}), usage: payload.usage ? { inputTokens: payload.usage.input_tokens, outputTokens: payload.usage.output_tokens } : undefined };
}

export const anthropicProtocol: Protocol = {
  endpoint: 'messages',
  headers: (apiKey) => ({ 'anthropic-version': '2023-06-01', ...(apiKey ? { 'x-api-key': apiKey } : {}) }),
  encode,
  decode,
};
