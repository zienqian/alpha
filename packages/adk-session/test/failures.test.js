import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createMemorySessionStore } from '@alpha/adk-session';
import { fixture, answer, model, tool, request, key, deferred, tick } from './helpers.js';

test('failed save preserves RunResult; flush retries only storage and emits one receipt', async () => {
  const backing = createMemorySessionStore(); let fail = true, effects = 0;
  const f = fixture({ store: { ...backing, async compareAndSet(k, r, d) { if (!d?.pending && fail) throw Error('secret'); return backing.compareAndSet(k, r, d); } },
    model: model(request(), answer()), agent: { tools: [tool(() => { effects++; return 'written'; }, 'write')] } });
  const { session, agent } = await f.create(), events = []; session.subscribe(e => events.push(e));
  const result = await agent.prompt('execute', { requestId: 'r' });
  assert.equal(result.status, 'completed'); assert.deepEqual(session.state.persistence, { status: 'pending', code: 'STORE_UNAVAILABLE' });
  assert.equal(session.state.status, 'unsaved'); assert.equal(agent.state.boundaryStatus, 'ready');
  await assert.rejects(agent.prompt('next'), { code: 'SESSION_UNSAVED' });
  assert.equal((await session.flush()).status, 'pending'); assert.equal(events.filter(e => e.type === 'session.unsaved').length, 1);
  fail = false; assert.deepEqual(await session.flush(), { status: 'saved', revision: 2 });
  assert.equal(effects, 1); assert.equal(events.filter(e => e.type === 'session.saved').length, 1);
  assert.equal((await session.getSnapshot()).data.turns[0].run.runId, result.runId); await f.close(); await backing.close();
});

test('prompt and waitForIdle include final persistence; no new run starts during saving', async () => {
  const backing = createMemorySessionStore(), entered = deferred(), release = deferred();
  const f = fixture({ store: { ...backing, async compareAndSet(k, r, d) { if (!d.pending) { entered.resolve(); await release.promise; } return backing.compareAndSet(k, r, d); } } });
  const { session, agent } = await f.create(), running = agent.prompt('q'); await entered.promise;
  let idle = false, returned = false;
  const waiting = agent.waitForIdle().then(() => { idle = true; }); running.then(() => { returned = true; });
  await tick(); assert.equal(idle, false); assert.equal(returned, false); assert.equal(session.state.status, 'saving');
  await assert.rejects(agent.prompt('too soon'), { code: 'AGENT_BUSY' }); await assert.rejects(session.flush(), { code: 'SESSION_BUSY' });
  release.resolve(); assert.equal((await running).status, 'completed'); await waiting; assert.equal(session.state.persistence.status, 'saved');
  await f.close(); await backing.close();
});

for (const phase of ['create', 'admission', 'commit']) test(`lost ${phase} acknowledgement never duplicates the effect`, async () => {
  const backing = createMemorySessionStore(); let lost = false, effects = 0;
  const store = { ...backing,
    async create(k, d) { const result = await backing.create(k, d); if (phase === 'create') throw Error('lost'); return result; },
    async compareAndSet(k, r, d) { const result = await backing.compareAndSet(k, r, d); if (!lost && ((phase === 'admission' && d.pending) || (phase === 'commit' && !d.pending))) { lost = true; throw Error('lost'); } return result; },
  };
  const f = fixture({ store, model: model(request(), answer()), agent: { tools: [tool(() => { effects++; return 'written'; }, 'write')] } });
  const { session, agent } = await f.create({ id: 'stable' }), result = await agent.prompt('execute', { requestId: 'r' });
  assert.equal(session.state.persistence.status, 'saved'); assert.deepEqual(await agent.prompt('execute', { requestId: 'r' }), result);
  assert.equal(effects, 1); await f.close(); await backing.close();
});

test('foreign state causes a commit conflict, never overwrite; close detaches but keeps the unsaved candidate', async () => {
  const backing = createMemorySessionStore(); let change = true;
  const f = fixture({ store: { ...backing, async compareAndSet(k, r, d) {
    if (d && !d.pending && change) { change = false; const current = await backing.read(k); await backing.compareAndSet(k, r, { ...current.data, pending: { ...current.data.pending, token: 'foreign' } }); return { applied: false }; }
    return backing.compareAndSet(k, r, d);
  } } });
  const { session, agent } = await f.create(); assert.equal((await agent.prompt('q')).status, 'completed');
  assert.equal(session.state.persistence.code, 'COMMIT_CONFLICT'); assert.equal((await session.flush()).code, 'COMMIT_CONFLICT');
  await assert.rejects(agent.close(), { code: 'PLUGIN_DISPOSE_FAILED' }); assert.equal(agent.state.status, 'closed');
  assert.equal(session.state.binding, 'unbound'); assert.equal(session.state.status, 'unsaved');
  await assert.rejects(session.close(), { code: 'COMMIT_CONFLICT' }); assert.equal(session.state.status, 'unsaved');
  assert.equal((await backing.read(key(session.id))).data.pending.token, 'foreign'); await backing.close();
});

test('failed Agent disposal does not destroy a candidate; it can flush after Agent closes', async () => {
  const backing = createMemorySessionStore(); let fail = true;
  const f = fixture({ store: { ...backing, async compareAndSet(k, r, d) { if (!d.pending && fail) throw Error('offline'); return backing.compareAndSet(k, r, d); } } });
  const { session, agent } = await f.create(), result = await agent.prompt('q');
  await assert.rejects(agent.close(), { code: 'PLUGIN_DISPOSE_FAILED' }); await assert.rejects(f.manager.close(), { code: 'STORE_UNAVAILABLE' });
  fail = false; assert.equal((await session.flush()).status, 'saved');
  assert.equal((await session.getSnapshot()).data.turns[0].run.runId, result.runId); await f.manager.close(); await backing.close();
});

test('same Agent rejects overlapping prompts; distinct handles obey persisted admission', async () => {
  const entered = deferred(), release = deferred();
  const f = fixture({ model: model(async () => { entered.resolve(); await release.promise; return answer(); }) });
  const a = await f.create(), b = await f.open(a.session.id), running = a.agent.prompt('first'); await entered.promise;
  await assert.rejects(a.agent.prompt('second'), { code: 'AGENT_BUSY' });
  await assert.rejects(b.agent.prompt('other'), { code: 'RECOVERY_REQUIRED' });
  await assert.rejects(f.manager.deleteSession(a.session.id, { expectedRevision: 1 }), { code: 'RECOVERY_REQUIRED' });
  await assert.rejects(f.manager.updateSession(a.session.id, { title: 'no' }, { expectedRevision: 1 }), { code: 'RECOVERY_REQUIRED' });
  release.resolve(); await running; assert.equal(f.model.inputs.length, 1); await f.close(); await f.store.close();
});

test('pre-abort writes nothing; cancellation during admitted CAS archives an empty cancelled run', async () => {
  const backing = createMemorySessionStore(), entered = deferred(), release = deferred();
  const f = fixture({ store: { ...backing, async compareAndSet(k, r, d) { if (d?.pending) { entered.resolve(); await release.promise; } return backing.compareAndSet(k, r, d); } } });
  const { session, agent } = await f.create(), controller = new AbortController(); controller.abort();
  await assert.rejects(agent.prompt('q', { signal: controller.signal }), { code: 'SESSION_ABORTED' });
  assert.equal((await session.getSnapshot()).revision, 0);
  const running = agent.prompt('q'); await entered.promise; agent.abort(); release.resolve();
  const result = await running; assert.equal(result.status, 'cancelled'); assert.equal(session.state.persistence.status, 'saved');
  assert.deepEqual((await session.getSnapshot()).data.turns[0].messages, []); assert.equal(f.model.inputs.length, 0);
  await f.close(); await backing.close();
});

test('Agent close awaits uncooperative writes and saves their late confirmed success', async () => {
  const entered = deferred(), release = deferred(); let disposed = 0;
  const f = fixture({ model: model(request()), agent: { tools: [tool(async () => { entered.resolve(); await release.promise; return 'written'; }, 'write')],
    plugins: [{ id: 'resource', apiVersion: 1, setup() {}, dispose() { disposed++; } }] } });
  const { session, agent } = await f.create(), running = agent.prompt('q'); await entered.promise;
  let closed = false; const closing = agent.close(); assert.equal(agent.close(), closing); closing.then(() => { closed = true; }); await tick(); assert.equal(closed, false);
  release.resolve(); assert.equal((await running).status, 'cancelled'); await closing;
  assert.equal(disposed, 1); assert.equal((await session.getSnapshot()).data.turns[0].messages.at(-1).execution, 'succeeded');
  assert.equal(session.state.binding, 'unbound'); await f.close(); await f.store.close();
});

test('Session observer errors are isolated and mutation during dispatch is rejected', async () => {
  const diagnostics = [], mutations = [];
  const f = fixture({ manager: { onObserverError: e => diagnostics.push(e) } }), { session, agent } = await f.create();
  session.subscribe(() => { mutations.push(session.flush().catch(e => e.code)); mutations.push(session.close().catch(e => e.code)); mutations.push(f.manager.createSession().catch(e => e.code)); });
  session.subscribe(() => { throw Error('secret'); }); session.subscribe(async () => { throw Error('secret'); });
  assert.equal((await agent.prompt('q')).status, 'completed'); assert.equal(session.state.persistence.status, 'saved');
  assert.deepEqual(await Promise.all(mutations), ['SESSION_REENTRANT', 'SESSION_REENTRANT', 'SESSION_REENTRANT']); await tick();
  assert.ok(diagnostics.every(e => e.code === 'OBSERVER_FAILED' && !e.message.includes('secret'))); await f.close(); await f.store.close();
});

test('manager close waits for in-flight create and leaves its persisted record intact', async () => {
  const backing = createMemorySessionStore(), entered = deferred(), release = deferred();
  const f = fixture({ store: { ...backing, async create(k, d) { entered.resolve(); await release.promise; return backing.create(k, d); } } });
  const creating = f.manager.createSession({ id: 'slow' }); await entered.promise;
  const rejected = assert.rejects(creating, { code: 'MANAGER_CLOSING' }), closing = f.manager.close(); assert.equal(f.manager.close(), closing);
  release.resolve(); await rejected; await closing; assert.ok(await backing.read(key('slow'))); await backing.close();
});
