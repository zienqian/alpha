import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProvider } from '@alpha/provider';
import { createAgent } from '@alpha/adk/core';
import { tool, deferred } from './helpers.js';

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

test('existing Provider implementations drive the complete ADK loop without a bridge', async t => {
  for (const [adapter, replies] of Object.entries(cases)) {
    await t.test(adapter, async () => {
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
