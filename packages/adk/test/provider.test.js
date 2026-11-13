import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { createProvider } from '@alpha/provider';
import { createAgent } from '@alpha/adk/core';
import { tool, deferred } from './helpers';

const sse = events => new Response(events.map(e => 'data: ' + (typeof e === 'string' ? e : JSON.stringify(e)) + '\n\n').join(''), {
  headers: { 'content-type': 'text/event-stream' },
});
const cases = {
  'openai-completions': [
    [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'lookup', arguments: '{"id":"A"}' } }] }, finish_reason: 'tool_calls' }] }, '[DONE]',
    ],
    [{ choices: [{ delta: { content: 'verified A' }, finish_reason: 'stop' }] }, '[DONE]'],
  ],
  'openai-responses': [
    [{ type: 'response.completed', response: { id: 'resp_first', status: 'completed', output: [{ type: 'function_call', call_id: 'c1', name: 'lookup', arguments: '{"id":"A"}' }] } }],
    [{ type: 'response.completed', response: { id: 'resp_last', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'verified A' }] }] } }],
  ],
  'anthropic-messages': [
    [
      { type: 'message_start', message: { usage: { input_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'opaque thinking' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'signature' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'c1', name: 'lookup', input: {} } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"id":"A"}' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' } }, { type: 'message_stop' },
    ],
    [
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'verified A' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } }, { type: 'message_stop' },
    ],
  ],
};

const previews = {
  'openai-completions': [{ choices: [{ delta: { content: 'visible preview' }, finish_reason: null }] }],
  'openai-responses': [{ type: 'response.output_text.delta', delta: 'visible preview' }],
  'anthropic-messages': [{ type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'visible preview' } }],
};

describe('provider requests preserve pairing when parallel reads finish out of order', () => {
  for (const adapter of Object.keys(cases)) test(adapter, async () => {
    const events = structuredClone(cases[adapter][0]), bodies = [], release = deferred();
    if (adapter === 'openai-completions') {
      events[0].choices[0].delta.tool_calls.push({ index: 1, id: 'c2', type: 'function', function: { name: 'lookup', arguments: '{"id":"B"}' } });
    } else if (adapter === 'openai-responses') {
      events[0].response.output.push({ type: 'function_call', call_id: 'c2', name: 'lookup', arguments: '{"id":"B"}' });
    } else {
      events.splice(events.length - 2, 0,
        { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'c2', name: 'lookup', input: {} } },
        { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"id":"B"}' } },
        { type: 'content_block_stop', index: 2 },
      );
    }
    const provider = createProvider({ providers: { main: {
      adapter, options: { baseURL: 'https://fixture.invalid/v1', apiKey: { env: 'FIXTURE_KEY' }, ...(adapter === 'anthropic-messages' ? { maxOutputTokens: 100 } : {}) },
      models: { chat: { id: 'fixture-model' } },
    } } }, { getEnv: () => 'fixture-not-a-real-secret', fetch: async (_url, init) => {
      bodies.push(JSON.parse(init.body)); return sse(bodies.length === 1 ? events : cases[adapter][1]);
    } });
    const agent = await createAgent({ model: provider.use('main', 'chat'), instructions: '',
      tools: [tool(async ({ id }) => { if (id === 'A') await release.promise; return id; })],
    });
    agent.subscribe(event => { if (event.type === 'tool.end' && event.callId === 'c2') release.resolve(); });
    assert.equal((await agent.prompt('read both')).status, 'completed');
    const body = bodies[1];
    const pairs = adapter === 'openai-completions'
      ? body.messages.filter(message => message.role === 'tool').map(message => [message.tool_call_id, message.content])
      : adapter === 'openai-responses'
        ? body.input.filter(item => item.type === 'function_call_output').map(item => [item.call_id, item.output])
        : body.messages.at(-1).content.filter(block => block.type === 'tool_result').map(block => [block.tool_use_id, block.content]);
    assert.deepEqual(pairs, [['c2', 'B'], ['c1', 'A']]);
    await agent.close();
  });
});

describe('steering closes the provider stream before resuming with portable history', () => {
  for (const [adapter, events] of Object.entries(previews)) test(adapter, async () => {
    const entered = deferred(), bodies = [], signals = [];
    let closed = false;
    const provider = createProvider({ providers: { main: {
      adapter, options: { baseURL: 'https://fixture.invalid/v1', apiKey: { env: 'FIXTURE_KEY' }, ...(adapter === 'anthropic-messages' ? { maxOutputTokens: 100 } : {}) },
      models: { chat: { id: 'fixture-model' } },
    } } }, { getEnv: () => 'fixture-not-a-real-secret', fetch: async (_url, init) => {
      bodies.push(JSON.parse(init.body)); signals.push(init.signal);
      if (bodies.length > 1) { assert.equal(closed, true); return sse(cases[adapter][1]); }
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''))); },
        cancel() { closed = true; },
      }), { headers: { 'content-type': 'text/event-stream' } });
    } });
    const agent = await createAgent({ model: provider.use('main', 'chat'), instructions: 'Use verified facts.' });
    agent.subscribe(event => { if (event.type === 'model.delta') entered.resolve(); });
    const work = agent.prompt('original');
    await entered.promise;
    assert.equal(await agent.steer('new direction'), true);
    assert.equal((await work).status, 'completed');
    assert.equal(bodies.length, 2);
    assert.equal(signals[0].aborted, true);
    assert.equal(signals[1].aborted, false);
    assert.ok(JSON.stringify(bodies[1]).includes('visible preview'));
    assert.ok(JSON.stringify(bodies[1]).includes('new direction'));
    assert.equal(agent.state.messages[1].incompleteReason, 'steered');
    await agent.close();
  });
});

describe('existing Provider implementations drive the complete ADK loop without a bridge', () => {
  for (const [adapter, replies] of Object.entries(cases)) {
    test(adapter, async () => {
      const bodies = [], signals = []; let executions = 0;
      const provider = createProvider({ providers: { main: {
        adapter, options: { baseURL: 'https://fixture.invalid/v1', apiKey: { env: 'FIXTURE_KEY' }, ...(adapter === 'anthropic-messages' ? { maxOutputTokens: 100 } : {}) },
        models: { chat: { id: 'fixture-model' } },
      } } }, {
        getEnv: () => 'fixture-not-a-real-secret',
        fetch: async (_url, init) => {
          signals.push(init.signal); bodies.push(JSON.parse(init.body));
          assert.ok(bodies.length <= 2); return sse(replies[bodies.length - 1]);
        },
      });
      const agent = await createAgent({
        model: provider.use('main', 'chat'), instructions: 'Use the lookup tool.',
        tools: [tool(({ id }) => { executions++; return 'verified ' + id; })],
      });
      const result = await agent.prompt('Look up A');
      assert.equal(result.status, 'completed'); assert.equal(result.text, 'verified A');
      assert.equal(executions, 1); assert.equal(bodies.length, 2);
      assert.ok(signals.every(signal => signal instanceof AbortSignal));
      if (adapter === 'anthropic-messages') {
        const assistant = agent.state.messages.find(m => m.role === 'assistant');
        assert.deepEqual(bodies[1].messages.find(m => m.role === 'assistant').content, assistant.continuation.content);
        assert.ok(assistant.continuation.content.some(b => b.signature === 'signature'));
      } else if (adapter === 'openai-responses') {
        assert.equal(bodies[1].previous_response_id, undefined);
        assert.ok(bodies[1].input.some(m => m.type === 'function_call'));
        assert.ok(bodies[1].input.some(m => m.type === 'function_call_output'));
        assert.equal(agent.state.messages[1].responseId, 'resp_first');
      } else {
        assert.equal(bodies[1].messages.at(-1).role, 'tool');
        assert.equal(bodies[1].messages.at(-1).tool_call_id, 'c1');
      }
      await agent.close();
    });
  }
});

test('run cancellation reaches an actual Provider HTTP request', async () => {
  const entered = deferred(); let signal;
  const provider = createProvider({ providers: { main: {
    adapter: 'openai-completions', options: { baseURL: 'https://fixture.invalid/v1', apiKey: { none: true } },
    models: { chat: { id: 'fixture' } },
  } } }, { fetch: async (_url, init) => {
    signal = init.signal; entered.resolve();
    return new Promise((_resolve, reject) => {
      if (signal.aborted) reject(new DOMException('Aborted', 'AbortError'));
      else signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
  } });
  const agent = await createAgent({ model: provider.use('main', 'chat'), instructions: '' });
  const running = agent.prompt('go'); await entered.promise; agent.abort();
  assert.equal((await running).status, 'cancelled'); assert.equal(signal.aborted, true);
  assert.equal(agent.state.messages.length, 1); await agent.close();
});
