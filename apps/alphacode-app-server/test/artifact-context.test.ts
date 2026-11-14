import { expect, test } from 'bun:test';
import { createMemoryArtifactStore, contentHash } from '@alpha/adk-artifact';
import { createContextReader } from '@alpha/adk-context';
import type { AssistantMessage, Message } from '@alpha/adk/core';
import { fileInputReferences } from '../src/runtime/artifact-context';

test('file input projection verifies snapshots, preserves failures, and references exact large edit inputs', async () => {
  const store = createMemoryArtifactStore(), scope = { namespace: 'project', sessionId: 'session' };
  const original = 'OLD'.repeat(1000), revised = 'NEW'.repeat(1000);
  const call = { id: 'c', name: 'create_file', arguments: { path: 'doc.html', content: original } };
  const assistant: AssistantMessage = { id: 'a', role: 'assistant', outcome: 'tool_calls', finishReason: 'tool_calls', text: '', toolCalls: [call] };
  const saved = await store.put(scope, { content: original, source: { runId: 'run', assistantId: 'a', callId: 'c', channel: 'file', path: '/doc.html', revision: await contentHash(original) } });
  const result: Message = { id: 'r', role: 'toolResult', assistantId: 'a', callId: 'c', execution: 'succeeded',
    content: JSON.stringify({ ok: true, data: { artifact: { reference: saved.reference }, afterRevision: saved.sha256 } }) };
  const messages: Message[] = [assistant, result];
  const project = fileInputReferences(store, scope), signal = new AbortController().signal;
  expect(await project(messages, signal)).toEqual([{ assistantId: 'a', callId: 'c', field: 'content', reference: saved.reference }]);
  expect(await project([{ ...assistant, continuation: { protocol: 'anthropic-messages', content: [] } }, result], signal)).toEqual([]);
  expect(await project([{ ...assistant, toolCalls: [{ ...call, arguments: { content: 'different' } }] }, result], signal)).toEqual([]);
  const edit: AssistantMessage = { id: 'edit', role: 'assistant', outcome: 'tool_calls', finishReason: 'tool_calls', text: '', toolCalls: [{ id: 'e', name: 'edit_file', arguments: { path: 'doc.html', oldText: original, newText: revised } }] };
  const updated = await store.put(scope, { content: revised, source: { runId: 'run', assistantId: 'edit', callId: 'e', channel: 'file', path: '/doc.html', revision: await contentHash(revised) } });
  messages.push(edit, { id: 'er', role: 'toolResult', assistantId: 'edit', callId: 'e', execution: 'succeeded', content: JSON.stringify({ ok: true, data: { artifact: { reference: updated.reference }, afterRevision: updated.sha256 } }) });
  const refs = await project(messages, signal);
  expect(refs.map(item => item.field)).toEqual(['content', 'oldText', 'newText']);
  const read = createContextReader({ scope, artifacts: store, messages: () => messages });
  const exact = await read({ reference: refs[1]?.reference ?? '', maxBytes: 4096 });
  expect(exact.content).toContain(original);
  await store.remove(scope);
  expect(await project(messages, signal)).toEqual([]);
});
