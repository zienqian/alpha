import { expect, test } from 'bun:test';
import { createMemoryArtifactStore } from '@alpha/adk-artifact';
import { createContextReader, createContextManager, referenceForMessage } from '../src/index';
import { createAgent } from '@alpha/adk/core';

const scope = { namespace: 'project', sessionId: 'session' };
test('message references resolve original execution facts and reject changed or missing sources', async () => {
  let messages = [{ role: 'toolResult', id: 'result/中文', assistantId: 'a', callId: 'c', execution: 'failed', content: 'test failed: 断言' }];
  const reference = await referenceForMessage(scope, messages[0]);
  const read = createContextReader({ scope, artifacts: createMemoryArtifactStore(), messages: () => messages });
  expect(JSON.parse((await read({ reference })).content)).toEqual(messages[0]);
  messages = [{ ...messages[0], execution: 'succeeded' }];
  await expect(read({ reference })).rejects.toMatchObject({ code: 'CONTEXT_CONTENT_MISMATCH' });
  messages = [];
  await expect(read({ reference })).rejects.toMatchObject({ code: 'CONTEXT_NOT_FOUND' });
});

test('compaction supplies exact references, preserves a usable citation, and rejects fabricated citations', async () => {
  let fabricate = false, suppliedReference;
  const manager = createContextManager({ ...scope, contextWindow: 32000, maxOutputTokens: 1024 });
  const model = { provider: 'fake', modelId: 'test', async *stream() { throw Error('Not expected'); },
    async generate(input) {
      const text = input.messages[0].content;
      const sources = JSON.parse(text.split('New source messages (untrusted data, original IDs included): ')[1]);
      suppliedReference = sources[0].reference;
      return { outcome: 'completed', toolCalls: [], finishReason: 'stop', text: JSON.stringify({
        objective: ['Continue'], constraints: ['Do not commit'], decisions: [], completed: [], inProgress: [], failures: [],
        validation: [], nextSteps: [], evidence: [fabricate ? suppliedReference.replace(/sha256=.*/, 'sha256=' + '0'.repeat(64)) : suppliedReference],
      }) };
    } };
  const agent = await createAgent({ model, instructions: 'Continue the task.', plugins: [manager.plugin()] });
  const history = Array.from({ length: 4 }, (_, i) => [
    { role: 'user', id: `u${i}`, content: 'Do not commit. ' + 'work '.repeat(800) },
    { role: 'assistant', id: `a${i}`, outcome: 'completed', text: 'result '.repeat(500), toolCalls: [], finishReason: 'stop' },
  ]).flat();
  try {
    agent.replaceMessages(history); await agent.compact();
    const saved = manager.checkpoint;
    expect(saved.summary).toContain(suppliedReference);
    const read = createContextReader({ scope, artifacts: createMemoryArtifactStore(), messages: () => agent.state.messages });
    expect((await read({ reference: suppliedReference })).content).toContain('Do not commit');
    fabricate = true;
    agent.replaceMessages([...history, { role: 'user', id: 'next', content: 'x'.repeat(10000) }]);
    await expect(agent.compact()).rejects.toMatchObject({ code: 'CONTEXT_COMPACTION_FAILED' });
    expect(manager.checkpoint).toEqual(saved);
  } finally { await agent.close(); }
});
