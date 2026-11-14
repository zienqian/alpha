import { test, expect } from 'bun:test';
import { projectContextHistory, projectContextMessages } from '@alpha/adk/core';

const assistant = { id: 'a', role: 'assistant', outcome: 'tool_calls', text: 'Writing', finishReason: 'tool_calls',
  toolCalls: [{ id: 'call', name: 'write', arguments: { path: 'doc.html', content: '<html>exact</html>' } }] };
const result = { id: 'r', role: 'toolResult', assistantId: 'a', callId: 'call', execution: 'succeeded', content: 'saved' };
const reference = { assistantId: 'a', callId: 'call', field: 'content', reference: 'context://exact-source' };

test('explicit input references leave execution history and protocol identities untouched', () => {
  const history = [assistant, result], saved = structuredClone(history);
  const projected = projectContextMessages(history, [reference]);
  expect(projected[0].toolCalls[0]).toEqual({ ...assistant.toolCalls[0], arguments: { path: 'doc.html', content: '[Stored content: context://exact-source]' } });
  expect(projected[1]).toEqual({ role: 'tool', toolCallId: 'call', content: 'saved' });
  expect(history).toEqual(saved);
});

test('reference projection rejects unpaired, unsuccessful, fabricated and continuation-bound inputs', () => {
  for (const history of [[assistant], [assistant, { ...result, execution: 'failed' }],
    [{ ...assistant, continuation: { provider: 'opaque' } }, result]]) {
    expect(() => projectContextHistory(history, [reference])).toThrow();
  }
  for (const references of [[reference, reference], [{ ...reference, callId: 'other' }],
    [{ ...reference, field: 'missing' }], [{ ...reference, reference: 'bad\nreference' }]]) {
    expect(() => projectContextHistory([assistant, result], references)).toThrow();
  }
});
