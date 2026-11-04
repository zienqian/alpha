import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgent, createTool } from '@alpha/adk/core';
import { createSession, createMemorySessionStore, createSessionPlugin } from '@alpha/adk-session';
import { z } from 'zod';
import { createCodingAgent, createWorkspacePlugin, createProjectInstructionsPlugin } from '../dist/index.js';
import { answer, call, request, fakeModel, deferred, results, memoryWorkspace } from './helpers.js';

test('preset returns the ordinary core Agent, six flat strict schemas, instructions are projection only', async () => {
  const workspace = memoryWorkspace({ 'AGENTS.md': 'Use node:test.' }), model = fakeModel(answer());
  const agent = await createCodingAgent({ model, workspace });
  assert.equal(agent.state.status, 'idle'); assert.deepEqual(agent.state.messages, []);
  assert.equal((await agent.prompt('do work')).status, 'completed');
  const input = model.inputs[0]; assert.equal(input.tools.length, 6);
  for (const tool of input.tools) { assert.equal(tool.inputSchema.type, 'object'); assert.equal(tool.inputSchema.additionalProperties, false); assert.equal(tool.inputSchema.properties.parameters, undefined); }
  assert.match(input.messages[1].content, /Use node:test/);
  assert.equal(agent.state.messages.some(m => m.content?.includes('Use node:test.')), false);
  await agent.close(); assert.equal(workspace.effects.release, 1); await workspace.close();
});

test('read/edit/create loop preserves exact text, emits facts, and never overwrites on create', async () => {
  const workspace = memoryWorkspace({ 'a.txt': '\ufeffhello\r\nbye\r\n' }), events = [];
  const model = fakeModel(request(call('read_file', { path: 'a.txt' })), request(call('edit_file', { path: 'a.txt', oldText: 'hello', newText: 'world' })), request(call('create_file', { path: 'b.txt', content: 'new' })), request(call('create_file', { path: 'b.txt', content: 'overwrite' })), answer());
  const agent = await createCodingAgent({ model, workspace, onEvent: e => events.push(e) });
  assert.equal((await agent.prompt('edit')).status, 'completed');
  assert.equal(workspace.files.get('a.txt'), '\ufeffworld\r\nbye\r\n'); assert.equal(workspace.files.get('b.txt'), 'new');
  assert.equal(workspace.effects.writes, 2); assert.equal(events.length, 2);
  assert.equal(results(agent)[1].data.data.afterRevision, events[0].afterRevision);
  assert.equal(results(agent)[3].data.code, 'FILE_EXISTS'); await agent.close();
});

for (const [content, read, oldText, expected] of [['a', false, 'a', 'FILE_NOT_READ'], ['a a', true, 'a', 'TEXT_NOT_UNIQUE'], ['a', true, 'b', 'TEXT_NOT_FOUND']]) {
  test(`known preflight rejection ${expected} has no effects and leaves history usable`, async () => {
    const workspace = memoryWorkspace({ a: content });
    const steps = read ? [request(call('read_file', { path: 'a' }))] : [];
    const agent = await createCodingAgent({ workspace, model: fakeModel(...steps, request(call('edit_file', { path: 'a', oldText, newText: 'x' })), answer()) });
    assert.equal((await agent.prompt('edit')).status, 'completed'); assert.equal(results(agent).at(-1).data.code, expected);
    assert.equal(workspace.effects.writes, 0); assert.equal(agent.state.historyStatus, 'ready'); await agent.close();
  });
}

test('search is not an edit observation; empty oldText is schema-invalid', async () => {
  const workspace = memoryWorkspace({ a: 'hello' });
  const agent = await createCodingAgent({ workspace, model: fakeModel(request(call('search', { query: 'hello' })), request(call('edit_file', { path: 'a', oldText: 'hello', newText: 'hi' })), answer(), request(call('edit_file', { path: 'a', oldText: '', newText: 'hi' }))) });
  await agent.prompt('search then edit'); assert.equal(results(agent).at(-1).data.code, 'FILE_NOT_READ');
  assert.equal((await agent.prompt('invalid edit')).status, 'failed'); assert.equal(results(agent).at(-1).execution, 'not_executed');
  assert.equal(workspace.effects.writes, 0); await agent.close();
});

test('approval is frozen and bound to exact args/version; external change during approval rejects', async () => {
  const workspace = memoryWorkspace({ a: 'one' }); let approval;
  const agent = await createCodingAgent({ workspace, model: fakeModel(request(call('read_file', { path: 'a' })), request(call('edit_file', { path: 'a', oldText: 'one', newText: 'two' })), answer()),
    policy: { decide: action => action.kind === 'edit' ? 'ask' : 'allow' },
    approve(action) { approval = action; assert.equal(Object.isFrozen(action.preview), true); workspace.files.set('a', 'external'); return 'allow'; },
  });
  await agent.prompt('edit'); assert.match(approval.digest, /^[a-f0-9]{64}$/); assert.match(approval.preview.diff, /two/);
  assert.equal(results(agent).at(-1).data.code, 'FILE_CONFLICT'); assert.equal(workspace.effects.writes, 0); await agent.close();
});

test('commands default to ask; missing callback denies without starting', async () => {
  const workspace = memoryWorkspace(), agent = await createCodingAgent({ workspace, model: fakeModel(request(call('run_command', { command: 'test' })), answer()) });
  await agent.prompt('run'); assert.equal(results(agent)[0].execution, 'denied'); assert.equal(workspace.effects.commands, 0); await agent.close();
});

test('cancelled approval cannot execute when late allow arrives; close drains and releases', async () => {
  const workspace = memoryWorkspace(), gate = deferred(), entered = deferred();
  const agent = await createCodingAgent({ workspace, model: fakeModel(request(call('run_command', { command: 'test' }))), approve() { entered.resolve(); return gate.promise; } });
  const run = agent.prompt('run'); await entered.promise; agent.abort(); let closed = false;
  const closing = agent.close().then(() => { closed = true; }); await new Promise(r => setImmediate(r)); assert.equal(closed, false);
  gate.resolve('allow'); assert.equal((await run).status, 'cancelled'); await closing;
  assert.equal(workspace.effects.commands, 0); assert.equal(workspace.effects.release, 1);
});

test('approval exceptions fail closed', async () => {
  const workspace = memoryWorkspace(), agent = await createCodingAgent({ workspace, model: fakeModel(request(call('run_command', { command: 'test' }))), approve() { throw Error('bad UI'); } });
  assert.equal((await agent.prompt('run')).status, 'failed'); assert.equal(workspace.effects.commands, 0); assert.equal(results(agent)[0].execution, 'not_executed'); await agent.close();
});

test('custom plugin tool defaults deny, including an arbitrary path argument', async () => {
  let calls = 0;
  const custom = { id: 'custom', apiVersion: 1, setup(api) { api.addTool(createTool({ name: 'custom', description: 'custom', input: z.object({ path: z.string() }), execute() { calls++; return 'ok'; } })); } };
  const agent = await createCodingAgent({ workspace: memoryWorkspace(), model: fakeModel(request(call('custom', { path: '../outside' })), answer()), plugins: [custom] });
  await agent.prompt('custom'); assert.equal(calls, 0); assert.equal(results(agent)[0].execution, 'denied'); await agent.close();
});

test('known exit 1 is a normal tool result; observer throws do not rewrite effects', async () => {
  const workspace = memoryWorkspace();
  const agent = await createCodingAgent({ workspace, model: fakeModel(request(call('run_command', { command: 'fail' })), answer()), approve: () => 'allow', onEvent() { throw Error('UI'); } });
  assert.equal((await agent.prompt('run')).status, 'completed'); assert.equal(results(agent)[0].execution, 'succeeded');
  assert.equal(results(agent)[0].data.detail.exitCode, 1); assert.equal(agent.state.historyStatus, 'ready'); await agent.close();
});

for (const mode of ['write', 'command']) test(`unknown ${mode} is not retried, commits outcome_unknown and blocks future calls`, async () => {
  const workspace = memoryWorkspace(), acquire = workspace.acquire;
  workspace.acquire = async () => { const lease = await acquire(); lease[mode === 'write' ? 'writeFile' : 'runCommand'] = async () => ({ status: 'unknown', code: 'IO_LOST' }); return lease; };
  const invocation = mode === 'write' ? call('create_file', { path: 'a', content: 'x' }) : call('run_command', { command: 'test' });
  const agent = await createCodingAgent({ workspace, model: fakeModel(request(invocation)), approve: () => 'allow' });
  assert.equal((await agent.prompt('go')).status, 'failed'); assert.equal(results(agent)[0].execution, 'outcome_unknown'); assert.equal(agent.state.historyStatus, 'blocked');
  await assert.rejects(agent.prompt('retry'), { code: 'HISTORY_BLOCKED' }); await agent.close();
});

test('serialized output is bounded including JSON escapes and marks truncation', async () => {
  const workspace = memoryWorkspace({ a: '"\t\\😀'.repeat(60000) });
  const agent = await createCodingAgent({ workspace, model: fakeModel(request(call('read_file', { path: 'a' })), answer()), limits: { maxToolResultBytes: 4096 } });
  await agent.prompt('read'); assert.ok(Buffer.byteLength(results(agent)[0].content) <= 4096); assert.equal(results(agent)[0].data.data.truncated, true);
  const content = results(agent)[0].data.data.content; assert.equal(Buffer.from(content).toString('utf8'), content); await agent.close();
  await assert.rejects(createCodingAgent({ workspace, model: fakeModel(), limits: { maxToolResultBytes: 512 } }), { code: 'RESULT_BUDGET_TOO_SMALL' });
});

test('nonzero command output stays bounded; async observer rejections do not affect tool facts', async () => {
  const workspace = memoryWorkspace(), acquire = workspace.acquire;
  workspace.acquire = async () => { const lease = await acquire(); lease.runCommand = async (_input, opts) => {
    opts.onOutput('stdout', 'event'); return { status: 'exited', exitCode: 1, stdout: '\t😀'.repeat(20000), stderr: '"'.repeat(30000), truncated: false };
  }; return lease; };
  const agent = await createCodingAgent({ workspace, model: fakeModel(request(call('run_command', { command: 'test' })), answer()), approve: () => 'allow',
    limits: { maxToolResultBytes: 4096 }, async onEvent() { throw Error('async observer'); } });
  assert.equal((await agent.prompt('run')).status, 'completed'); await new Promise(resolve => setImmediate(resolve));
  const result = results(agent)[0]; assert.equal(result.data.detail.exitCode, 1); assert.equal(result.data.detail.truncated, true); assert.ok(Buffer.byteLength(result.content) <= 4096); await agent.close();
});

test('project instructions are cached per Agent; absent is empty, oversized startup releases the lease', async () => {
  const workspace = memoryWorkspace({ 'AGENTS.md': 'first' }), model = fakeModel(answer(), answer());
  const agent = await createCodingAgent({ workspace, model }); await agent.prompt('1'); workspace.files.set('AGENTS.md', 'second'); await agent.prompt('2');
  assert.match(model.inputs[1].messages[1].content, /first/); await agent.close();
  const nextModel = fakeModel(answer()), next = await createCodingAgent({ workspace, model: nextModel }); await next.prompt('3'); assert.match(nextModel.inputs[0].messages[1].content, /second/); await next.close();
  await assert.rejects(createCodingAgent({ workspace, model: fakeModel(), projectInstructions: { maxBytes: 1 } })); assert.equal(workspace.effects.acquire, workspace.effects.release);
});

test('same workspace plugin instance cannot be reused and failed creation does not release original lease', async () => {
  const workspace = memoryWorkspace(), plugin = createWorkspacePlugin({ workspace });
  const first = await createAgent({ instructions: '', model: fakeModel(answer()), plugins: [plugin] });
  await assert.rejects(createAgent({ instructions: '', model: fakeModel(), plugins: [plugin] })); assert.equal(workspace.effects.release, 0);
  await first.prompt('valid'); await first.close(); assert.equal(workspace.effects.release, 1);
});

test('explicit assembly has same tool behavior; project plugin does not require hidden workspace registration', async () => {
  const workspace = memoryWorkspace({ 'AGENTS.md': 'project' }), model = fakeModel(answer());
  const agent = await createAgent({ model, instructions: '', plugins: [createProjectInstructionsPlugin({ workspace })] });
  await agent.prompt('hi'); assert.match(model.inputs[0].messages[1].content, /project/); assert.equal(workspace.effects.acquire, 0); await agent.close();
});

test('Session plugin saves a coding run; replay after reattach performs no model, write or command', async () => {
  const workspace = memoryWorkspace(), store = createMemorySessionStore();
  const session = await createSession({ store, namespace: 'test', agentKey: workspace.id });
  const first = await createCodingAgent({ workspace, model: fakeModel(request(call('create_file', { path: 'a', content: 'once' })), request(call('run_command', { command: 'test' })), answer()), approve: () => 'allow', plugins: [createSessionPlugin({ session })] });
  const result = await first.prompt('task', { requestId: 'same' }); assert.equal(session.state.persistence.status, 'saved'); await first.close();
  const model = fakeModel(), next = await createCodingAgent({ workspace, model, plugins: [createSessionPlugin({ session })] });
  assert.deepEqual(await next.prompt('task', { requestId: 'same' }), result); assert.equal(model.inputs.length, 0);
  assert.equal(workspace.effects.writes, 1); assert.equal(workspace.effects.commands, 1);
  await next.close(); await session.close(); await store.close();
});

test('Session save failure and later flush never repeat completed file or command effects', async () => {
  const workspace = memoryWorkspace(), memory = createMemorySessionStore(); let unavailable = true;
  const store = { ...memory, async compareAndSet(key, revision, data) {
    if (unavailable && data?.turns.length) throw Error('store offline');
    return memory.compareAndSet(key, revision, data);
  } };
  const session = await createSession({ store, namespace: 'test', agentKey: workspace.id });
  const model = fakeModel(request(call('create_file', { path: 'a', content: 'once' })), request(call('run_command', { command: 'test' })), answer());
  const agent = await createCodingAgent({ workspace, model, approve: () => 'allow', plugins: [createSessionPlugin({ session })] });
  assert.equal((await agent.prompt('task', { requestId: 'same' })).status, 'completed');
  assert.equal(session.state.persistence.status, 'pending'); assert.equal(workspace.effects.writes, 1); assert.equal(workspace.effects.commands, 1);
  unavailable = false; await session.flush(); assert.equal(session.state.persistence.status, 'saved');
  assert.equal(workspace.effects.writes, 1); assert.equal(workspace.effects.commands, 1); assert.equal(model.inputs.length, 3);
  await agent.close(); await session.close(); await memory.close();
});
