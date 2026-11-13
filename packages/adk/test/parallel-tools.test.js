import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { createAgent } from '@alpha/adk/core';
import { answer, call, request, fakeModel, tool, deferred, options, turn } from './helpers';

const results = agent => agent.state.messages.filter(message => message.role === 'toolResult');
const namedTool = (name, effect, execute) => {
  const source = tool(execute, effect);
  return { ...source, info: { ...source.info, name } };
};

test('read tools refill free slots without waiting for the slowest read and preserve result pairing', async () => {
  const gates = [deferred(), deferred(), deferred()], entered = gates.map(() => deferred());
  const started = [], events = [];
  const model = fakeModel(request(...gates.map((_, i) => call(`c${i}`, 'lookup', { id: String(i) }))), input => {
    assert.deepEqual(input.messages.filter(message => message.role === 'tool').map(message => [message.toolCallId, message.content]),
      [['c1', 'result-1'], ['c2', 'result-2'], ['c0', 'result-0']]);
    return answer();
  });
  const agent = await createAgent({ ...options(model), limits: { maxConcurrentTools: 2 }, tools: [tool(async ({ id }) => {
    started.push(id); entered[Number(id)].resolve(); await gates[Number(id)].promise; return `result-${id}`;
  })] });
  agent.subscribe(event => events.push(event));
  const work = agent.prompt('read');
  await entered[1].promise;
  assert.deepEqual(started, ['0', '1']);
  gates[1].resolve(); await entered[2].promise;
  assert.deepEqual(started, ['0', '1', '2']);
  assert.equal(model.inputs.length, 1);
  gates[2].resolve(); await turn(); gates[0].resolve();
  assert.equal((await work).status, 'completed');
  assert.deepEqual(results(agent).map(result => result.callId), ['c1', 'c2', 'c0']);
  assert.deepEqual(events.map(event => event.seq), events.map((_, i) => i + 1));
  assert.equal(events.filter(event => event.type === 'tool.end').length, 3);
  const snapshot = agent.state.messages;
  agent.replaceMessages(snapshot); // Out-of-order results remain portable history.
  await agent.close();
});

test('the default read concurrency is four', async () => {
  const entered = deferred(), release = deferred(), started = [];
  const agent = await createAgent({ ...options(fakeModel(request(...Array.from({ length: 5 }, (_, i) => call(String(i)))), answer())),
    tools: [tool(async (_args, ctx) => { started.push(ctx.callId); if (started.length === 4) entered.resolve(); await release.promise; return ''; })],
  });
  const work = agent.prompt('read'); await entered.promise; await turn();
  assert.equal(started.length, 4);
  release.resolve(); assert.equal((await work).status, 'completed');
  assert.equal(started.length, 5); await agent.close();
});

test('write and unknown tools are barriers including result processing on both sides', async () => {
  const readEntered = deferred(), readRelease = deferred(), hookEntered = deferred(), hookRelease = deferred();
  const writeEntered = deferred(), writeRelease = deferred(), unknownEntered = deferred(), unknownRelease = deferred();
  const started = [];
  const agent = await createAgent({ ...options(fakeModel(request(
    call('r1'), call('r2'), call('w', 'write'), call('r3'), call('u', 'unknown'), call('r4'),
  ), answer())), tools: [
    tool(async (_args, ctx) => { started.push(ctx.callId); if (ctx.callId === 'r2') readEntered.resolve(); if (['r1', 'r2'].includes(ctx.callId)) await readRelease.promise; return ''; }),
    namedTool('write', 'write', async () => { started.push('w'); writeEntered.resolve(); await writeRelease.promise; return ''; }),
    namedTool('unknown', 'unknown', async () => { started.push('u'); unknownEntered.resolve(); await unknownRelease.promise; return ''; }),
  ], hooks: { mapToolResult: [async result => {
    if (result.callId === 'r1') { hookEntered.resolve(); await hookRelease.promise; }
    return result.content;
  }] } });
  const work = agent.prompt('mixed'); await readEntered.promise;
  assert.deepEqual(started, ['r1', 'r2']);
  readRelease.resolve(); await hookEntered.promise; await turn();
  assert.deepEqual(started, ['r1', 'r2']);
  hookRelease.resolve(); await writeEntered.promise; await turn();
  assert.deepEqual(started, ['r1', 'r2', 'w']);
  writeRelease.resolve(); await unknownEntered.promise; await turn();
  assert.deepEqual(started, ['r1', 'r2', 'w', 'r3', 'u']);
  unknownRelease.resolve(); assert.equal((await work).status, 'completed');
  assert.deepEqual(started, ['r1', 'r2', 'w', 'r3', 'u', 'r4']);
  await agent.close();
});

test('read approvals remain ordered and never overlap while approved execution can overlap', async () => {
  const approvals = [deferred(), deferred()], approving = approvals.map(() => deferred()), executing = approvals.map(() => deferred());
  const release = deferred(), started = [];
  let activeApprovals = 0;
  const agent = await createAgent({ ...options(fakeModel(request(call('0'), call('1')), answer())),
    tools: [tool(async (_args, ctx) => { started.push(ctx.callId); executing[Number(ctx.callId)].resolve(); await release.promise; return ''; })],
    hooks: { authorizeTool: [async call => {
      assert.equal(++activeApprovals, 1); approving[Number(call.callId)].resolve();
      await approvals[Number(call.callId)].promise; activeApprovals--; return { action: 'allow' };
    }] },
  });
  const work = agent.prompt('approve reads'); await approving[0].promise; await turn();
  assert.deepEqual(started, []);
  approvals[0].resolve(); await executing[0].promise; await approving[1].promise;
  assert.deepEqual(started, ['0']);
  approvals[1].resolve(); await executing[1].promise;
  assert.deepEqual(started, ['0', '1']);
  release.resolve(); assert.equal((await work).status, 'completed'); await agent.close();
});

test('a failed read stops scheduling and drains siblings before finalizing and disposing', async () => {
  const entered = deferred(), failure = deferred(), release = deferred(), stopped = deferred();
  const started = [], events = []; let disposed = false;
  const model = fakeModel(request(call('bad'), call('slow'), call('queued'), call('write', 'write')));
  const agent = await createAgent({ ...options(model), limits: { maxConcurrentTools: 2 }, tools: [
    tool(async (_args, ctx) => {
      started.push(ctx.callId);
      if (ctx.callId === 'bad') { await failure.promise; throw new Error('private failure'); }
      entered.resolve(); await release.promise; assert.equal(ctx.signal.aborted, true); return 'late success';
    }), namedTool('write', 'write', () => { started.push('write'); return ''; }),
  ], plugins: [{ id: 'disposal', apiVersion: 1, setup() {}, dispose() { disposed = true; } }] });
  agent.subscribe(event => { events.push(event); if (event.type === 'run.stop_requested') stopped.resolve(); });
  let finished = false;
  const work = agent.prompt('read').then(result => { finished = true; return result; });
  await entered.promise; failure.resolve(); await stopped.promise;
  const closing = agent.close(); await turn();
  assert.equal(finished, false); assert.equal(disposed, false);
  assert.deepEqual(started, ['bad', 'slow']);
  release.resolve(); const result = await work; await closing;
  assert.equal(result.status, 'failed'); assert.equal(result.error.code, 'TOOL_FAILED');
  assert.equal(disposed, true); assert.equal(model.inputs.length, 1);
  assert.deepEqual(results(agent).map(result => [result.callId, result.execution]),
    [['bad', 'failed'], ['slow', 'succeeded'], ['queued', 'not_executed'], ['write', 'not_executed']]);
  assert.equal(events.at(-1).type, 'run.end');
  assert.equal(agent.state.historyStatus, 'ready');
});

describe('explicit cancellation drains all parallel reads', () => {
  for (const method of ['abort', 'close']) test(method, async () => {
    const entered = deferred(), release = deferred(), started = [];
    const agent = await createAgent({ ...options(fakeModel(request(call('a'), call('b'), call('queued')))),
      limits: { maxConcurrentTools: 2 }, tools: [tool(async (_args, ctx) => {
        started.push(ctx.callId); if (started.length === 2) entered.resolve();
        await release.promise; assert.equal(ctx.signal.aborted, true); return ctx.callId;
      })],
    });
    let idle = false;
    const work = agent.prompt('read'); await entered.promise;
    const closing = method === 'close' ? agent.close() : agent.abort();
    const waiting = agent.waitForIdle().then(() => { idle = true; });
    await turn(); assert.equal(idle, false); assert.deepEqual(started, ['a', 'b']);
    release.resolve(); assert.equal((await work).status, 'cancelled'); await waiting; await closing;
    assert.deepEqual(results(agent).map(result => result.execution), ['succeeded', 'succeeded', 'not_executed']);
    await agent.close();
  });
});

describe('steering drains started reads and skips prepared or queued reads', () => {
  for (const duringApproval of [false, true]) test(duringApproval ? 'during approval' : 'while concurrency is full', async () => {
    const ready = deferred(), release = deferred(), started = [], preparationSignals = [];
    const model = fakeModel(request(call('a'), call('b'), call('queued')), answer('steered'));
    const agent = await createAgent({ ...options(model), limits: { maxConcurrentTools: 2 }, tools: [tool(async (_args, ctx) => {
      started.push(ctx.callId); if (started.length === 2) ready.resolve();
      await release.promise; assert.equal(ctx.signal.aborted, false); return ctx.callId;
    })], hooks: { authorizeTool: [async (call, { signal }) => {
      preparationSignals.push(signal);
      if (duringApproval && call.callId === 'b') {
        ready.resolve(); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      }
      return { action: 'allow' };
    }] } });
    const work = agent.prompt('read'); await ready.promise;
    let consumed = false;
    const accepted = agent.steer('new direction').then(value => { consumed = true; return value; });
    await turn(); assert.equal(consumed, false); assert.equal(model.inputs.length, 1);
    assert.equal(preparationSignals[0].aborted, false);
    assert.equal(preparationSignals[1].aborted, duringApproval);
    release.resolve(); assert.equal(await accepted, true); assert.equal((await work).status, 'completed');
    assert.deepEqual(started, duringApproval ? ['a'] : ['a', 'b']);
    const executions = new Map(results(agent).map(result => [result.callId, result.execution]));
    assert.equal(executions.get('a'), 'succeeded');
    assert.equal(executions.get('b'), duringApproval ? 'not_executed' : 'succeeded');
    assert.equal(executions.get('queued'), 'not_executed');
    assert.equal(model.inputs[1].messages.at(-1).content, 'new direction');
    await agent.close();
  });
});

test('remaining execution budget stops a parallel batch without losing started results', async () => {
  const entered = deferred(), release = deferred(), stopped = deferred(), started = [];
  const agent = await createAgent({ ...options(fakeModel(request(call('previous')), request(call('active'), call('over-budget')))),
    limits: { maxToolCalls: 2 }, tools: [tool(async (_args, ctx) => {
      started.push(ctx.callId);
      if (ctx.callId === 'active') { entered.resolve(); await release.promise; }
      return '';
    })],
  });
  agent.subscribe(event => { if (event.type === 'run.stop_requested') stopped.resolve(); });
  const work = agent.prompt('read'); await entered.promise; await stopped.promise;
  assert.deepEqual(started, ['previous', 'active']); release.resolve();
  const result = await work; assert.equal(result.status, 'limited'); assert.equal(result.reason, 'max_tool_calls');
  assert.deepEqual(new Map(results(agent).map(result => [result.callId, result.execution])),
    new Map([['previous', 'succeeded'], ['active', 'succeeded'], ['over-budget', 'not_executed']]));
  await agent.close();
});

test('read result-hook failure drains parallel work and preserves successful execution facts', async () => {
  const entered = deferred(), failHook = deferred(), release = deferred(), stopped = deferred();
  const agent = await createAgent({ ...options(fakeModel(request(call('a'), call('b'), call('queued')))),
    limits: { maxConcurrentTools: 2 }, tools: [tool(async (_args, ctx) => {
      if (ctx.callId === 'b') { entered.resolve(); await release.promise; }
      return 'confirmed';
    })], hooks: { mapToolResult: [async result => {
      if (result.callId === 'a') { await failHook.promise; throw new Error('hook failed'); }
      return result.content;
    }] },
  });
  agent.subscribe(event => { if (event.type === 'run.stop_requested') stopped.resolve(); });
  const work = agent.prompt('read'); await entered.promise; failHook.resolve(); await stopped.promise;
  release.resolve(); assert.equal((await work).error.code, 'TOOL_RESULT_PROCESSING');
  assert.deepEqual(results(agent).map(result => result.execution), ['succeeded', 'succeeded', 'not_executed']);
  await agent.close();
});

test('concurrency requires a positive safe integer', async () => {
  for (const maxConcurrentTools of [0, -1, 1.5, NaN, Infinity, null, undefined, '2', Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(createAgent({ ...options(fakeModel()), limits: { maxConcurrentTools } }), { code: 'CONFIG_INVALID' });
  }
});

test('history capacity exhaustion reserves results for every in-flight and queued call', async () => {
  const entered = deferred(), overflow = deferred(), release = deferred(), stopped = deferred();
  const agent = await createAgent({ ...options(fakeModel(request(call('large'), call('slow'), call('queued')))),
    limits: { maxConcurrentTools: 2, maxHistoryBytes: 2000 }, tools: [tool(async (_args, ctx) => {
      if (ctx.callId === 'large') { await overflow.promise; return 'x'.repeat(3000); }
      entered.resolve(); await release.promise; return 'known result';
    })],
  });
  agent.subscribe(event => { if (event.type === 'run.stop_requested') stopped.resolve(); });
  const work = agent.prompt('read'); await entered.promise; overflow.resolve(); await stopped.promise;
  release.resolve(); const result = await work;
  assert.equal(result.status, 'limited'); assert.equal(result.reason, 'history_capacity');
  assert.deepEqual(results(agent).map(result => result.execution), ['succeeded', 'succeeded', 'not_executed']);
  assert.equal(results(agent)[0].content, '[Tool result unavailable.]');
  assert.ok(Buffer.byteLength(JSON.stringify(agent.state.messages)) <= 2000);
  agent.replaceMessages(agent.state.messages); await agent.close();
});
