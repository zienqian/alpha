import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { createMemorySessionStore, createSessionManager } from '@alpha/adk-session';
import { fixture, model, answer, request, tool, key, seed, deferred, tick } from './helpers.js';

test('Agent close cancels preparation and waits for an uncooperative selector without admission', async () => {
  const entered = deferred(), release = deferred(); let signal;
  const f = fixture({ manager: { async selectContext(ctx) { signal = ctx.signal; entered.resolve(); await release.promise; return []; } } });
  const { session, agent } = await f.create(), running = agent.prompt('q'), rejected = assert.rejects(running, { code: 'SESSION_ABORTED' });
  await entered.promise; let closed = false; const closing = agent.close().then(() => { closed = true; }); await tick();
  assert.equal(signal.aborted, true); assert.equal(closed, false); release.resolve(); await rejected; await closing;
  assert.equal(session.state.binding, 'unbound'); assert.equal((await session.getSnapshot()).revision, 0); await f.close(); await f.store.close();
});

test('request listeners detach; old signals cannot cancel later Agent invocations', async () => {
  const entered = deferred(), release = deferred(), controller = new AbortController();
  const f = fixture({ model: model(answer(), async () => { entered.resolve(); await release.promise; return answer(); }) }), { agent } = await f.create();
  await agent.prompt('first', { signal: controller.signal }); assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  const second = agent.prompt('second'); await entered.promise; controller.abort(); release.resolve();
  assert.equal((await second).status, 'completed'); await f.close(); await f.store.close();
});

test('lost commit acknowledgement remains recognized after metadata advances the revision', async () => {
  const backing = createMemorySessionStore(); let advanced = false;
  const f = fixture({ store: { ...backing, async compareAndSet(k, r, d) {
    const result = await backing.compareAndSet(k, r, d);
    if (!d.pending && result.applied && !advanced) { advanced = true; await backing.compareAndSet(k, r + 1, { ...d, title: 'later' }); throw Error('lost'); }
    return result;
  } } });
  const { session, agent } = await f.create(), result = await agent.prompt('q', { requestId: 'r' });
  assert.deepEqual(session.state.persistence, { status: 'saved', revision: 2 }); assert.equal(session.state.revision, 3);
  assert.deepEqual(await agent.prompt('q', { requestId: 'r' }), result); await f.close(); await backing.close();
});

test('uncertain admission with unreadable confirmation never executes a model', async () => {
  const backing = createMemorySessionStore(); let uncertain = false;
  const f = fixture({ store: { ...backing, async read(k) { if (uncertain) throw Error('offline'); return backing.read(k); },
    async compareAndSet(k, r, d) { await backing.compareAndSet(k, r, d); uncertain = true; throw Error('offline'); } } });
  const { session, agent } = await f.create(); await assert.rejects(agent.prompt('q'), { code: 'RECOVERY_REQUIRED' });
  assert.equal(f.model.inputs.length, 0); assert.ok((await backing.read(key(session.id))).data.pending); await f.close(); await backing.close();
});

test('deletion winning admission prevents all model and tool execution', async () => {
  const backing = createMemorySessionStore(), entered = deferred(), release = deferred();
  const f = fixture({ store: { ...backing, async compareAndSet(k, r, d) { if (d?.pending) { entered.resolve(); await release.promise; } return backing.compareAndSet(k, r, d); } } });
  const { session, agent } = await f.create(), running = agent.prompt('q'), rejected = assert.rejects(running, { code: 'SESSION_CONFLICT' }); await entered.promise;
  await f.manager.deleteSession(session.id, { expectedRevision: 0 }); release.resolve(); await rejected;
  assert.equal(f.model.inputs.length, 0); await assert.rejects(f.manager.createSession({ id: session.id }), { code: 'SESSION_EXISTS' });
  await f.close(); await backing.close();
});

test('exhausted revision, failing selector, invalid metadata and removed factories reject safely', async () => {
  const backing = createMemorySessionStore(); let writes = 0;
  const f = fixture({ store: { ...backing, async read(k) { return k.id === 'huge' ? { revision: Number.MAX_SAFE_INTEGER - 1, data: seed('huge') } : backing.read(k); }, async compareAndSet(...args) { writes++; return backing.compareAndSet(...args); } } });
  const { agent } = await f.open('huge'); await assert.rejects(agent.prompt('q'), { code: 'SESSION_CAPACITY' }); assert.equal(writes, 0);
  const metadata = {}; metadata.cycle = metadata; await assert.rejects(f.manager.createSession({ metadata }), { code: 'SESSION_INPUT_INVALID' });
  assert.throws(() => createSessionManager({ namespace: 'test', agentKey: 'v', store: backing, createAgent() {} }), { code: 'SESSION_CONFIG_INVALID' });
  await f.close(); await backing.close();
  const bad = fixture({ manager: { selectContext() { throw Error('secret'); } } }), next = await bad.create();
  await assert.rejects(next.agent.prompt('q'), { code: 'SESSION_CONTEXT_INVALID' }); assert.equal((await next.session.getSnapshot()).revision, 0); await bad.close(); await bad.store.close();
});

test('malformed archives, incomplete batches and duplicate receipts fail before binding', async () => {
  const f = fixture({ model: model(request(), answer()), agent: { tools: [tool()] } }), { session, agent } = await f.create();
  await agent.prompt('q'); const original = await session.getSnapshot();
  for (const corrupt of [
    x => { x.data.formatVersion = 99; },
    x => { x.data.turns[0].messages = x.data.turns[0].messages.filter(m => m.role !== 'toolResult'); },
    x => { x.data.turns[0].messages.push(x.data.turns[0].messages[0]); },
    x => { x.data.turns.push(x.data.turns[0]); },
    x => { x.data.turns[0].committedRevision = 100; },
    x => { x.data.turns[0].inputHash = 'bad'; },
  ]) {
    const data = structuredClone(original); corrupt(data);
    const other = fixture({ store: { ...f.store, async read() { return data; } } });
    await assert.rejects(other.open(session.id), { code: 'SESSION_FORMAT_INVALID' }); assert.equal(other.agents.length, 0); await other.close();
  }
  await f.close(); await f.store.close();
});

for (const status of ['completed', 'refused', 'incomplete', 'unknown', 'failed', 'limited']) test(`archive retains the original ${status} RunResult`, async () => {
  const llm = status === 'failed' ? model(() => { throw Error('failed'); }) : status === 'limited' ? model(request()) : model({ ...answer(status), outcome: status });
  const f = fixture({ model: llm, agent: { tools: [tool()], limits: { maxModelCalls: 1 } } }), { session, agent } = await f.create();
  const result = await agent.prompt('q'); assert.equal(result.status, status); assert.equal(session.state.persistence.status, 'saved');
  assert.deepEqual((await session.getSnapshot()).data.turns[0].run, result); await f.close(); await f.store.close();
});

for (const invalid of [false, true]) test(`create errors retain identity and sanitize diagnostics (malformed=${invalid})`, async () => {
  const backing = createMemorySessionStore();
  const f = fixture({ store: { ...backing, async create(k, data) {
    if (invalid) { await backing.create(k, data); return { revision: 'bad', data }; }
    throw Error('private database');
  } } });
  await assert.rejects(f.manager.createSession({ id: 'known' }), e => e.sessionId === 'known' && e.code === (invalid ? 'SESSION_FORMAT_INVALID' : 'STORE_UNAVAILABLE') && !e.message.includes('private'));
  if (invalid) assert.ok(await backing.read(key('known'))); await f.close(); await backing.close();
});
