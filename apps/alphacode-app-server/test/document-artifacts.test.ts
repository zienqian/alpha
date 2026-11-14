import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { createMemoryArtifactStore, contentHash } from '@alpha/adk-artifact';
import type { Message } from '@alpha/adk/core';
import { artifactForPath, documentWrites } from '../src/server/artifacts';

test('path links never substitute an old snapshot for a newer write whose artifact failed', async () => {
  const store = createMemoryArtifactStore(), scope = { namespace: 'p', sessionId: 's' };
  const workspace = resolve('workspace'), path = resolve(workspace, 'report.html');
  const first = await store.put(scope, { content: 'first', source: {
    runId: 'run', assistantId: 'a', callId: 'create', channel: 'file', path, revision: await contentHash('first'),
  } });
  const messages: Message[] = [
    { id: 'a', role: 'assistant', outcome: 'tool_calls', finishReason: 'tool_calls', text: '', toolCalls: [
      { id: 'create', name: 'create_file', arguments: { path: 'report.html', content: 'first' } },
      { id: 'edit', name: 'edit_file', arguments: { path: 'report.html', oldText: 'first', newText: 'second' } },
    ] },
    { id: 'r1', role: 'toolResult', assistantId: 'a', callId: 'create', execution: 'succeeded',
      content: JSON.stringify({ ok: true, data: { path: 'report.html', created: true } }) },
    { id: 'r2', role: 'toolResult', assistantId: 'a', callId: 'edit', execution: 'succeeded',
      content: JSON.stringify({ ok: true, data: { path: 'report.html', changed: true, artifactStorage: { status: 'failed' } } }) },
  ];
  expect(await artifactForPath(store, scope, workspace, path, documentWrites(messages.slice(0, 2)))).toBe(first.reference);
  expect(documentWrites(messages)).toHaveLength(2);
  expect(await artifactForPath(store, scope, workspace, path, documentWrites(messages))).toBeUndefined();
  expect(await artifactForPath(store, scope, workspace, 'different.html', documentWrites(messages))).toBeUndefined();
});
