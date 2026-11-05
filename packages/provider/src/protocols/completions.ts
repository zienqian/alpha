import type { GenerateInput, GenerateResult, Message, ToolCall } from '../types';
import { bearerHeaders, parseArguments, responseError, responseFailed } from './shared';
import type { Protocol } from './shared';
import type { OpenAIChatCompletionRequest, OpenAIChatMessage } from './official-types';

function messagesForChat(messages: Message[]): OpenAIChatMessage[] {
  return messages.map((message): OpenAIChatMessage => {
    if (message.role === 'tool') return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
    if (message.role === 'assistant' && message.toolCalls?.length) return {
      role: 'assistant', content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })),
    };
    return { role: message.role, content: message.content };
  });
}

function encode(modelId: string, input: GenerateInput, defaultMaxOutputTokens?: number): Record<string, unknown> {
  const max = input.maxOutputTokens ?? defaultMaxOutputTokens;
  const tools = input.tools?.length ? input.tools : undefined;
  return {
    model: modelId, messages: messagesForChat(input.messages),
    ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
    ...(max === undefined ? {} : { max_tokens: max }),
    ...(tools ? { tools: tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })) } : {}),
  } satisfies OpenAIChatCompletionRequest;
}

function decode(data: unknown): GenerateResult {
  const payload = data as { error?: unknown; choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string; refusal?: string }> | null; refusal?: string | null; tool_calls?: Array<{ type?: string; id?: string; function?: { name?: string; arguments?: unknown } }> }; finish_reason?: string | null }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  if (!payload || typeof payload !== 'object') return responseError();
  if (payload.error) return responseFailed();
  const choice = payload.choices?.[0];
  if (!choice?.message || (choice.finish_reason != null && typeof choice.finish_reason !== 'string')) return responseError();
  const content = choice.message.content;
  const text: string[] = [];
  const refusals: string[] = [];
  if (typeof content === 'string') text.push(content);
  else if (Array.isArray(content)) {
    for (const block of content) {
      if (block?.type === 'text' && typeof block.text === 'string') text.push(block.text);
      else if (block?.type === 'refusal' && typeof block.refusal === 'string') refusals.push(block.refusal);
      else return responseError();
    }
  } else if (content != null) return responseError();
  if (choice.message.refusal != null) {
    if (typeof choice.message.refusal !== 'string') return responseError();
    refusals.push(choice.message.refusal);
  }
  const reason = choice.finish_reason ?? null;
  const incomplete = reason === 'length';
  const refused = refusals.length > 0 || reason === 'content_filter';
  if (choice.message.tool_calls != null && !Array.isArray(choice.message.tool_calls)) return responseError();
  // Truncated or refused tool-call arguments must never be offered for execution.
  const canUseTools = !incomplete && !refused && (reason === 'tool_calls' || reason === 'stop');
  const toolCalls: ToolCall[] = (canUseTools ? choice.message.tool_calls ?? [] : []).map((call) => {
    if (call.type !== 'function' || typeof call.id !== 'string' || !call.id.trim() || typeof call.function?.name !== 'string' || !call.function.name.trim()) return responseError();
    return { id: call.id, name: call.function.name, arguments: parseArguments(call.function.arguments) };
  });
  const textValue = text.join('');
  const outcome = refused ? 'refused' : incomplete ? 'incomplete' : toolCalls.length ? 'tool_calls' : reason === 'stop' && textValue ? 'completed' : 'unknown';
  return { outcome, text: textValue, toolCalls, finishReason: reason, ...(refusals.length ? { refusal: refusals.join('') } : {}), ...(incomplete ? { incompleteReason: reason } : {}), usage: payload.usage ? { inputTokens: payload.usage.prompt_tokens, outputTokens: payload.usage.completion_tokens } : undefined };
}

export const completionsProtocol: Protocol = { endpoint: 'chat/completions', headers: bearerHeaders, encode, decode };
