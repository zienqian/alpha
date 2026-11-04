import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { createAgent, createTool } from '@alpha/adk/core';
import { answer, call, request, fakeModel, tool, deferred, options, turn } from './helpers.js';

test('core runs without plugins, projects full history, and preserves provider receiver', async () => {
  const model = fakeModel([{ type: 'text-delta', text: 'preview' }, { type: 'finish', result: answer('final') }], answer('second'));
  const agent = await createAgent(options(model)), events = [];
  agent.subscribe(e => events.push(e));
  const empty = agent.state.messages;
  assert.equal((await agent.prompt('first')).text, 'final');
  assert.equal(empty.length, 0);
  assert.equal(agent.state.messages[1].text, 'final');
  assert.ok(Object.isFrozen(agent.state.messages[1]));
  assert.deepEqual(model.inputs[0].messages, [{ role: 'system', content: 'Use verified facts.' }, { role: 'user', content: 'first' }]);
  assert.equal((await agent.prompt('again')).status, 'completed');
  assert.equal(model.inputs[1].messages.length, 4);
  assert.equal(model.inputs[1].previousResponseId, undefined);
  assert.deepEqual(events.filter(e => e.runId === events[0].runId).map(e => e.seq), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(events.filter(e => e.type === 'run.end').length, 2);
  assert.ok(events.filter(e => e.type === 'message.commit').every(e => !('content' in e) && !('text' in e)));
  await agent.close();
  assert.equal(agent.state.status, 'closed');
});

test('one schema validates once and binds the identical frozen arguments to authorization and execution', async () => {
  let validations = 0, conversions = 0, executed, authorized;
  const input = { '~standard': {
    version: 1, vendor: 'fixture',
    jsonSchema: { input() { conversions++; return { type: 'object' }; }, output() { throw new Error('Must use input schema'); } },
    async validate(raw) { validations++; return { value: { id: raw.id.trim(), nested: { ok: true } } }; },
  } };
  const lookup = createTool({ name: 'lookup', description: '', input, effect: 'read', execute(args) { executed = args; return args.id; } });
  const model = fakeModel(request(call('c1', 'lookup', { id: ' A ' })), answer());
  const agent = await createAgent({ ...options(model), tools: [lookup], hooks: { authorizeTool: [(c) => {
    authorized = c.arguments;
    assert.ok(Object.isFrozen(c.arguments.nested));
    assert.throws(() => { c.arguments.id = 'tampered'; }, TypeError);
    return { action: 'allow' };
  }] } });
  assert.equal((await agent.prompt('lookup')).status, 'completed');
  assert.equal(validations, 1); assert.equal(conversions, 1);
  assert.equal(authorized, executed);
  assert.equal(executed.id, 'A');
  assert.equal(model.inputs[1].messages.at(-1).content, 'A');
  await agent.close();
});

test('tool-call hints do not execute; tools are awaited in order and IDs can repeat across responses/runs', async () => {
  const trace = [];
  const model = fakeModel(
    [{ type: 'tool-call', toolCall: call() }, { type: 'finish', result: request(call(), call('c2')) }],
    request(call()), answer(), request(call()), answer(),
  );
  const agent = await createAgent({ ...options(model), tools: [tool(async () => { trace.push('start'); await turn(); trace.push('end'); return 'ok'; })] });
  assert.equal((await agent.prompt('first')).status, 'completed');
  assert.equal((await agent.prompt('second')).status, 'completed');
  assert.deepEqual(trace, ['start', 'end', 'start', 'end', 'start', 'end', 'start', 'end']);
  const results = agent.state.messages.filter(m => m.role === 'toolResult');
  assert.equal(results.length, 4);
  assert.equal(new Set(results.map(r => r.id)).size, 4);
  assert.equal(new Set(results.map(r => r.assistantId)).size, 3);
  await agent.close();
});

test('deny short-circuits authorization and returns fixed text without consuming execution budget', async () => {
  let executions = 0, later = 0, authorizations = 0;
  const model = fakeModel(request(call()), request(call()), answer());
  const agent = await createAgent({ ...options(model), tools: [tool(() => { executions++; return ''; })],
    limits: { maxToolCalls: 1 },
    hooks: { authorizeTool: [() => ++authorizations === 1 ? { action: 'deny', reason: 'secret policy details' } : { action: 'allow' }, () => { later++; return { action: 'allow' }; }] } });
  assert.equal((await agent.prompt('go')).status, 'completed');
  assert.equal(executions, 1); assert.equal(later, 1);
  assert.equal(agent.state.messages[2].execution, 'denied');
  assert.equal(agent.state.messages[4].execution, 'succeeded');
  assert.ok(!model.inputs[1].messages.at(-1).content.includes('secret'));
  await agent.close();
});

test('unknown tools and invalid inputs fail without effects, and finalize the whole batch', async t => {
  for (const first of [call('c1', 'missing'), call('c1', 'lookup', { id: 12 })]) {
    await t.test(first.name + JSON.stringify(first.arguments), async () => {
      let executions = 0;
      const agent = await createAgent({ ...options(fakeModel(request(first, call('c2')))), tools: [tool(() => { executions++; return ''; })] });
      const result = await agent.prompt('go');
      assert.equal(result.status, 'failed');
      assert.equal(result.error.code, first.name === 'missing' ? 'TOOL_NOT_FOUND' : 'TOOL_INPUT_INVALID');
      assert.equal(executions, 0);
      assert.deepEqual(agent.state.messages.filter(m => m.role === 'toolResult').map(m => m.execution), ['not_executed', 'not_executed']);
      assert.equal(agent.state.historyStatus, 'ready');
      await agent.close();
    });
  }
});

test('failed read/write tools preserve distinct execution facts; confirmed history can unblock', async t => {
  for (const effect of ['read', 'write', 'unknown']) {
    await t.test(effect, async () => {
      const agent = await createAgent({ ...options(fakeModel(request(call()), answer())), tools: [tool(() => { throw new Error('secret token'); }, effect)] });
      const result = await agent.prompt('go');
      assert.equal(result.status, 'failed');
      const expected = effect === 'read' ? 'failed' : 'outcome_unknown';
      assert.equal(agent.state.messages.at(-1).execution, expected);
      assert.ok(!JSON.stringify(result).includes('secret'));
      if (effect !== 'read') {
        await assert.rejects(agent.prompt('again'), { code: 'HISTORY_BLOCKED' });
        assert.throws(() => agent.replaceMessages(agent.state.messages), { code: 'INPUT_INVALID' });
        agent.replaceMessages(agent.state.messages.map(m => m.role === 'toolResult' ? { ...m, execution: 'succeeded', content: 'External outcome verified.' } : m));
        assert.equal(agent.state.historyStatus, 'ready');
        assert.equal((await agent.prompt('again')).status, 'completed');
      } else assert.equal(agent.state.historyStatus, 'ready');
      await agent.close();
    });
  }
});

test('post-execution failures retain success without rerunning a tool', async t => {
  for (const scenario of ['invalid', 'too-large', 'hook']) {
    await t.test(scenario, async () => {
      let executions = 0;
      const agent = await createAgent({
        ...options(fakeModel(request(call()))),
        tools: [tool(() => { executions++; return scenario === 'invalid' ? 42 : 'some output'; }, 'write')],
        limits: scenario === 'too-large' ? { maxToolResultBytes: 1 } : {},
        hooks: scenario === 'hook' ? { mapToolResult: [() => { throw new Error('secret result'); }] } : {},
      });
      const result = await agent.prompt('go');
      assert.equal(result.status, 'failed'); assert.equal(executions, 1);
      assert.equal(agent.state.messages.at(-1).execution, 'succeeded');
      assert.equal(agent.state.historyStatus, 'ready');
      assert.equal(agent.state.messages.at(-1).content, '[Tool result unavailable.]');
      await agent.close();
    });
  }
});

test('rejects unsupported or lossy schema output, validates config, and keeps business schema external', async () => {
  assert.throws(() => createTool({ name: 'bad', description: '', input: z.string(), execute: () => '' }), { code: 'TOOL_SCHEMA_INVALID' });
  const lookup = createTool({ name: 'lookup', description: '', input: z.strictObject({ id: z.string() }).transform(v => ({ ...v, date: new Date() })), execute: () => { throw new Error('unreachable'); } });
  const agent = await createAgent({ ...options(fakeModel(request(call()))), tools: [lookup] });
  assert.equal((await agent.prompt('go')).error.code, 'TOOL_INPUT_INVALID');
  await agent.close();
  await assert.rejects(createAgent({ ...options(fakeModel()), loop: {} }), { code: 'CONFIG_INVALID' });
  await assert.rejects(createAgent({ ...options(fakeModel()), limits: { maxModelCalls: -1 } }), { code: 'CONFIG_INVALID' });
  await assert.rejects(createAgent({ ...options(fakeModel()), tools: [tool(), tool()] }), { code: 'DUPLICATE_TOOL' });
});

test('plain callbacks and app context remain referenced while configuration is snapshotted', async () => {
  const app = { id: 'initial' }, list = [tool((_input, ctx) => ctx.app.id)];
  const hooks = { beforeModel: [m => m] };
  const model = fakeModel(request(call()), answer());
  const agent = await createAgent({ ...options(model), appContext: app, tools: list, hooks });
  list.length = 0; hooks.beforeModel.length = 0; app.id = 'updated';
  assert.equal((await agent.prompt('go')).status, 'completed');
  assert.equal(agent.state.messages[2].content, 'updated');
  await agent.close();
});

test('agents sharing a model keep histories, signals and budgets independent', async () => {
  const entered = deferred(), release = deferred();
  const model = fakeModel(async () => { entered.resolve(); await release.promise; return answer('A'); }, answer('B'));
  const a = await createAgent({ ...options(model), limits: { maxModelCalls: 1 } });
  const b = await createAgent({ ...options(model), limits: { maxModelCalls: 1 } });
  const pending = a.prompt('first'); await entered.promise;
  assert.equal((await b.prompt('second')).text, 'B');
  assert.equal(a.state.status, 'running'); assert.equal(b.state.status, 'idle');
  assert.notEqual(model.inputs[0].signal, model.inputs[1].signal);
  release.resolve(); assert.equal((await pending).text, 'A');
  assert.deepEqual(a.state.messages.map(m => m.role === 'user' ? m.content : m.text), ['first', 'A']);
  await a.close(); await b.close();
});

test('configuration getters cannot leak raw errors and unknown limit keys are rejected', async () => {
  await assert.rejects(createAgent({ get instructions() { throw new Error('secret'); } }), e => e.code === 'CONFIG_INVALID' && !e.message.includes('secret'));
  await assert.rejects(createAgent({ ...options(fakeModel()), limits: { toString: 1 } }), { code: 'CONFIG_INVALID' });
});
