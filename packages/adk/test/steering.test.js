import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createAgent } from '@alpha/adk/core';
import { answer, call, request, fakeModel, tool, deferred, options, turn } from './helpers';

const untilAborted = signal => new Promise(resolve => {
  if (signal.aborted) resolve();
  else signal.addEventListener('abort', resolve, { once: true });
});

test('steering interrupts the model stream, preserves its preview, and continues the same run', async () => {
  const entered = deferred();
  let closed = false;
  const model = fakeModel(async function* ({ signal }) {
    try {
      yield { type: 'text-delta', text: 'initial preview' };
      entered.resolve();
      await untilAborted(signal);
      signal.throwIfAborted();
    } finally { closed = true; }
  }, () => { assert.equal(closed, true); return answer('guided reply'); });
  const agent = await createAgent(options(model));
  const events = [];
  agent.subscribe(event => events.push(event));
  assert.equal(await agent.steer('idle'), false);
  const work = agent.prompt('original');
  await entered.promise;
  assert.equal(agent.state.canSteer, true);
  const accepted = agent.steer('new direction');
  assert.equal(agent.state.messages.some(message => message.content === 'new direction'), false);
  assert.equal(await accepted, true);
  assert.equal((await work).text, 'guided reply');
  assert.deepEqual(model.inputs[1].messages.map(message => message.content), [
    'Use verified facts.', 'original', 'initial preview', 'new direction',
  ]);
  assert.equal(agent.state.messages[1].incompleteReason, 'steered');
  assert.equal(events.find(event => event.type === 'model.end').outcome, 'steered');
  assert.equal(events.some(event => event.type === 'run.stop_requested'), false);
  assert.equal(model.inputs[0].signal.aborted, true);
  assert.equal(model.inputs[1].signal.aborted, false);
  assert.equal(events.filter(event => event.type === 'run.start').length, 1);
  assert.equal(events.filter(event => event.type === 'run.end').length, 1);
  assert.equal(agent.state.canSteer, false);
  await agent.close();
});

test('steering preserves a started write and skips the rest of the tool batch without replay', async () => {
  const entered = deferred(), release = deferred();
  let preparationSignal;
  const executed = [];
  const model = fakeModel(request(call('first', 'lookup', { id: 'A' }), call('second', 'lookup', { id: 'B' })), answer('guided'));
  const agent = await createAgent({ ...options(model), tools: [tool(async ({ id }, ctx) => {
    executed.push(id);
    if (id === 'A') { entered.resolve(); await release.promise; }
    assert.equal(ctx.signal.aborted, false);
    assert.equal(preparationSignal.aborted, false);
    return id;
  }, 'write')], hooks: { authorizeTool: [(_call, { signal }) => {
    preparationSignal = signal; return { action: 'allow' };
  }] } });
  const work = agent.prompt('use tools');
  await entered.promise;
  const accepted = agent.steer('summarize differently');
  await turn();
  assert.deepEqual(executed, ['A']);
  release.resolve();
  assert.equal(await accepted, true);
  assert.equal((await work).status, 'completed');
  assert.deepEqual(executed, ['A']);
  assert.deepEqual(agent.state.messages.map(message => message.role), ['user', 'assistant', 'toolResult', 'toolResult', 'user', 'assistant']);
  assert.equal(agent.state.messages[2].execution, 'succeeded');
  assert.equal(agent.state.messages[3].execution, 'not_executed');
  assert.equal(agent.state.historyStatus, 'ready');
  assert.equal(model.inputs[1].messages.at(-1).content, 'summarize differently');
  await agent.close();
});

test('steering aborts tool approval before any effect and closes every pending call', async () => {
  const entered = deferred();
  let executions = 0, approvalSignal;
  const model = fakeModel(request(call('a'), call('b')), answer('changed plan'));
  const agent = await createAgent({ ...options(model), tools: [tool(() => { executions++; return 'unexpected'; }, 'write')],
    hooks: { authorizeTool: [async (_call, { signal }) => {
      approvalSignal = signal;
      entered.resolve();
      await untilAborted(signal);
      return { action: 'allow' }; // Even a late approval must not start this tool.
    }] },
  });
  const work = agent.prompt('original');
  await entered.promise;
  assert.equal(await agent.steer('skip those writes'), true);
  assert.equal((await work).status, 'completed');
  assert.equal(approvalSignal.aborted, true);
  assert.equal(executions, 0);
  assert.deepEqual(agent.state.messages.filter(m => m.role === 'toolResult').map(m => m.execution), ['not_executed', 'not_executed']);
  assert.equal(model.inputs[1].messages.at(-1).content, 'skip those writes');
  await agent.close();
});

test('steering before model preparation finishes retries with fresh history and a fresh signal', async () => {
  const entered = deferred();
  let preparation = 0;
  const model = fakeModel(answer('new plan'));
  const agent = await createAgent({ ...options(model), hooks: { beforeModel: [async (messages, { signal }) => {
    if (++preparation === 1) { entered.resolve(); await untilAborted(signal); signal.throwIfAborted(); }
    assert.equal(signal.aborted, false);
    return messages;
  }] } });
  const work = agent.prompt('original');
  await entered.promise;
  assert.equal(await agent.steer('new direction'), true);
  assert.equal((await work).status, 'completed');
  assert.equal(model.inputs.length, 1);
  assert.deepEqual(model.inputs[0].messages.map(m => m.content), ['Use verified facts.', 'original', 'new direction']);
  await agent.close();
});

test('multiple steering messages interrupt once, preserve order, and discard unfinished tool hints', async () => {
  const entered = deferred();
  let executions = 0;
  const model = fakeModel(async function* ({ signal }) {
    yield { type: 'tool-call', toolCall: call() };
    entered.resolve();
    await untilAborted(signal);
    // A provider may return late chunks despite cancellation. Ignore all of them.
    yield { type: 'text-delta', text: 'late discarded text' };
    yield { type: 'finish', result: request(call()) };
  }, answer('guided'));
  const agent = await createAgent({ ...options(model), tools: [tool(() => { executions++; return 'unexpected'; })] });
  const work = agent.prompt('original');
  await entered.promise;
  assert.deepEqual(await Promise.all([agent.steer('one'), agent.steer('two')]), [true, true]);
  assert.equal((await work).status, 'completed');
  assert.equal(executions, 0);
  assert.deepEqual(model.inputs[1].messages.map(m => m.content), ['Use verified facts.', 'original', 'one', 'two']);
  assert.equal(model.inputs.length, 2);
  await agent.close();
});

test('steering preserves a complete result received just before stream teardown', async () => {
  const entered = deferred();
  const model = fakeModel(async function* ({ signal }) {
    yield { type: 'finish', result: answer('complete reply') };
    entered.resolve();
    await untilAborted(signal);
  }, answer('guided'));
  const agent = await createAgent(options(model));
  const work = agent.prompt('original');
  await entered.promise;
  assert.equal(await agent.steer('new direction'), true);
  assert.equal((await work).status, 'completed');
  assert.equal(agent.state.messages[1].outcome, 'completed');
  assert.equal(model.inputs[1].messages[2].content, 'complete reply');
  await agent.close();
});

test('explicit stop takes priority over model steering and does not resume generation', async () => {
  const entered = deferred();
  const model = fakeModel(async function* ({ signal }) {
    entered.resolve();
    await untilAborted(signal);
    signal.throwIfAborted();
  }, answer('later'));
  const agent = await createAgent(options(model));
  const work = agent.prompt('original');
  await entered.promise;
  const accepted = agent.steer('do not leak');
  agent.abort();
  assert.equal(await accepted, false);
  assert.equal((await work).status, 'cancelled');
  assert.equal(model.inputs.length, 1);
  await agent.prompt('later');
  assert.equal(model.inputs[1].messages.some(m => m.content === 'do not leak'), false);
  await agent.close();
});

test('steering cannot bypass the model-call budget', async () => {
  const entered = deferred();
  const model = fakeModel(async function* ({ signal }) {
    entered.resolve();
    await untilAborted(signal);
    signal.throwIfAborted();
  });
  const agent = await createAgent({ ...options(model), limits: { maxModelCalls: 1 } });
  const work = agent.prompt('original');
  await entered.promise;
  assert.equal(await agent.steer('new direction'), true);
  assert.equal((await work).reason, 'max_model_calls');
  assert.equal(model.inputs.length, 1);
  await agent.close();
});

test('cancelled runs return unconsumed steering and do not leak it into the next prompt', async () => {
  const entered = deferred(), release = deferred();
  const model = fakeModel(request(call()), answer('later reply'));
  const agent = await createAgent({ ...options(model), tools: [tool(async () => { entered.resolve(); await release.promise; return 'ok'; })] });
  const work = agent.prompt('original');
  await entered.promise;
  const accepted = agent.steer('must not leak');
  agent.abort();
  release.resolve();
  assert.equal(await accepted, false);
  assert.equal((await work).status, 'cancelled');
  await agent.prompt('later input');
  assert.equal(model.inputs[1].messages.some(message => message.content === 'must not leak'), false);
  await agent.close();
});
