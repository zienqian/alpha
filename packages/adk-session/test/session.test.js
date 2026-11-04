import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '@alpha/adk/core';
import { createSession, createSessionPlugin, createMemorySessionStore, createSessionManager } from '@alpha/adk-session';
import { fixture, answer, model, tool, request, key } from './helpers.js';

test('Session is a data handle; only Agent executes, returns RunResult and owns cancellation', async () => {
  await assert.rejects(createSession({ get store() { throw Error('private config'); } }), e => e.code === 'SESSION_CONFIG_INVALID' && !e.message.includes('private'));
  assert.throws(() => createSessionPlugin({ get session() { throw Error('private config'); } }), e => e.code === 'SESSION_CONFIG_INVALID' && !e.message.includes('private'));
  const store = createMemorySessionStore();
  const session = await createSession({ store, namespace: 'test', agentKey: 'agent@1', title: 'direct' });
  assert.deepEqual(Object.keys(session).sort(), ['close', 'flush', 'getSnapshot', 'id', 'state', 'subscribe']);
  const agent = await createAgent({ model: model(), instructions: '', plugins: [createSessionPlugin({ session })] });
  assert.equal(session.state.binding, 'bound');
  const result = await agent.prompt('hello');
  assert.equal(result.status, 'completed'); assert.equal(result.run, undefined);
  assert.match(session.state.requestId, /^request_/); assert.deepEqual(session.state.persistence, { status: 'saved', revision: 2 });
  assert.equal((await session.getSnapshot()).data.turns[0].run.runId, result.runId);
  assert.throws(() => agent.replaceMessages([]), { code: 'HISTORY_MANAGED' });
  await assert.rejects(session.close(), { code: 'SESSION_BOUND' });
  await agent.close(); assert.equal(session.state.binding, 'unbound'); await session.close(); await store.close();
});

test('restores saved conversations; duplicate IDs return the old result without events or execution', async () => {
  const f = fixture(), first = await f.create({ id: 'one', title: 'conversation', metadata: { owner: 'A' } });
  const events = []; first.agent.subscribe(e => events.push(e.type)); first.session.subscribe(e => events.push(e.type));
  const result = await first.agent.prompt('hello', { requestId: 'r1' });
  assert.deepEqual(events.slice(-2), ['run.end', 'session.saved']);
  await first.agent.close(); await first.session.close();
  const next = await f.open('one'), repeatedEvents = []; next.agent.subscribe(e => repeatedEvents.push(e)); next.session.subscribe(e => repeatedEvents.push(e));
  assert.deepEqual(await next.agent.prompt('hello', { requestId: 'r1' }), result);
  assert.equal(f.model.inputs.length, 1); assert.equal(repeatedEvents.length, 0);
  await assert.rejects(next.agent.prompt('changed', { requestId: 'r1' }), { code: 'REQUEST_MISMATCH' });
  await next.agent.prompt('second', { requestId: 'r2' });
  assert.deepEqual(f.model.inputs[1].messages.map(m => m.role), ['system', 'user', 'assistant', 'user']);
  assert.equal((await f.manager.getSession('one')).data.turns.length, 2);
  const foreign = createSessionManager({ namespace: 'other', agentKey: 'agent@1', store: f.store });
  assert.equal(await foreign.getSession('one'), undefined); await foreign.close(); await f.close();
  assert.ok(await f.store.read(key('one'))); await f.store.close();
});

test('context selection keeps full archives; invalid selection and core capacity fail before admission', async () => {
  const f = fixture({ manager: { selectContext: ({ turns }) => turns.slice(-1).map(t => t.run.runId) } }), { session, agent } = await f.create();
  for (let i = 0; i < 5; i++) await agent.prompt(`q${i}`, { requestId: `r${i}` });
  assert.equal(f.model.inputs.at(-1).messages.length, 4); assert.equal((await session.getSnapshot()).data.turns.length, 5);
  await f.close();
  for (const settings of [{ manager: { selectContext: () => ['missing'] } }, { agent: { limits: { maxHistoryMessages: 1 } } }]) {
    const bad = fixture({ store: f.store, ...settings }), reopened = await bad.open(session.id);
    await assert.rejects(reopened.agent.prompt('bad'), { code: 'SESSION_CONTEXT_INVALID' });
    assert.equal((await f.store.read(key(session.id))).data.pending, null); await bad.close();
  }
  await f.store.close();
});

test('opaque continuations and complete tool batches survive closing and reattaching', async () => {
  let effects = 0;
  const continuation = { protocol: 'anthropic-messages', content: [{ type: 'thinking', thinking: 'opaque', signature: 'sig' }] };
  const f = fixture({ model: model({ ...request(), continuation }, answer(), answer()), agent: { tools: [tool(() => { effects++; return 'ok'; })] } });
  const first = await f.create(); await first.agent.prompt('lookup'); await first.agent.close();
  const next = await f.attach(first.session); await next.agent.prompt('continue');
  assert.deepEqual(f.model.inputs.at(-1).messages.find(m => m.toolCalls?.length).continuation, continuation); assert.equal(effects, 1);
  await f.close(); await f.store.close();
});

test('unknown write outcomes stay blocked even with empty context; saved receipts remain accessible', async () => {
  const f = fixture({ model: model(request()), agent: { tools: [tool(() => { throw new Error('private'); }, 'write')] }, manager: { selectContext: () => [] } });
  const { session, agent } = await f.create(), result = await agent.prompt('write', { requestId: 'r1' });
  assert.equal(result.status, 'failed'); assert.equal(session.state.persistence.status, 'saved');
  assert.equal((await session.getSnapshot()).data.turns[0].messages.at(-1).execution, 'outcome_unknown');
  await assert.rejects(agent.prompt('new'), { code: 'HISTORY_BLOCKED' });
  assert.deepEqual(await agent.prompt('write', { requestId: 'r1' }), result);
  await agent.close(); const next = await f.open(session.id);
  await assert.rejects(next.agent.prompt('new'), { code: 'HISTORY_BLOCKED' });
  await f.close(); await f.store.close();
});

test('metadata CAS, incompatible agentKey, tombstones and stale handles retain their semantics', async () => {
  const f = fixture(), { session, agent } = await f.create({ id: 'fixed' });
  await f.manager.updateSession(session.id, { title: 'new', metadata: { x: 1 } }, { expectedRevision: 0 });
  await assert.rejects(f.manager.updateSession(session.id, { title: 'stale' }, { expectedRevision: 0 }), { code: 'SESSION_CONFLICT' });
  const other = createSessionManager({ namespace: 'test', agentKey: 'v2', store: f.store });
  assert.ok(await other.getSession(session.id)); await assert.rejects(other.openSession(session.id), { code: 'AGENT_MISMATCH' });
  await f.manager.deleteSession(session.id, { expectedRevision: 1 });
  await assert.rejects(agent.prompt('no'), { code: 'SESSION_NOT_FOUND' });
  await assert.rejects(f.manager.createSession({ id: 'fixed' }), { code: 'SESSION_EXISTS' });
  await other.close(); await f.close(); await f.store.close();
});

test('archive admission threshold never discards an already completed turn or its receipt', async () => {
  const f = fixture({ model: model(answer('x'.repeat(3000))), manager: { limits: { maxArchiveBytes: 1000, maxTurns: 1 } } });
  const { session, agent } = await f.create(), result = await agent.prompt('go', { requestId: 'r' });
  assert.equal(session.state.persistence.status, 'saved'); assert.equal((await session.getSnapshot()).data.turns[0].run.text.length, 3000);
  await assert.rejects(agent.prompt('next'), { code: 'SESSION_CAPACITY' });
  assert.deepEqual(await agent.prompt('go', { requestId: 'r' }), result); await f.close(); await f.store.close();
});

test('one Session binds to one Agent; duplicate/reused plugins cannot steal the original binding', async () => {
  const f = fixture(), session = await f.manager.createSession(), plugin = createSessionPlugin({ session });
  const agent = await createAgent({ model: f.model, instructions: '', plugins: [plugin] });
  await assert.rejects(createAgent({ model: f.model, instructions: '', plugins: [plugin] }), { code: 'PLUGIN_SETUP_FAILED' });
  await assert.rejects(f.attach(session), { code: 'PLUGIN_START_FAILED' });
  assert.equal(session.state.binding, 'bound'); assert.equal((await agent.prompt('still valid')).status, 'completed');
  await assert.rejects(f.manager.close(), { code: 'SESSION_BOUND' });
  await agent.close(); const next = await f.attach(session); await next.agent.prompt('new binding');
  await f.close(); await f.store.close();
});

test('startup failure releases Session binding; manager and Session never own Agents', async () => {
  const f = fixture(), session = await f.manager.createSession();
  await assert.rejects(f.attach(session, { plugins: [{ id: 'broken', apiVersion: 1, setup() {}, async start() { throw Error('fail'); } }] }), { code: 'PLUGIN_START_FAILED' });
  assert.equal(session.state.binding, 'unbound'); const { agent } = await f.attach(session);
  await assert.rejects(session.close(), { code: 'SESSION_BOUND' }); await assert.rejects(f.manager.close(), { code: 'SESSION_BOUND' });
  assert.equal(agent.state.status, 'idle'); await agent.close(); await f.manager.close();
  assert.equal(agent.state.status, 'closed'); await f.store.close();
});
