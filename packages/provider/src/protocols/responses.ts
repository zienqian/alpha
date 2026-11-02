import type { GenerateInput, GenerateResult, Message, ToolCall } from '../types.js';
import { bearerHeaders, parseArguments, responseError, responseFailed } from './shared.js';
import type { Protocol } from './shared.js';
import type { OpenAIResponseRequest, OpenAIResponseInput } from './official-types.js';

function messagesForResponses(messages: Message[]): OpenAIResponseInput[] {
  return messages.flatMap((message): OpenAIResponseInput[] => {
    if (message.role === 'tool') return [{ type: 'function_call_output', call_id: message.toolCallId, output: message.content }];
    if (message.role === 'assistant' && message.toolCalls?.length) return [
      ...(message.content ? [{ role: 'assistant' as const, content: message.content }] : []),
      ...message.toolCalls.map((call) => ({ type: 'function_call' as const, call_id: call.id, name: call.name, arguments: JSON.stringify(call.arguments) })),
    ];
    return [{ role: message.role, content: message.content }];
  });
}

function encode(modelId: string, input: GenerateInput, defaultMaxOutputTokens?: number): Record<string, unknown> {
  const max = input.maxOutputTokens ?? defaultMaxOutputTokens;
  const tools = input.tools?.length ? input.tools : undefined;
  return {
    model: modelId, input: messagesForResponses(input.messages),
    ...(input.previousResponseId === undefined ? {} : { previous_response_id: input.previousResponseId }),
    ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
    ...(max === undefined ? {} : { max_output_tokens: max }),
    ...(tools ? { tools: tools.map((tool) => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.inputSchema })) } : {}),
  } satisfies OpenAIResponseRequest;
}

function decode(data: unknown): GenerateResult {
  const payload = data as { id?: string; error?: unknown; output?: Array<{ type?: string; status?: string; content?: Array<{ type?: string; text?: string; refusal?: string }>; call_id?: string; name?: string; arguments?: unknown }>; status?: string | null; incomplete_details?: { reason?: string | null } | null; usage?: { input_tokens?: number; output_tokens?: number } };
  if (!payload || typeof payload !== 'object') return responseError();
  if (payload.status === 'failed' || payload.error) return responseFailed();
  if (!Array.isArray(payload.output) || (payload.status != null && typeof payload.status !== 'string')) return responseError();
  const text: string[] = [];
  const refusals: string[] = [];
  const toolCalls: ToolCall[] = [];
  for (const item of payload.output) {
    if (item.type === 'message') {
      if (!Array.isArray(item.content)) return responseError();
      for (const block of item.content) {
        if (block.type === 'output_text' && typeof block.text === 'string') text.push(block.text);
        else if (block.type === 'refusal' && typeof block.refusal === 'string') refusals.push(block.refusal);
        else return responseError();
      }
    }
  }
  for (const item of payload.output) {
    if (item.type === 'function_call' && payload.status === 'completed' && refusals.length === 0) {
      if (item.status != null && item.status !== 'completed') return responseError();
      if (typeof item.call_id !== 'string' || !item.call_id.trim() || typeof item.name !== 'string' || !item.name.trim()) return responseError();
      toolCalls.push({ id: item.call_id, name: item.name, arguments: parseArguments(item.arguments) });
    }
  }
  const reason = payload.status ?? null;
  const incompleteReason = payload.incomplete_details?.reason;
  if (incompleteReason != null && typeof incompleteReason !== 'string') return responseError();
  const textValue = text.join('');
  const outcome = refusals.length ? 'refused' : reason === 'incomplete' ? 'incomplete' : reason === 'completed' && toolCalls.length ? 'tool_calls' : reason === 'completed' && textValue ? 'completed' : 'unknown';
  if (payload.id != null && (typeof payload.id !== 'string' || !payload.id.trim())) return responseError();
  return { outcome, text: textValue, toolCalls, finishReason: reason, ...(payload.id ? { responseId: payload.id } : {}), ...(refusals.length ? { refusal: refusals.join('') } : {}), ...(reason === 'incomplete' && incompleteReason ? { incompleteReason } : {}), usage: payload.usage ? { inputTokens: payload.usage.input_tokens, outputTokens: payload.usage.output_tokens } : undefined };
}

export const responsesProtocol: Protocol = { endpoint: 'responses', headers: bearerHeaders, encode, decode };
