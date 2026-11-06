import type { AssistantMessage, JsonObject, Message, ToolExecution, ToolResultMessage } from '../contracts';
import { ensure } from './errors';
import { copyJson, copyObject, record, text } from './json';

const outcomes = ['completed', 'tool_calls', 'refused', 'incomplete', 'unknown'];
const executions: readonly ToolExecution[] = ['succeeded', 'failed', 'denied', 'not_executed', 'outcome_unknown'];
export const callKey = (assistantId: string, callId: string) => JSON.stringify([assistantId, callId]);

export function createAssistant(value: unknown, id: string, maxCalls: number | null, code = 'MODEL_PROTOCOL'): AssistantMessage {
  ensure(record(value) && outcomes.includes(value.outcome as string) && typeof value.text === 'string', code);
  ensure(value.finishReason === null || typeof value.finishReason === 'string', code);
  ensure(Array.isArray(value.toolCalls), code);
  ensure(maxCalls === null || value.toolCalls.length <= maxCalls, code === 'MODEL_PROTOCOL' ? 'MODEL_TOOL_BATCH_TOO_LARGE' : code);
  const ids = new Set<string>();
  const toolCalls = value.toolCalls.map((call: unknown) => {
    ensure(record(call) && text(call.id) && text(call.name) && !ids.has(call.id), code);
    ids.add(call.id);
    return { id: call.id, name: call.name, arguments: copyObject(call.arguments, code) };
  });
  ensure(value.outcome === 'tool_calls' ? toolCalls.length > 0 : toolCalls.length === 0, code);
  const result: Record<string, unknown> = {
    id, role: 'assistant', outcome: value.outcome, text: value.text, toolCalls, finishReason: value.finishReason,
  };
  for (const key of ['refusal', 'incompleteReason', 'responseId'] as const) {
    if (value[key] !== undefined) { ensure(typeof value[key] === 'string', code); result[key] = value[key]; }
  }
  if (value.usage !== undefined) {
    ensure(record(value.usage), code);
    const usage: Record<string, number> = {};
    for (const key of ['inputTokens', 'outputTokens'] as const) {
      const count = value.usage[key];
      if (count !== undefined) {
        ensure(typeof count === 'number' && Number.isSafeInteger(count) && count >= 0, code);
        usage[key] = count;
      }
    }
    result.usage = usage;
  }
  if (value.continuation !== undefined) {
    ensure(record(value.continuation) && value.continuation.protocol === 'anthropic-messages' && Array.isArray(value.continuation.content), code);
    result.continuation = { protocol: value.continuation.protocol, content: value.continuation.content };
  }
  return copyJson(result, code) as unknown as AssistantMessage;
}

export function copyMessage(value: unknown, maxCalls: number | null, code = 'INPUT_INVALID'): Message {
  ensure(record(value) && text(value.id), code);
  if (value.role === 'assistant') return createAssistant(value, value.id, maxCalls, code);
  if (value.role === 'user') {
    ensure(typeof value.content === 'string', code);
    return Object.freeze({ id: value.id, role: 'user', content: value.content });
  }
  if (value.role === 'custom') {
    ensure(text(value.kind), code);
    return Object.freeze({ id: value.id, role: 'custom', kind: value.kind, data: copyJson(value.data, code) });
  }
  ensure(value.role === 'toolResult' && text(value.assistantId) && text(value.callId) && typeof value.content === 'string' && executions.includes(value.execution as ToolExecution), code);
  return Object.freeze({
    id: value.id, role: 'toolResult', assistantId: value.assistantId, callId: value.callId,
    content: value.content, execution: value.execution as ToolExecution,
  });
}

/** A portable history contains only complete, contiguous tool batches. */
export function copyMessages(value: unknown, maxCalls: number | null, code = 'INPUT_INVALID'): readonly Message[] {
  ensure(Array.isArray(value), code);
  const ids = new Set<string>(), pending = new Set<string>();
  const messages = value.map(v => copyMessage(v, maxCalls, code));
  for (const message of messages) {
    ensure(!ids.has(message.id), code); ids.add(message.id);
    if (message.role === 'toolResult') {
      const key = callKey(message.assistantId, message.callId);
      ensure(pending.delete(key) && message.execution !== 'outcome_unknown', code);
    } else {
      ensure(pending.size === 0, code);
      if (message.role === 'assistant') {
        for (const call of message.toolCalls) pending.add(callKey(message.id, call.id));
      }
    }
  }
  ensure(pending.size === 0, code);
  return Object.freeze(messages);
}
export type ModelCall = { readonly id: string; readonly name: string; readonly arguments: JsonObject };
export function createToolResult(id: string, assistantId: string, callId: string, content: string, execution: ToolExecution): ToolResultMessage {
  return Object.freeze({ id, role: 'toolResult', assistantId, callId, content, execution });
}
