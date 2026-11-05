import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createAgent } from '@alpha/adk/core';
import { answer, fakeModel, tool, deferred, options, turn } from './helpers';

test('static plugins provide a model and ordered hooks, then close registration', async () => {
  const order = [], model = fakeModel(answer());
  let api;
  const agent = await createAgent({
    instructions: 'test',
    hooks: { beforeModel: [messages => { order.push('direct'); return messages; }] },
    plugins: [{
      id: 'first', apiVersion: 1, setup(value) {
        api = value; value.provideModel(model); value.addTool(tool());
        value.hook('beforeModel', messages => { order.push('first'); return messages; });
      },
    }, {
      id: 'second', apiVersion: 1, requires: ['first'],
      setup(value) { value.hook('beforeModel', messages => { order.push('second'); return [...messages, { id: 'context', role: 'user', content: 'retrieved context' }]; }); },
    }],
  });
  assert.throws(() => api.addTool(tool()), { code: 'PLUGIN_REGISTRATION_CLOSED' });
  assert.equal(api.provideLoop, undefined); assert.equal(api.callModel, undefined);
  assert.equal((await agent.prompt('go')).status, 'completed');
  assert.deepEqual(order, ['direct', 'first', 'second']);
  assert.equal(model.inputs[0].messages.at(-1).content, 'retrieved context');
  assert.equal(agent.state.messages.some(m => m.id === 'context'), false);
  await agent.close();
});

test('configuration conflicts are rejected before plugin startup', async () => {
  let starts = 0, setups = 0;
  const plugin = { id: 'x', apiVersion: 1, setup() { setups++; }, async start() { starts++; } };
  await assert.rejects(createAgent({ ...options(fakeModel()), plugins: [plugin, { ...plugin, id: 'y', requires: ['missing'] }] }), { code: 'PLUGIN_CONFLICT' });
  assert.equal(setups, 0);
  await assert.rejects(createAgent({ ...options(fakeModel()), plugins: [{ ...plugin, setup(api) { api.provideModel(fakeModel()); } }] }), { code: 'PLUGIN_CONFLICT' });
  await assert.rejects(createAgent({ instructions: '', plugins: [plugin] }), { code: 'MISSING_CAPABILITY' });
  await assert.rejects(createAgent({ ...options(fakeModel()), plugins: [{ ...plugin, setup() { throw new Error('secret'); } }] }), { code: 'PLUGIN_SETUP_FAILED' });
  await assert.rejects(createAgent({ ...options(fakeModel()), plugins: [{ ...plugin, async setup() { throw new Error('secret'); } }] }), { code: 'PLUGIN_SETUP_FAILED' });
  assert.equal(starts, 0); await turn();
});

test('startup failure cleans the failing plugin and earlier plugins in reverse order', async () => {
  const order = []; let startupSignal;
  const plugin = id => ({
    id, apiVersion: 1, setup() {},
    async start(signal) { startupSignal = signal; order.push('start:' + id); if (id === 'b') throw new Error('secret'); },
    dispose() { order.push('dispose:' + id); if (id === 'b') throw new Error('cleanup secret'); },
  });
  await assert.rejects(createAgent({ ...options(fakeModel()), plugins: [plugin('a'), plugin('b'), plugin('c')] }), e => {
    assert.equal(e.code, 'PLUGIN_START_FAILED'); assert.equal(e.cleanupErrors.length, 1);
    assert.ok(!JSON.stringify(e).includes('secret')); return true;
  });
  assert.deepEqual(order, ['start:a', 'start:b', 'dispose:b', 'dispose:a']);
  assert.equal(startupSignal.aborted, true);
});

test('initialization cancellation waits for current startup, and does not affect later runs', async () => {
  const entered = deferred(), release = deferred(), controller = new AbortController();
  let disposed = 0, settled = false;
  const pending = createAgent({ ...options(fakeModel()), signal: controller.signal, plugins: [{
    id: 'x', apiVersion: 1, setup() {}, async start(signal) {
      entered.resolve(signal); await release.promise;
    }, dispose() { disposed++; },
  }] });
  pending.then(() => { settled = true; }, () => { settled = true; });
  const signal = await entered.promise; controller.abort(); await turn();
  assert.equal(signal.aborted, true); assert.equal(settled, false); assert.equal(disposed, 0);
  release.resolve();
  await assert.rejects(pending, { code: 'INIT_ABORTED' }); assert.equal(disposed, 1);
  const later = new AbortController();
  const agent = await createAgent({ ...options(fakeModel(answer())), signal: later.signal });
  later.abort(); assert.equal((await agent.prompt('go')).status, 'completed'); await agent.close();
});

test('close continues after disposal errors and never disposes twice', async () => {
  const cleaned = [];
  const plugin = id => ({ id, apiVersion: 1, setup() {}, dispose() { cleaned.push(id); if (id === 'b') throw new Error('secret'); } });
  const agent = await createAgent({ ...options(fakeModel(answer())), plugins: [plugin('a'), plugin('b')] });
  const result = await agent.prompt('go'), first = agent.close(), second = agent.close();
  assert.equal(first, second);
  await assert.rejects(first, { code: 'PLUGIN_DISPOSE_FAILED' });
  assert.deepEqual(cleaned, ['b', 'a']); assert.equal(result.status, 'completed');
  await assert.rejects(agent.close(), { code: 'PLUGIN_DISPOSE_FAILED' });
  assert.deepEqual(cleaned, ['b', 'a']);
});

test('observer failures are isolated and a reentrant abort keeps every listener in seq order', async () => {
  const errors = [], sequences = [], events = [];
  const agent = await createAgent({ ...options(fakeModel()), onObserverError(e) { errors.push(e); throw new Error('ignored'); } });
  agent.subscribe(e => { if (e.type === 'run.start') { agent.abort(); throw new Error('secret'); } });
  agent.subscribe(async () => { throw new Error('secret promise'); });
  agent.subscribe(e => { sequences.push(e.seq); events.push(e.type); });
  assert.equal((await agent.prompt('go')).status, 'cancelled');
  await turn();
  assert.deepEqual(sequences, [1, 2, 3]);
  assert.deepEqual(events, ['run.start', 'run.stop_requested', 'run.end']);
  assert.equal(errors.length, 4); assert.ok(errors.every(e => e.code === 'OBSERVER_FAILED' && !e.message.includes('secret')));
  await agent.close();
});

test('event listener membership is snapshotted; reentrant mutations are rejected', async () => {
  const agent = await createAgent(options(fakeModel(answer())));
  const observed = [], rejected = [];
  let unsubscribe;
  agent.subscribe(e => {
    if (e.type !== 'run.start') return;
    unsubscribe();
    rejected.push(agent.prompt('reentrant').catch(e => e.code));
    rejected.push(agent.close().catch(e => e.code));
    assert.throws(() => agent.replaceMessages([]), { code: 'REENTRANT_MUTATION' });
  });
  unsubscribe = agent.subscribe(e => observed.push(e.type));
  assert.equal((await agent.prompt('go')).status, 'completed');
  assert.deepEqual(observed, ['run.start']);
  assert.deepEqual(await Promise.all(rejected), ['REENTRANT_MUTATION', 'REENTRANT_MUTATION']);
  await agent.close();
});
