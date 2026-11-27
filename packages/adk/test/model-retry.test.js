import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createAgent } from '@alpha/adk/core';
import { ProviderError } from '@alpha/provider';
import { answer, call, request, fakeModel, tool, options } from './helpers';

const unavailable = () => { throw new ProviderError('REQUEST_FAILED', 'Unavailable', { status: 503 }); };

test('retries exactly five times and reports backoff before failing', async () => {
  const model = fakeModel(...Array(6).fill(unavailable));
  const agent = await createAgent(options(model));
  const retries = [], starts = [], ends = [];
  agent.subscribe(event => {
    if (event.type === 'model.retry') retries.push(event);
    if (event.type === 'model.start') starts.push(event.modelCallId);
    if (event.type === 'model.end') ends.push(event.modelCallId);
  });
  try {
    assert.equal((await agent.prompt('go')).status, 'failed');
    assert.equal(model.inputs.length, 6);
    assert.deepEqual(retries.map(e => e.attempt), [1, 2, 3, 4, 5]);
    assert.deepEqual(retries.map(e => e.delayMs), [1000, 2000, 4000, 8000, 16000]);
    assert.deepEqual(starts, ends);
    assert.equal(agent.state.messages.length, 1);
  } finally { await agent.close(); }
}, 40000);

test('recovers from a broken stream without replaying completed tools or committing partial output', async () => {
  let executions = 0;
  const model = fakeModel(request(call()), async function* () {
    yield { type: 'text-delta', text: 'discard this preview' };
    unavailable();
  }, answer('recovered'));
  const agent = await createAgent({ ...options(model), tools: [tool(() => { executions++; return 'saved'; }, 'write')] });
  try {
    assert.equal((await agent.prompt('go')).status, 'completed');
    assert.equal(executions, 1);
    assert.equal(agent.state.messages.filter(m => m.role === 'toolResult').length, 1);
    assert.equal(agent.state.messages.at(-1).text, 'recovered');
    assert.equal(JSON.stringify(agent.state.messages).includes('discard this preview'), false);
    assert.deepEqual(model.inputs[1].messages, model.inputs[2].messages);
  } finally { await agent.close(); }
});

for (const status of [400, 401, 403, 404]) test(`does not retry HTTP ${status}`, async () => {
  const model = fakeModel(() => { throw new ProviderError('REQUEST_FAILED', 'Rejected', { status }); });
  const agent = await createAgent(options(model));
  try {
    assert.equal((await agent.prompt('go')).status, 'failed');
    assert.equal(model.inputs.length, 1);
  } finally { await agent.close(); }
});

test('stop during retry backoff cancels without making another request', async () => {
  const model = fakeModel(unavailable, answer());
  const agent = await createAgent(options(model));
  agent.subscribe(event => { if (event.type === 'model.retry') agent.abort(); });
  try {
    assert.equal((await agent.prompt('go')).status, 'cancelled');
    assert.equal(model.inputs.length, 1);
  } finally { await agent.close(); }
});
