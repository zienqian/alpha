import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { createAgent } from '@alpha/adk/core';
import { answer, call, request, fakeModel, tool, deferred, options, turn } from './helpers';

test('already aborted input has a run but no user message or model request', async () => {
  const model = fakeModel(), agent = await createAgent(options(model)), events = [];
  agent.subscribe(e => events.push(e));
  const result = await agent.prompt('go', { signal: AbortSignal.abort() });
  assert.equal(result.status, 'cancelled'); assert.equal(model.inputs.length, 0);
  assert.equal(agent.state.messages.length, 0);
  assert.deepEqual(events.map(e => e.type), ['run.start', 'run.stop_requested', 'run.end']);
  await agent.close();
});

describe('abort from model.start or tool.start prevents the associated invocation', () => {
  for (const phase of ['model.start', 'tool.start']) {
    test(phase, async () => {
      let executed = 0;
      const model = fakeModel(request(call()));
      const agent = await createAgent({ ...options(model), tools: [tool(() => { executed++; return ''; })] });
      agent.subscribe(e => { if (e.type === phase) agent.abort(); });
      const result = await agent.prompt('go');
      assert.equal(result.status, 'cancelled'); assert.equal(executed, 0);
      assert.equal(model.inputs.length, phase === 'model.start' ? 0 : 1);
      if (phase === 'tool.start') assert.equal(agent.state.messages.at(-1).execution, 'not_executed');
      await agent.close();
    });
  }
});

describe('uncooperative write is awaited: late success is preserved, late rejection blocks history', () => {
  for (const reject of [false, true]) {
    test(reject ? 'unknown' : 'success', async () => {
      const started = deferred(), pending = deferred();
      const agent = await createAgent({ ...options(fakeModel(request(call()))), tools: [tool(() => { started.resolve(); return pending.promise; }, 'write')] });
      let settled = false;
      const resultPromise = agent.prompt('go').then(r => { settled = true; return r; });
      await started.promise; agent.abort();
      await turn(); assert.equal(settled, false); assert.equal(agent.state.status, 'cancelling');
      await assert.rejects(agent.prompt('other'), { code: 'AGENT_BUSY' });
      if (reject) pending.reject(new Error('unknown')); else pending.resolve('confirmed');
      const result = await resultPromise;
      assert.equal(result.status, 'cancelled');
      assert.equal(agent.state.messages.at(-1).execution, reject ? 'outcome_unknown' : 'succeeded');
      assert.equal(agent.state.historyStatus, reject ? 'blocked' : 'ready');
      await agent.close();
    });
  }
});

describe('beforeModel cancellation and model-stream cancellation do not commit late assistant output', () => {
  for (const phase of ['hook', 'model']) {
    test(phase, async () => {
      const entered = deferred(), release = deferred();
      const model = fakeModel(phase === 'model' ? async () => { entered.resolve(); await release.promise; return answer('late'); } : answer());
      const agent = await createAgent({ ...options(model), hooks: phase === 'hook' ? { beforeModel: [async m => { entered.resolve(); await release.promise; return m; }] } : {} });
      const pending = agent.prompt('go');
      await entered.promise; agent.abort(); release.resolve();
      assert.equal((await pending).status, 'cancelled');
      assert.deepEqual(agent.state.messages.map(m => m.role), ['user']);
      await agent.close();
    });
  }
});

test('first failure wins even if a failure observer subsequently aborts', async () => {
  const agent = await createAgent(options(fakeModel(() => { throw new Error('secret'); })));
  agent.subscribe(e => { if (e.type === 'run.stop_requested') agent.abort(); });
  const result = await agent.prompt('go');
  assert.equal(result.status, 'failed'); assert.equal(result.error.code, 'MODEL_FAILED');
  await agent.close();
});

describe('limits distinguish malformed batch, spent model budget, and remaining tool budget', () => {
  test('model budget', async () => {
    const agent = await createAgent({ ...options(fakeModel(request(call()))), tools: [tool()], limits: { maxModelCalls: 1 } });
    const result = await agent.prompt('go');
    assert.equal(result.status, 'limited'); assert.equal(result.reason, 'max_model_calls');
    assert.equal(agent.state.messages.at(-1).execution, 'succeeded'); await agent.close();
  });
  test('batch too large', async () => {
    const agent = await createAgent({ ...options(fakeModel(request(call(), call('c2')))), tools: [tool()], limits: { maxToolCalls: 1 } });
    const result = await agent.prompt('go');
    assert.equal(result.error.code, 'MODEL_TOOL_BATCH_TOO_LARGE');
    assert.equal(agent.state.messages.length, 1); await agent.close();
  });
  test('tool budget', async () => {
    const agent = await createAgent({ ...options(fakeModel(request(call()), request(call()))), tools: [tool()], limits: { maxToolCalls: 1 } });
    const result = await agent.prompt('go');
    assert.equal(result.status, 'limited'); assert.equal(result.reason, 'max_tool_calls');
    assert.deepEqual(agent.state.messages.filter(m => m.role === 'toolResult').map(m => m.execution), ['succeeded', 'not_executed']); await agent.close();
  });
});

test('timeout requests cancellation and still consumes the iterator to cooperative cleanup', async () => {
  let cleaned = false;
  const model = fakeModel(async function*(input) {
    try {
      await new Promise(resolve => { if (input.signal.aborted) resolve(); else input.signal.addEventListener('abort', resolve, { once: true }); });
      yield { type: 'finish', result: answer('late') };
    } finally { cleaned = true; }
  });
  const agent = await createAgent({ ...options(model), limits: { timeoutMs: 10 } });
  const result = await agent.prompt('go');
  assert.equal(result.status, 'cancelled'); assert.equal(result.reason, 'timeout'); assert.equal(cleaned, true);
  assert.equal(agent.state.messages.length, 1); await agent.close();
});

test('close is idempotent, rejects new work, and waitForIdle does not wait for plugin disposal', async () => {
  const entered = deferred(), execution = deferred(), disposing = deferred(), disposal = deferred();
  const agent = await createAgent({ ...options(fakeModel(request(call()))), tools: [tool(() => { entered.resolve(); return execution.promise; }, 'write')],
    plugins: [{ id: 'resource', apiVersion: 1, setup() {}, async dispose() { disposing.resolve(); await disposal.promise; } }] });
  const running = agent.prompt('go'); await entered.promise;
  const first = agent.close(), second = agent.close(); assert.equal(first, second);
  assert.equal(agent.state.status, 'cancelling');
  await assert.rejects(agent.prompt('other'), { code: 'AGENT_CLOSING' });
  let closed = false; first.then(() => { closed = true; });
  execution.resolve('done');
  await agent.waitForIdle(); await disposing.promise;
  assert.equal((await running).status, 'cancelled'); assert.equal(closed, false);
  assert.equal(agent.state.status, 'closed');
  disposal.resolve(); await first;
  await assert.rejects(agent.prompt('other'), { code: 'AGENT_CLOSED' });
});

test('settled runs detach external signal listeners and clear long deadlines', async () => {
  const controller = new AbortController(), signal = controller.signal;
  const add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal);
  let added = 0, removed = 0;
  signal.addEventListener = (...args) => { added++; return add(...args); };
  signal.removeEventListener = (...args) => { removed++; return remove(...args); };
  const agent = await createAgent({ ...options(fakeModel(answer())), limits: { timeoutMs: 100_000 } });
  assert.equal((await agent.prompt('go', { signal })).status, 'completed');
  assert.equal(added, 1); assert.equal(removed, 1);
  controller.abort(); assert.equal(agent.state.status, 'idle'); await agent.close();
});

test('authorization returning allow after cancellation cannot start an effect', async () => {
  const entered = deferred(), release = deferred(); let effects = 0;
  const agent = await createAgent({ ...options(fakeModel(request(call()))), tools: [tool(() => { effects++; return ''; }, 'write')],
    hooks: { authorizeTool: [async () => { entered.resolve(); await release.promise; return { action: 'allow' }; }] } });
  const pending = agent.prompt('go'); await entered.promise; agent.abort(); release.resolve();
  assert.equal((await pending).status, 'cancelled'); assert.equal(effects, 0);
  assert.equal(agent.state.messages.at(-1).execution, 'not_executed'); await agent.close();
});

test('result-hook failure after cancellation retains the successful execution fact', async () => {
  const entered = deferred(), release = deferred();
  const agent = await createAgent({ ...options(fakeModel(request(call()))), tools: [tool(() => 'done', 'write')],
    hooks: { mapToolResult: [async () => { entered.resolve(); await release.promise; throw new Error('secret'); }] } });
  const pending = agent.prompt('go'); await entered.promise; agent.abort(); release.resolve();
  assert.equal((await pending).status, 'cancelled');
  assert.equal(agent.state.messages.at(-1).execution, 'succeeded');
  assert.equal(agent.state.historyStatus, 'ready'); await agent.close();
});
