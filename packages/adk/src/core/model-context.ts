import type { GenerateInput, Message as ProviderMessage } from '@alpha/provider';
import type { Message } from './contracts';

/** Conservative UTF-8 estimate, not a tokenizer. Scale only increases from observed usage. */
export function estimateContextTokens(input: Pick<GenerateInput, 'messages' | 'tools'>, scale = 1): number {
  const count = (value: unknown) => Math.ceil(new TextEncoder().encode(JSON.stringify(value)).length / 2.5);
  return Math.ceil((input.messages.reduce((n, m) => n + 16 + count(m), 0) + (input.tools?.length ? 32 + count(input.tools) : 0)) * scale);
}

/** Does not validate history; the kernel validates before using this projection. */
export function projectContextMessages(messages: readonly Message[]): ProviderMessage[] {
  return messages.flatMap((m): ProviderMessage[] => {
    if (m.role === 'custom') return [];
    if (m.role === 'user') return [{ role: 'user', content: m.content }];
    if (m.role === 'toolResult') return [{ role: 'tool', toolCallId: m.callId, content: m.content }];
    return [{ role: 'assistant', content: m.text,
      ...(m.toolCalls.length ? { toolCalls: JSON.parse(JSON.stringify(m.toolCalls)) } : {}),
      ...(m.continuation ? { continuation: JSON.parse(JSON.stringify(m.continuation)) } : {}) }];
  });
}
