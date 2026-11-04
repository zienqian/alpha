import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '@alpha/adk/core';
import { answer, fakeModel, options, deferred, turn } from './helpers.js';

const plugin = boundary => ({ id: 'boundary', apiVersion: 1, setup(api) { api.provideRunBoundary(boundary); } });
test('run boundary awaits prepare and complete; expired history capabilities cannot mutate the Agent', async () => {
  const prepared = deferred(), saving = deferred(), releasePrepare = deferred(), releaseSave = deferred();
  let port, request, final;
  const model = fakeModel(answer('answer'));
  const agent = await createAgent({ ...options(model), plugins: [plugin({ async prepare(r, h) {
    request = r; port = h; prepared.resolve(); await releasePrepare.promise;
    h.restore([{ id: 'old', role: 'user', content: 'prior context' }]);
    return { type: 'execute', async complete(snapshot) { final = snapshot; saving.resolve(); await releaseSave.promise; } };
  } })] });
  assert.throws(() => agent.replaceMessages([]), { code: 'HISTORY_MANAGED' });
  const pending = agent.prompt('next', { requestId: 'stable' }); await prepared.promise;
  assert.equal(model.inputs.length, 0); assert.equal(request.requestId, 'stable'); assert.equal(request.agentId, agent.id);
  await assert.rejects(agent.prompt('overlap'), { code: 'AGENT_BUSY' });
  releasePrepare.resolve(); await saving.promise;
  assert.equal(agent.state.status, 'running'); assert.equal(final.result.text, 'answer');
  assert.deepEqual(model.inputs[0].messages.slice(1).map(m => m.content), ['prior context', 'next']);
  assert.throws(() => port.restore([]), { code: 'RUN_PREPARATION_CLOSED' });
  let idle = false; const waiting = agent.waitForIdle().then(() => { idle = true; }); await turn(); assert.equal(idle, false);
  releaseSave.resolve(); assert.equal(await pending, final.result); await waiting; await agent.close();
});

test('replay skips the Loop and events and validates immutable results', async () => {
  const result = { runId: 'prior', status: 'completed', text: 'saved' }, model = fakeModel(answer());
  const agent = await createAgent({ ...options(model), plugins: [plugin({ prepare: () => ({ type: 'replay', result }) })] });
  const events = []; agent.subscribe(e => events.push(e));
  const replay = await agent.prompt('same'); result.text = 'mutated';
  assert.equal(replay.text, 'saved'); assert.ok(Object.isFrozen(replay)); assert.equal(model.inputs.length, 0); assert.equal(events.length, 0);
  await agent.close();
  const invalid = await createAgent({ ...options(model), plugins: [plugin({ prepare: () => ({ type: 'replay', result: { status: 'completed' } }) })] });
  await assert.rejects(invalid.prompt('bad'), { code: 'RUN_BOUNDARY_INVALID' }); await invalid.close();
});

test('boundary faults preserve completed execution facts and quarantine further execution', async () => {
  const diagnostics = [], model = fakeModel(answer('already done'));
  const agent = await createAgent({ ...options(model), onObserverError: e => diagnostics.push(e), plugins: [plugin({ prepare: () => ({ type: 'execute', complete() { throw new Error('secret database'); } }) })] });
  assert.equal((await agent.prompt('go')).text, 'already done'); assert.equal(agent.state.boundaryStatus, 'failed');
  await assert.rejects(agent.prompt('do not repeat'), { code: 'RUN_BOUNDARY_FAILED' }); assert.equal(model.inputs.length, 1);
  assert.equal(diagnostics[0].code, 'RUN_BOUNDARY_FAILED'); assert.ok(!JSON.stringify(diagnostics).includes('secret')); await agent.close();
});

test('prepare errors are sanitized, reusable and release captured history ports', async () => {
  let port, fails = true;
  const agent = await createAgent({ ...options(fakeModel(answer())), plugins: [plugin({ prepare(_r, h) {
    port = h; if (fails) throw Object.assign(new Error('private payload'), { code: 'ADMISSION_REJECTED' });
    return { type: 'execute', complete() {} };
  } })] });
  await assert.rejects(agent.prompt('first'), e => e.code === 'ADMISSION_REJECTED' && !e.message.includes('private'));
  assert.throws(() => port.restore([]), { code: 'RUN_PREPARATION_CLOSED' });
  fails = false; assert.equal((await agent.prompt('second')).status, 'completed'); await agent.close();
  const malformed = await createAgent({ ...options(fakeModel(answer())), plugins: [plugin({ prepare: () => ({ get type() { throw Error('private plan'); } }) })] });
  await assert.rejects(malformed.prompt('bad'), e => e.code === 'RUN_BOUNDARY_FAILED' && !e.message.includes('private')); await malformed.close();
});

test('abort and close reach preparation, wait for saving and dispose only after completion', async () => {
  const entered = deferred(), release = deferred(), saved = deferred(), releaseSave = deferred(), order = [];
  let signal;
  const boundary = plugin({ async prepare(r) { signal = r.signal; entered.resolve(); await release.promise; return {
    type: 'execute', async complete(snapshot) { order.push(snapshot.result.status); saved.resolve(); await releaseSave.promise; order.push('saved'); },
  }; } });
  boundary.dispose = () => { order.push('disposed'); };
  const model = fakeModel(answer()), agent = await createAgent({ ...options(model), plugins: [boundary] });
  const pending = agent.prompt('go'); await entered.promise; const closing = agent.close(); assert.equal(signal.aborted, true);
  release.resolve(); await saved.promise; assert.equal(model.inputs.length, 0); assert.deepEqual(order, ['cancelled']);
  releaseSave.resolve(); assert.equal((await pending).status, 'cancelled'); await closing; assert.deepEqual(order, ['cancelled', 'saved', 'disposed']);
});

test('boundary registration is unique and closed after setup; malformed request IDs never prepare', async () => {
  const model = fakeModel(answer()); let api, calls = 0;
  const boundary = { prepare() { calls++; return { type: 'execute', complete() {} }; } };
  await assert.rejects(createAgent({ ...options(model), plugins: [plugin(boundary), { ...plugin(boundary), id: 'other' }] }), { code: 'PLUGIN_CONFLICT' });
  const agent = await createAgent({ ...options(model), plugins: [{ id: 'capture', apiVersion: 1, setup(a) { api = a; a.provideRunBoundary(boundary); } }] });
  assert.throws(() => api.provideRunBoundary(boundary), { code: 'PLUGIN_REGISTRATION_CLOSED' });
  for (const requestId of ['', 4, 'a\n', 'x'.repeat(513)]) await assert.rejects(agent.prompt('bad', { requestId }), { code: 'INPUT_INVALID' });
  assert.equal(calls, 0); await agent.close();
});
