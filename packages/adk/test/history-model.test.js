import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { createAgent } from '@alpha/adk/core';
import { answer, call, request, fakeModel, tool, options } from './helpers.js';
import { createHistory, HistoryCapacity, placeholder } from '../dist/core/internal/history.js';
import { defaultLimits } from '../dist/core/internal/config.js';
import { createAssistant } from '../dist/core/internal/messages.js';
import { bytes } from '../dist/core/internal/json.js';

describe('malformed streams never commit an assistant or execute a hinted tool', () => {
  const finish = { type: 'finish', result: request(call()) };
  const cases = [
    ['missing finish', [{ type: 'tool-call', toolCall: call() }]],
    ['two finishes', [finish, finish]],
    ['event after finish', [finish, { type: 'text-delta', text: 'late' }]],
    ['duplicate call IDs', [{ type: 'finish', result: request(call(), call()) }]],
    ['empty batch', [{ type: 'finish', result: request() }]],
    ['refusal with tools', [{ type: 'finish', result: { ...request(call()), outcome: 'refused' } }]],
    ['stream throw', async function*() { yield finish; throw new Error('secret'); }],
  ];
  for (const [name, events] of cases) {
    test(name, async () => {
      let count = 0;
      const agent = await createAgent({ ...options(fakeModel(events)), tools: [tool(() => { count++; return ''; })] });
      assert.equal((await agent.prompt('go')).status, 'failed');
      assert.equal(count, 0); assert.deepEqual(agent.state.messages.map(m => m.role), ['user']);
      await agent.close();
    });
  }
});

describe('legal non-completed model outcomes retain full result metadata', () => {
  for (const outcome of ['refused', 'incomplete', 'unknown']) {
    test(outcome, async () => {
      const result = { ...answer('partial'), outcome, responseId: 'r1', refusal: 'no', usage: { inputTokens: 3, outputTokens: 2 } };
      const agent = await createAgent(options(fakeModel(result)));
      const final = await agent.prompt('go');
      assert.equal(final.status, outcome); assert.equal(final.reason, 'no');
      assert.deepEqual(final.usage, { inputTokens: 3, outputTokens: 2 });
      assert.equal(agent.state.messages[1].responseId, 'r1'); await agent.close();
    });
  }
});

describe('model output byte limits check UTF-8 deltas and the final result independently', () => {
  const cases = [
    ['delta', [{ type: 'text-delta', text: '你你' }, { type: 'finish', result: answer() }], 5],
    ['result', [{ type: 'finish', result: answer('long'.repeat(100)) }], 150],
  ];
  for (const [name, events, limit] of cases) {
    test(name, async () => {
      const agent = await createAgent({ ...options(fakeModel(events)), limits: { maxModelOutputBytes: limit } });
      assert.equal((await agent.prompt('go')).error.code, 'MODEL_OUTPUT_TOO_LARGE');
      assert.equal(agent.state.messages.length, 1); await agent.close();
    });
  }
});

test('insufficient capacity rejects the tool batch before side effects', async () => {
  let count = 0;
  const agent = await createAgent({ ...options(fakeModel(request(call()))), tools: [tool(() => { count++; return ''; })], limits: { maxHistoryMessages: 2 } });
  const result = await agent.prompt('go');
  assert.equal(result.status, 'limited'); assert.equal(result.reason, 'history_capacity');
  assert.equal(count, 0); assert.deepEqual(agent.state.messages.map(m => m.role), ['user']);
  await agent.close();
});

test('exact UTF-8 capacity reserves enough for the largest execution placeholder', () => {
  const assistant = createAssistant(request(call('工具编号')), 'assistant', 32);
  const sizing = createHistory(defaultLimits);
  sizing.commitUser('你好'); sizing.commitAssistant(assistant);
  const reserved = sizing.pending[0].reservedBytes;
  const exact = bytes(sizing.messages) + reserved + 1;
  const history = createHistory({ ...defaultLimits, maxHistoryBytes: exact });
  history.commitUser('你好'); history.commitAssistant(assistant);
  const result = history.commitTool('assistant', '工具编号', '大'.repeat(1000), 'outcome_unknown');
  assert.equal(result.limited, true);
  assert.equal(result.message.content, placeholder);
  assert.equal(history.blocked, true);
  assert.equal(bytes(history.messages), exact);
  const short = createHistory({ ...defaultLimits, maxHistoryBytes: exact - 1 });
  short.commitUser('你好');
  assert.throws(() => short.commitAssistant(assistant), HistoryCapacity);
  assert.equal(short.messages.length, 1);
});

test('replacement is atomic, immutable and rejects incomplete or unsafe histories', async () => {
  const agent = await createAgent(options(fakeModel(answer())));
  await agent.prompt('go');
  const old = agent.state.messages;
  assert.throws(() => agent.replaceMessages([{ id: 'x', role: 'toolResult', assistantId: 'y', callId: 'z', execution: 'succeeded', content: '' }]), { code: 'INPUT_INVALID' });
  assert.equal(agent.state.messages, old);
  assert.throws(() => agent.replaceMessages([createAssistant(request(call()), 'x', 32)]), { code: 'INPUT_INVALID' });
  const input = [{ id: 'u1', role: 'user', content: 'imported' }];
  agent.replaceMessages(input); input[0].content = 'mutated';
  assert.equal(agent.state.messages[0].content, 'imported'); assert.equal(old.length, 2);
  await agent.close();
});

test('projections cannot alter retained tool batches and must explicitly handle custom context', async () => {
  const model = fakeModel(request(call()), answer());
  const agent = await createAgent({ ...options(model), tools: [tool()], hooks: { beforeModel: [messages => messages.map(m => m.role === 'toolResult' ? { ...m, content: 'forged' } : m)] } });
  assert.equal((await agent.prompt('go')).error.code, 'MODEL_PROTOCOL');
  assert.equal(model.inputs.length, 1); assert.equal(agent.state.messages.at(-1).content, 'A'); await agent.close();

  const raw = await createAgent(options(fakeModel()));
  raw.replaceMessages([{ id: 'custom', role: 'custom', kind: 'app:context', data: { x: 1 } }]);
  assert.equal((await raw.prompt('go')).error.code, 'MODEL_PROTOCOL'); await raw.close();

  const transformedModel = fakeModel(answer()), transformed = await createAgent({ ...options(transformedModel), hooks: {
    beforeModel: [messages => messages.map(m => m.role === 'custom' ? { id: m.id, role: 'user', content: JSON.stringify(m.data) } : m)],
  } });
  transformed.replaceMessages([{ id: 'custom', role: 'custom', kind: 'app:context', data: { x: 1 } }]);
  assert.equal((await transformed.prompt('go')).status, 'completed');
  assert.equal(transformed.state.messages[0].role, 'custom'); await transformed.close();
});

test('projection cannot disguise a retained tool batch as ordinary messages', async () => {
  const model = fakeModel(request(call()), answer());
  const agent = await createAgent({ ...options(model), tools: [tool()], hooks: { beforeModel: [messages => messages
    .filter(m => m.role !== 'toolResult')
    .map(m => m.role === 'assistant' ? { id: m.id, role: 'user', content: 'rewritten batch' } : m)] } });
  assert.equal((await agent.prompt('go')).error.code, 'MODEL_PROTOCOL');
  assert.equal(model.inputs.length, 1);
  await agent.close();
});
