import type { GenerateInput, Message as ProviderMessage } from '@alpha/provider';
import type { Message, ModelToolInputReference } from './contracts';
import { ensure } from './internal/errors';

/** Conservative UTF-8 estimate, not a tokenizer. Scale only increases from observed usage. */
export function estimateContextTokens(input: Pick<GenerateInput, 'messages' | 'tools'>, scale = 1): number {
  const count = (value: unknown) => Math.ceil(new TextEncoder().encode(JSON.stringify(value)).length / 2.5);
  return Math.ceil((input.messages.reduce((n, m) => n + 16 + count(m), 0) + (input.tools?.length ? 32 + count(input.tools) : 0)) * scale);
}

/** Does not validate history; the kernel validates before using this projection. */
export function projectContextMessages(messages: readonly Message[], references?: readonly ModelToolInputReference[]): ProviderMessage[] {
  return projectContextHistory(messages, references).flatMap((m): ProviderMessage[] => {
    if (m.role === 'custom') return [];
    if (m.role === 'user') return [{ role: 'user', content: m.content }];
    if (m.role === 'toolResult') return [{ role: 'tool', toolCallId: m.callId, content: m.content }];
    return [{ role: 'assistant', content: m.text,
      ...(m.toolCalls.length ? { toolCalls: JSON.parse(JSON.stringify(m.toolCalls)) } : {}),
      ...(m.continuation ? { continuation: JSON.parse(JSON.stringify(m.continuation)) } : {}) }];
  });
}

/** Never edits canonical history, call identities, outcomes, or opaque provider continuations. */
export function projectContextHistory(messages: readonly Message[], references: readonly ModelToolInputReference[] = []): readonly Message[] {
  ensure(Array.isArray(references), 'MODEL_PROTOCOL');
  if (!references.length) return messages;
  const originals = new Map(messages.map(message => [message.id, message]));
  const changes = new Map<string, Map<string, Map<string, string>>>();
  for (const input of references) {
    ensure(input && typeof input.assistantId === 'string' && typeof input.callId === 'string' && typeof input.field === 'string'
      && typeof input.reference === 'string' && input.reference.length > 0 && input.reference.length <= 4096 && !/[\s<>]/.test(input.reference), 'MODEL_PROTOCOL');
    const assistant = originals.get(input.assistantId);
    ensure(assistant?.role === 'assistant' && !assistant.continuation, 'MODEL_PROTOCOL');
    const call = assistant.toolCalls.find(call => call.id === input.callId);
    ensure(call && Object.hasOwn(call.arguments, input.field) && typeof call.arguments[input.field] === 'string', 'MODEL_PROTOCOL');
    ensure(messages.some(message => message.role === 'toolResult' && message.assistantId === input.assistantId
      && message.callId === input.callId && message.execution === 'succeeded'), 'MODEL_PROTOCOL');
    const calls = changes.get(input.assistantId) ?? new Map<string, Map<string, string>>();
    const fields = calls.get(input.callId) ?? new Map<string, string>();
    ensure(!fields.has(input.field), 'MODEL_PROTOCOL');
    fields.set(input.field, input.reference); calls.set(input.callId, fields); changes.set(input.assistantId, calls);
  }
  return messages.map(message => {
    const calls = changes.get(message.id);
    if (!calls || message.role !== 'assistant') return message;
    return { ...message, toolCalls: message.toolCalls.map(call => {
      const fields = calls.get(call.id);
      return !fields ? call : { ...call, arguments: { ...call.arguments,
        ...Object.fromEntries([...fields].map(([field, reference]) => [field, `[Stored content: ${reference}]`])) } };
    }) };
  });
}
