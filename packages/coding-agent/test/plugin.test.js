import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createTool } from '@alpha/adk/core';
import { createSession, createMemorySessionStore, createSessionPlugin } from '@alpha/adk-session';
import { z } from 'zod';
import { createCodingAgent, codingTools, readFileTool, editFileTool, runCommandTool } from '../dist/index';
import { answer, call, request, fakeModel, deferred, results, fixture, scriptCommand } from './helpers';
import { createCodingContext } from '../dist/context';

test('command descriptions are optional bounded metadata and leave command text intact', async () => {
  const signal = new AbortController().signal, command = 'echo first\necho second';
  const legacy = await runCommandTool.prepare({ command }, signal);
  assert.deepEqual(legacy.arguments, { command });
  const described = await runCommandTool.prepare({ command, description: '  验证命令输出  ' }, signal);
  assert.equal(described.arguments.description, '验证命令输出');
  assert.equal(described.arguments.command, command);
  assert.match(runCommandTool.info.inputSchema.properties.description.description, /purpose/);
  await runCommandTool.prepare({ command, description: 'x'.repeat(160) }, signal);
  for (const description of ['', '   ', 'x'.repeat(161), 123]) {
    await assert.rejects(runCommandTool.prepare({ command, description }, signal), { code: 'TOOL_INPUT_INVALID' });
  }
});

test('read tool runs without a permission plan; write tool requires an approved call', async () => {
  await using f = await fixture({ a: 'independent' });
  const signal = new AbortController().signal, app = createCodingContext({ cwd: f.cwd, shell: false });
  const ctx = { agentId: 'agent', runId: 'run', assistantId: 'assistant', callId: 'call', signal, app };
  const read = await readFileTool.prepare({ path: 'a' }, signal);
  assert.equal(JSON.parse(await read.execute(ctx)).data.content, 'independent');
  assert.equal(app.state.plans.size, 0);
  const edit = await editFileTool.prepare({ path: 'a', oldText: 'independent', newText: 'bad' }, signal);
  await assert.rejects(edit.execute(ctx), { code: 'PLAN_MISSING' }); assert.equal(await f.read('a'), 'independent');
});

test('ordinary Agent exposes strict tools and projects cwd, actual shell and cached instructions', async () => {
  await using f = await fixture({ 'AGENTS.md': 'Use bun:test.' }); const model = fakeModel(answer(), answer());
  const agent = await createCodingAgent({ model, cwd: f.cwd });
  assert.deepEqual(agent.state.messages, []);
  await agent.prompt('one'); await f.write('AGENTS.md', 'changed'); await agent.prompt('two');
  const input = model.inputs[0]; assert.equal(input.tools.length, 7);
  for (const tool of input.tools) { assert.equal(tool.inputSchema.type, 'object'); assert.equal(tool.inputSchema.additionalProperties, false); }
  assert.ok(input.messages[0].content.includes(f.cwd)); assert.match(input.messages[0].content, /Shell: (powershell|posix|cmd) \(/);
  assert.match(model.inputs[1].messages[1].content, /Use bun:test/);
  assert.equal(agent.state.messages.some(m => m.content?.includes('Use bun:test.')), false); await agent.close();
  const nextModel = fakeModel(answer()), next = await createCodingAgent({ model: nextModel, cwd: f.cwd });
  await next.prompt('next'); assert.match(nextModel.inputs[0].messages[1].content, /changed/); await next.close();
  await assert.rejects(createCodingAgent({ model: fakeModel(), cwd: f.cwd, projectInstructions: { maxBytes: 1 } }));
});

test('read/edit/create preserves exact text and emits facts, create never overwrites', async () => {
  await using f = await fixture({ a: '\ufeffhello\r\nbye\r\n' }); const events = [];
  const model = fakeModel(request(call('read_file', { path: 'a' })), request(call('edit_file', { path: 'a', oldText: 'hello', newText: 'world' })), request(call('create_file', { path: 'b', content: 'new' })), request(call('create_file', { path: 'b', content: 'overwrite' })), answer());
  const agent = await createCodingAgent({ model, cwd: f.cwd, onEvent: e => events.push(e) });
  assert.equal((await agent.prompt('edit')).status, 'completed');
  assert.equal(await f.read('a'), '\ufeffworld\r\nbye\r\n'); assert.equal(await f.read('b'), 'new');
  assert.equal(events.length, 2); assert.equal(results(agent)[1].data.data.afterRevision, events[0].afterRevision);
  assert.equal(results(agent)[3].data.code, 'FILE_EXISTS'); await agent.close();
});

for (const [content, read, oldText, expected] of [['a', false, 'a', 'FILE_NOT_READ'], ['a a', true, 'a', 'TEXT_NOT_UNIQUE'], ['a', true, 'b', 'TEXT_NOT_FOUND']]) test(`preflight rejection ${expected} leaves files and history usable`, async () => {
  await using f = await fixture({ a: content }); const steps = read ? [request(call('read_file', { path: 'a' }))] : [];
  const agent = await createCodingAgent({ cwd: f.cwd, model: fakeModel(...steps, request(call('edit_file', { path: 'a', oldText, newText: 'x' })), answer()) });
  assert.equal((await agent.prompt('edit')).status, 'completed'); assert.equal(results(agent).at(-1).data.code, expected);
  assert.equal(await f.read('a'), content); assert.equal(agent.state.historyStatus, 'ready'); await agent.close();
});

test('search is not an edit observation; invalid schema is not executed', async () => {
  await using f = await fixture({ a: 'hello' });
  const agent = await createCodingAgent({ cwd: f.cwd, model: fakeModel(request(call('search', { query: 'hello' })), request(call('edit_file', { path: 'a', oldText: 'hello', newText: 'hi' })), answer(), request(call('edit_file', { path: 'a', oldText: '', newText: 'hi' }))) });
  await agent.prompt('search/edit'); assert.equal(results(agent).at(-1).data.code, 'FILE_NOT_READ');
  assert.equal((await agent.prompt('invalid')).status, 'failed'); assert.equal(results(agent).at(-1).execution, 'not_executed');
  assert.equal(await f.read('a'), 'hello'); await agent.close();
});

test('approval binds immutable arguments, cwd and file version; external edit rejects', async () => {
  await using f = await fixture({ a: 'one' }); let approval, context;
  const agent = await createCodingAgent({ cwd: f.cwd, model: fakeModel(request(call('read_file', { path: 'a' })), request(call('edit_file', { path: 'a', oldText: 'one', newText: 'two' })), answer()),
    hooks: { beforeModel: [(messages, ctx) => { context = ctx.app; return messages; }] },
    policy: { decide: action => action.kind === 'edit' ? 'ask' : 'allow' },
    async approve(action) { approval = action; assert.equal(Object.isFrozen(action.preview), true); await f.write('a', 'external'); return 'allow'; },
  });
  await agent.prompt('edit'); assert.match(approval.digest, /^[a-f0-9]{64}$/); assert.match(approval.preview.diff, /two/);
  assert.equal(approval.cwd, f.cwd); assert.equal(results(agent).at(-1).data.code, 'FILE_CONFLICT'); assert.equal(await f.read('a'), 'external');
  assert.equal(context.state.plans.size, 0); await agent.close();
});

for (const mode of ['missing', 'deny', 'throw']) test(`command approval ${mode} never starts or retains plans`, async () => {
  await using f = await fixture({ 'effect.cjs': "require('node:fs').writeFileSync('effect', 'bad')" }); let context;
  const agent = await createCodingAgent({ cwd: f.cwd, model: fakeModel(request(call('run_command', { command: scriptCommand('effect.cjs') })), answer()),
    hooks: { beforeModel: [(messages, ctx) => { context = ctx.app; return messages; }] },
    ...(mode === 'missing' ? {} : { approve: () => { if (mode === 'throw') throw Error('UI'); return 'deny'; } }),
  });
  await agent.prompt('run'); await assert.rejects(f.read('effect'), { code: 'ENOENT' });
  assert.equal(results(agent)[0].execution, mode === 'throw' ? 'not_executed' : 'denied'); assert.equal(context.state.plans.size, 0); await agent.close();
});

test('late approval after cancellation cannot run; close drains approval', async () => {
  await using f = await fixture(); const gate = deferred(), entered = deferred(); let context;
  const agent = await createCodingAgent({ cwd: f.cwd, model: fakeModel(request(call('create_file', { path: 'a', content: 'bad' }))),
    hooks: { beforeModel: [(messages, ctx) => { context = ctx.app; return messages; }] },
    policy: { decide: () => 'ask' }, approve() { entered.resolve(); return gate.promise; } });
  const run = agent.prompt('run'); await entered.promise; agent.abort(); let closed = false;
  const closing = agent.close().then(() => { closed = true; }); await new Promise(r => setImmediate(r)); assert.equal(closed, false);
  gate.resolve('allow'); assert.equal((await run).status, 'cancelled'); await closing;
  await assert.rejects(f.read('a'), { code: 'ENOENT' }); assert.equal(context.state.plans.size, 0);
});

test('custom tool defaults deny; caller data is ctx.app.data', async () => {
  await using f = await fixture(); let calls = 0;
  const custom = createTool({ name: 'tenant', description: 'tenant', input: z.object({ path: z.string() }), execute(_args, ctx) { calls++; return ctx.app.data.tenant; } });
  const agent = await createCodingAgent({ cwd: f.cwd, appContext: { tenant: 'alpha' }, tools: [custom],
    model: fakeModel(request(call('tenant', { path: '../outside' })), answer()), hooks: { beforeModel: [(messages, ctx) => { assert.equal(ctx.app.data.tenant, 'alpha'); return messages; }] } });
  await agent.prompt('custom'); assert.equal(calls, 0); assert.equal(results(agent)[0].execution, 'denied'); await agent.close();
});

test('nonzero output is bounded; async observers cannot rewrite command facts', async () => {
  await using f = await fixture({ 'exit.cjs': "console.log('\\t😀'.repeat(20000)); console.error('\"'.repeat(30000)); process.exit(7)" });
  const agent = await createCodingAgent({ cwd: f.cwd, model: fakeModel(request(call('run_command', { command: scriptCommand('exit.cjs') })), answer()), approve: () => 'allow', limits: { maxToolResultBytes: 4096 }, async onEvent() { throw Error('UI'); } });
  assert.equal((await agent.prompt('run')).status, 'completed'); const r = results(agent)[0];
  assert.equal(r.execution, 'succeeded'); assert.equal(r.data.code, 'COMMAND_EXIT_NONZERO'); assert.ok(r.data.detail.exitCode > 0);
  assert.equal(r.data.detail.truncated, true); assert.ok(Buffer.byteLength(r.content) <= 4096); assert.equal(agent.state.historyStatus, 'ready'); await agent.close();
});

test('started timeout is outcome_unknown and blocks replay', async () => {
  await using f = await fixture({ 'slow.cjs': 'setInterval(() => {}, 1000)' });
  const agent = await createCodingAgent({ cwd: f.cwd, model: fakeModel(request(call('run_command', { command: scriptCommand('slow.cjs'), timeoutMs: 800 }))), approve: () => 'allow' });
  assert.equal((await agent.prompt('run')).status, 'failed'); assert.equal(results(agent)[0].execution, 'outcome_unknown'); assert.equal(agent.state.historyStatus, 'blocked');
  await assert.rejects(agent.prompt('retry'), { code: 'HISTORY_BLOCKED' }); await agent.close();
});

test('read result JSON bounds escaping and UTF-8', async () => {
  await using f = await fixture({ a: '"\t\\😀'.repeat(60000) });
  const agent = await createCodingAgent({ cwd: f.cwd, model: fakeModel(request(call('read_file', { path: 'a' })), answer()), limits: { maxToolResultBytes: 4096 } });
  await agent.prompt('read'); const r = results(agent)[0]; assert.ok(Buffer.byteLength(r.content) <= 4096); assert.equal(r.data.data.truncated, true);
  assert.equal(Buffer.from(r.data.data.content).toString('utf8'), r.data.data.content); await agent.close();
  await assert.rejects(createCodingAgent({ cwd: f.cwd, model: fakeModel(), limits: { maxToolResultBytes: 512 } }), { code: 'RESULT_BUDGET_TOO_SMALL' });
});

test('shared static tools isolate cwd, approvals and read observations', async () => {
  await using left = await fixture({ a: 'left' }); await using right = await fixture({ a: 'right' });
  const tools = [readFileTool, editFileTool], entered = deferred(), gate = deferred();
  const first = await createCodingAgent({ cwd: left.cwd, tools, model: fakeModel(request(call('read_file', { path: 'a' })), request(call('edit_file', { path: 'a', oldText: 'left', newText: 'changed' })), answer()),
    policy: { decide: action => action.kind === 'edit' ? 'ask' : 'allow' }, approve() { entered.resolve(); return gate.promise; } });
  const second = await createCodingAgent({ cwd: right.cwd, tools, model: fakeModel(request(call('edit_file', { path: 'a', oldText: 'right', newText: 'wrong' })), request(call('read_file', { path: 'a' })), request(call('edit_file', { path: 'a', oldText: 'right', newText: 'second' })), answer()) });
  try {
    const running = first.prompt('edit'); await entered.promise; await second.prompt('edit');
    assert.equal(results(second)[0].data.code, 'FILE_NOT_READ'); assert.equal(await right.read('a'), 'second'); assert.equal(await left.read('a'), 'left');
    gate.resolve('allow'); await running; assert.equal(await left.read('a'), 'changed');
  } finally { gate.resolve('deny'); await first.close(); await second.close(); }
});

test('same cwd allows multiple agents; subsets and fresh observations', async () => {
  await using f = await fixture({ a: 'before' }); const model = fakeModel(request(call('read_file', { path: 'a' })), answer());
  const first = await createCodingAgent({ cwd: f.cwd, tools: [readFileTool], model });
  const second = await createCodingAgent({ cwd: f.cwd, tools: [editFileTool], model: fakeModel(request(call('edit_file', { path: 'a', oldText: 'before', newText: 'after' })), answer()) });
  await first.prompt('read'); assert.deepEqual(model.inputs[0].tools.map(t => t.name), ['read_file']);
  await second.prompt('edit'); assert.equal(results(second)[0].data.code, 'FILE_NOT_READ'); assert.equal(await f.read('a'), 'before');
  await first.close(); await second.close();
  const emptyModel = fakeModel(answer()), empty = await createCodingAgent({ cwd: f.cwd, tools: [], model: emptyModel });
  await empty.prompt('hi'); assert.deepEqual(emptyModel.inputs[0].tools, []); await empty.close(); assert.equal(codingTools.length, 6);
});

test('disabled shell leaves file tools and chat usable', async () => {
  await using f = await fixture({ a: 'text' }); const model = fakeModel(request(call('read_file', { path: 'a' })), request(call('run_command', { command: 'echo hello' })), answer());
  const agent = await createCodingAgent({ cwd: f.cwd, shell: false, model }); await agent.prompt('read');
  assert.equal(results(agent)[0].data.data.content, 'text'); assert.equal(results(agent)[1].data.code, 'SHELL_UNAVAILABLE');
  assert.match(model.inputs[0].messages[0].content, /Shell: unavailable/); await agent.close();
  await assert.rejects(createCodingAgent({ cwd: f.cwd, shell: 'alpha-missing-shell', model: fakeModel() }), { code: 'INVALID_SHELL' });
});

for (const failSave of [false, true]) test(`Session reattach/flush never repeats effects (save failure ${failSave})`, async () => {
  await using f = await fixture({ 'effect.cjs': "require('node:fs').appendFileSync('count', '1')" });
  const memory = createMemorySessionStore(); let unavailable = failSave;
  const store = { ...memory, async compareAndSet(key, revision, data) { if (unavailable && data?.turns.length) throw Error('offline'); return memory.compareAndSet(key, revision, data); } };
  const session = await createSession({ store, namespace: 'test', agentKey: f.cwd });
  const model = fakeModel(request(call('create_file', { path: 'a', content: 'once' })), request(call('run_command', { command: scriptCommand('effect.cjs') })), answer());
  const agent = await createCodingAgent({ cwd: f.cwd, model, approve: () => 'allow', plugins: [createSessionPlugin({ session })] });
  const result = await agent.prompt('task', { requestId: 'same' }); assert.equal(result.status, 'completed');
  assert.equal(session.state.persistence.status, failSave ? 'pending' : 'saved'); unavailable = false; await session.flush(); await agent.close();
  const replayModel = fakeModel(), next = await createCodingAgent({ cwd: f.cwd, model: replayModel, plugins: [createSessionPlugin({ session })] });
  assert.deepEqual(await next.prompt('task', { requestId: 'same' }), result); assert.equal(replayModel.inputs.length, 0);
  assert.equal(await f.read('a'), 'once'); assert.equal(await f.read('count'), '1'); assert.equal(model.inputs.length, 3);
  await next.close(); await session.close(); await memory.close();
});
