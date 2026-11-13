import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createProvider, defineProviderConfig, ProviderError } from '../dist/index';

const config = () => defineProviderConfig({ providers: {
  local: { adapter: 'openai-completions', options: { baseURL: 'https://example.invalid/v1', apiKey: { env: 'KEY' } }, models: { chat: { id: 'model-chat' }, reasoning: { id: 'model-reason' } } },
  openai: { adapter: 'openai-responses', options: { baseURL: 'https://openai.invalid/v1', apiKey: { env: 'KEY' } }, models: { chat: { id: 'model-openai' } } },
  anthropic: { adapter: 'anthropic-messages', options: { baseURL: 'https://anthropic.invalid/v1', apiKey: { env: 'KEY' }, maxOutputTokens: 123 }, models: { chat: { id: 'model-claude' } } },
} });
const reply = (data) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const collect = async (iterable) => { const values = []; for await (const value of iterable) values.push(value); return values; };

test('only structured context overflow codes normalize into a retryable error', async () => {
  for (const [body, expected] of [
    [{ error: { code: 'context_length_exceeded', message: 'private' } }, 'CONTEXT_LENGTH_EXCEEDED'],
    [{ error: { type: 'prompt_too_long' } }, 'CONTEXT_LENGTH_EXCEEDED'],
    [{ error: { type: 'invalid_request_error', message: 'context length exceeded' } }, 'REQUEST_FAILED'],
    [{ error: { code: 'rate_limit_exceeded' } }, 'REQUEST_FAILED'],
  ]) {
    const model = createProvider(config(), { getEnv: () => 'secret', fetch: async () => new Response(JSON.stringify(body), { status: 400 }) }).use('local', 'chat');
    await assert.rejects(collect(model.stream({ messages: [{ role: 'user', content: 'hi' }] })), error => error.code === expected && !error.message.includes('private'));
  }
});

test('literal credentials authenticate without any environment lookup and remain absent from metadata/errors', async () => {
  for (const [adapter, options, header, expected, body] of [
    ['openai-completions', { apiKey: { value: 'direct-secret' } }, 'authorization', 'Bearer direct-secret', { choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }],
    ['openai-responses', { apiKey: { value: 'direct-secret' } }, 'authorization', 'Bearer direct-secret', { status: 'completed', output: [] }],
    ['anthropic-messages', { apiKey: { value: 'direct-secret' } }, 'x-api-key', 'direct-secret', { stop_reason: 'end_turn', content: [] }],
    ['openai-codex-responses', { accessToken: { value: 'direct-secret' } }, 'authorization', 'Bearer direct-secret', { status: 'completed', output: [] }],
  ]) {
    let sent;
    const provider = createProvider({ providers: { p: { adapter, options, models: { m: { id: 'id' } } } } }, {
      getEnv() { throw Error('Environment must not be read'); },
      fetch: async (_url, init) => { sent = init.headers.get(header); return reply(body); },
    });
    await provider.use('p', 'm').generate({ messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 100 });
    assert.equal(sent, expected); assert.ok(!JSON.stringify(provider.list()).includes('direct-secret'));
  }
  for (const apiKey of [{ value: '' }, { value: 'direct-secret\r\nheader' }, { value: 'direct-secret', none: true }, { value: 'direct-secret', env: 'KEY' }]) {
    assert.throws(() => createProvider({ providers: { p: { adapter: 'openai-completions', options: { apiKey }, models: { m: { id: 'id' } } } } }), error => error.code === 'CONFIG_INVALID' && !error.message.includes('direct-secret'));
  }
});

test('static config snapshot, aliases, validation, and safe metadata', () => {
  const source = config();
  const provider = createProvider(source, { getEnv: () => 'super-secret' });
  source.providers.local.models.chat.id = 'mutated';
  assert.equal(provider.use('local', 'chat').modelId, 'model-chat');
  assert.equal(provider.use('local', 'reasoning').modelId, 'model-reason');
  assert.equal(provider.use('anthropic', 'chat').modelId, 'model-claude');
  assert.equal(JSON.stringify(provider.list()).includes('super-secret'), false);
  assert.throws(() => provider.use('toString', 'chat'), { code: 'PROVIDER_NOT_FOUND' });
  assert.throws(() => provider.use('local', 'toString'), { code: 'MODEL_NOT_FOUND' });
  assert.throws(() => createProvider(config(), { getEnv: () => undefined }).use('local', 'chat'), { code: 'SECRET_MISSING' });
  assert.throws(() => createProvider({ providers: { x: { adapter: 'missing', options: {}, models: { chat: { id: 'id' } } } } }), { code: 'ADAPTER_NOT_FOUND' });
  assert.throws(() => createProvider({ providers: { x: { adapter: 'openai-completions', options: { baseURL: 'https://user:password@example.com/v1', apiKey: { none: true } }, models: { chat: { id: 'id' } } } } }), { code: 'CONFIG_INVALID' });
});

test('OpenAI-compatible text and tool call round trip, secret rotation', async () => {
  const requests = []; let secret = 'first';
  const fetch = async (url, init) => {
    requests.push({ url: String(url), auth: init.headers.get('authorization'), body: JSON.parse(init.body) });
    return reply({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{"id":1}' } }] } }], usage: { prompt_tokens: 12, completion_tokens: 4 } });
  };
  const provider = createProvider(config(), { getEnv: () => secret, fetch });
  const first = provider.use('local', 'chat'); secret = 'second';
  const second = provider.use('local', 'reasoning');
  const result = await first.generate({ messages: [{ role: 'user', content: 'hi' }], tools: [{ name: 'lookup', inputSchema: { type: 'object' } }] });
  assert.deepEqual(result.toolCalls, [{ id: 'call-1', name: 'lookup', arguments: { id: 1 } }]);
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 4 });
  await second.generate({ messages: [{ role: 'assistant', content: '', toolCalls: result.toolCalls }, { role: 'tool', toolCallId: 'call-1', content: 'done' }] });
  assert.equal(requests[0].url, 'https://example.invalid/v1/chat/completions');
  assert.equal(requests[0].auth, 'Bearer first');
  assert.equal(requests[1].auth, 'Bearer second');
  assert.equal(requests[1].body.model, 'model-reason');
  assert.equal(requests[1].body.messages[1].tool_call_id, 'call-1');
  assert.equal(requests[0].body.tools[0].function.name, 'lookup');
});

test('OpenAI responses protocol converts text and tool calls', async () => {
  let request;
  const provider = createProvider(config(), { getEnv: () => 'key', fetch: async (url, init) => {
    request = { url: String(url), body: JSON.parse(init.body) };
    return reply({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'hello' }] }, { type: 'function_call', call_id: 'id-1', name: 'lookup', arguments: '{"x":2}' }], usage: { input_tokens: 2, output_tokens: 3 } });
  } });
  const result = await provider.use('openai', 'chat').generate({ messages: [{ role: 'user', content: 'hi' }], tools: [{ name: 'lookup', inputSchema: { type: 'object' } }] });
  assert.equal(request.url, 'https://openai.invalid/v1/responses');
  assert.equal(request.body.tools[0].type, 'function');
  assert.equal(result.text, 'hello');
  assert.deepEqual(result.toolCalls[0], { id: 'id-1', name: 'lookup', arguments: { x: 2 } });
});

test('Codex Responses uses an explicitly supplied OAuth token against the official Responses API', async () => {
  const calls = [];
  const provider = createProvider({ providers: {
    codex: { adapter: 'openai-codex-responses', options: { accessToken: { env: 'CODEX_TOKEN' } }, models: { main: { id: 'codex-model' } } },
  } }, { getEnv: (name) => name === 'CODEX_TOKEN' ? 'oauth-access-token' : undefined, fetch: async (url, init) => {
    calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    return reply({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'done' }] }] });
  } });
  assert.equal((await provider.use('codex', 'main').generate({ messages: [{ role: 'user', content: 'hi' }] })).text, 'done');
  assert.equal(calls[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(calls[0].headers.get('authorization'), 'Bearer oauth-access-token');
  assert.equal(calls[0].body.model, 'codex-model');
  assert.throws(() => createProvider({ providers: { codex: { adapter: 'openai-codex-responses', options: { accessToken: { none: true } }, models: { main: { id: 'm' } } } } }), { code: 'CONFIG_INVALID' });
});

test('OpenAI chat and unauthenticated local compatible endpoints', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), auth: init.headers.get('authorization'), body: JSON.parse(init.body) });
    return reply({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] });
  };
  const provider = createProvider({ providers: {
    openai: { adapter: 'openai-completions', options: { apiKey: { env: 'KEY' } }, models: { chat: { id: 'openai-id' } } },
    local: { adapter: 'openai-completions', options: { baseURL: 'http://localhost:11434/v1', apiKey: { none: true } }, models: { chat: { id: 'local-id' } } },
  } }, { fetch, getEnv: () => 'key' });
  await provider.use('openai', 'chat').generate({ messages: [{ role: 'user', content: 'hi' }] });
  await provider.use('local', 'chat').generate({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(calls[0].auth, 'Bearer key');
  assert.equal(calls[1].url, 'http://localhost:11434/v1/chat/completions');
  assert.equal(calls[1].auth, null);
});

test('Anthropic messages protocol converts system, tools and usage', async () => {
  let request;
  const provider = createProvider(config(), { getEnv: () => 'key', fetch: async (url, init) => {
    request = { url: String(url), headers: init.headers, body: JSON.parse(init.body) };
    return reply({ content: [{ type: 'text', text: 'checking' }, { type: 'tool_use', id: 't1', name: 'lookup', input: { x: 1 } }], stop_reason: 'tool_use', usage: { input_tokens: 3, output_tokens: 4 } });
  } });
  const model = provider.use('anthropic', 'chat');
  const result = await model.generate({ messages: [{ role: 'system', content: 'help' }, { role: 'user', content: 'hi' }], tools: [{ name: 'lookup', inputSchema: { type: 'object' } }] });
  assert.equal(request.url, 'https://anthropic.invalid/v1/messages');
  assert.equal(request.headers.get('x-api-key'), 'key');
  assert.equal(request.body.max_tokens, 123);
  assert.equal(request.body.system, 'help');
  assert.equal(request.body.tools[0].input_schema.type, 'object');
  assert.equal(result.toolCalls[0].id, 't1');
  await model.generate({ messages: [{ role: 'assistant', content: 'checking', toolCalls: result.toolCalls }, { role: 'tool', toolCallId: 't1', content: 'done' }] });
  assert.equal(request.body.messages[1].content[0].tool_use_id, 't1');
});

test('custom adapter, invalid responses, cancellation, and sanitized HTTP errors', async () => {
  const fake = { provider: 'custom', modelId: 'id', async generate() { return { outcome: 'unknown', text: '', toolCalls: [], finishReason: null }; }, async *stream() { yield { type: 'finish', result: await this.generate() }; } };
  const custom = createProvider({ providers: { c: { adapter: 'custom', options: { region: 'r' }, models: { chat: { id: 'id' } } } } }, { adapters: { custom: { validate(o) { assert.equal(o.region, 'r'); }, createModel(_o, id) { assert.equal(id, 'id'); return fake; } } } });
  assert.equal(custom.use('c', 'chat'), fake);
  const make = (fetch) => createProvider(config(), { getEnv: () => 'secret', fetch }).use('local', 'chat');
  await assert.rejects(() => make(async () => new Response('secret-body', { status: 401 })).generate({ messages: [{ role: 'user', content: 'hi' }] }), (e) => e instanceof ProviderError && e.code === 'REQUEST_FAILED' && e.status === 401 && !e.message.includes('secret'));
  await assert.rejects(() => make(async () => reply({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ type: 'function', id: 'i', function: { name: 'x', arguments: '{' } }] } }] })).generate({ messages: [{ role: 'user', content: 'hi' }] }), { code: 'INVALID_RESPONSE' });
  await assert.rejects(() => make(async () => reply({})).generate({ messages: [] }), { code: 'INVALID_INPUT' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => make(async (_url, init) => { throw init.signal.reason; }).generate({ messages: [{ role: 'user', content: 'hi' }], signal: controller.signal }), { name: 'AbortError' });
});

test('configuration validation preserves field paths and protects adapter configuration', () => {
  const bad = config();
  bad.providers.local.options.baseURL = 'https://user:secret@example.com/v1';
  assert.throws(() => createProvider(bad), (error) => error.code === 'CONFIG_INVALID' && error.path === 'providers.local.options.baseURL');

  const customConfig = { providers: { c: { adapter: 'custom', options: { region: 'r' }, models: { chat: { id: 'id' } } } } };
  assert.throws(() => createProvider(customConfig, { adapters: { custom: { validate(options) { options.region = 'changed'; }, createModel() {} } } }), (error) => error.code === 'CONFIG_INVALID' && error.path === 'providers.c.options');
  assert.throws(() => createProvider(config(), { adapters: { 'openai-completions': { validate() {}, createModel() {} } } }), { code: 'CONFIG_INVALID' });
  assert.throws(() => createProvider({ providers: { old: { adapter: 'openai', options: {}, models: { chat: { id: 'id' } } } } }), { code: 'ADAPTER_NOT_FOUND' });
  const oldOption = config();
  oldOption.providers.openai.options.api = 'chat';
  assert.throws(() => createProvider(oldOption), { code: 'CONFIG_INVALID' });
});

test('all built-in protocols reject malformed responses consistently', async () => {
  const provider = createProvider(config(), { getEnv: () => 'key', fetch: async () => reply({ error: { message: 'secret' } }) });
  for (const name of ['local', 'openai', 'anthropic']) {
    await assert.rejects(() => provider.use(name, 'chat').generate({ messages: [{ role: 'user', content: 'hello' }] }), (error) => error.code === 'RESPONSE_FAILED' && !error.message.includes('secret'));
  }
});

test('protocol outcomes preserve refusals and incomplete text without exposing unsafe tool calls', async () => {
  const brokenChatTool = { type: 'function', id: 'i', function: { name: 'x', arguments: '{' } };
  const cases = [
    ['local', { choices: [{ finish_reason: 'stop', message: { content: null, refusal: 'no' } }] }, 'refused', '', 'no'],
    ['local', { choices: [{ finish_reason: 'content_filter', message: { content: 'partial' } }] }, 'refused', 'partial'],
    ['local', { choices: [{ finish_reason: 'length', message: { content: 'partial', tool_calls: [brokenChatTool] } }] }, 'incomplete', 'partial', undefined, 'length'],
    ['local', { choices: [{ message: { content: 'partial', tool_calls: [brokenChatTool] } }] }, 'unknown', 'partial'],
    ['openai', { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }, 'refused', '', 'no'],
    ['openai', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [{ type: 'message', content: [{ type: 'output_text', text: 'partial' }] }, { type: 'function_call', arguments: '{' }] }, 'incomplete', 'partial', undefined, 'max_output_tokens'],
    ['openai', { status: 'in_progress', output: [{ type: 'function_call', arguments: '{' }] }, 'unknown', ''],
    ['anthropic', { stop_reason: 'refusal', content: [{ type: 'text', text: 'no' }] }, 'refused', 'no', 'no'],
    ...['max_tokens', 'model_context_window_exceeded', 'pause_turn'].map((reason) => ['anthropic', { stop_reason: reason, content: [{ type: 'text', text: 'partial' }, { type: 'tool_use', input: '{' }] }, 'incomplete', 'partial', undefined, reason]),
    ['anthropic', { content: [{ type: 'text', text: 'partial' }] }, 'unknown', 'partial'],
  ];
  for (const [name, response, outcome, text, refusal, incompleteReason] of cases) {
    const provider = createProvider(config(), { getEnv: () => 'key', fetch: async () => reply(response) });
    const result = await provider.use(name, 'chat').generate({ messages: [{ role: 'user', content: 'hello' }] });
    assert.equal(result.outcome, outcome, name);
    assert.equal(result.text, text, name);
    assert.equal(result.refusal, refusal, name);
    assert.equal(result.incompleteReason, incompleteReason, name);
    assert.deepEqual(result.toolCalls, [], name);
  }
  const failed = createProvider(config(), { getEnv: () => 'key', fetch: async () => reply({ status: 'failed', error: { message: 'sensitive' } }) });
  await assert.rejects(() => failed.use('openai', 'chat').generate({ messages: [{ role: 'user', content: 'hello' }] }), (error) => error.code === 'RESPONSE_FAILED' && !error.message.includes('sensitive'));
});

test('stream delivers split UTF-8 text, assembled tool calls and a final result across all protocols', async () => {
  const cases = [
    ['local', [
      { choices: [{ delta: { content: '你好' }, finish_reason: null }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'id', type: 'function', function: { name: 'lookup', arguments: '{"x":' } }] }, finish_reason: null }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '1}' } }] }, finish_reason: 'tool_calls' }] }, '[DONE]']],
    ['openai', [
      { type: 'response.output_text.delta', delta: '你好' },
      { type: 'response.function_call_arguments.delta', delta: '{"x":1}' },
      { type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '你好' }] }, { type: 'function_call', call_id: 'id', name: 'lookup', arguments: '{"x":1}' }] } }]],
    ['anthropic', [
      { type: 'message_start', message: { usage: { input_tokens: 2 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '你好' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'id', name: 'lookup', input: {} } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"x":1}' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 3 } },
      { type: 'message_stop' }]],
  ];
  for (const [name, events] of cases) {
    const wire = new TextEncoder().encode(events.map((event) => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\r\n\r\n`).join(''));
    let request;
    const fetch = async (_url, init) => {
      request = JSON.parse(init.body);
      return new Response(new ReadableStream({ start(controller) { for (const byte of wire) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }));
    };
    const model = createProvider(config(), { getEnv: () => 'key', fetch }).use(name, 'chat');
    const result = await collect(model.stream({ messages: [{ role: 'user', content: 'hi' }] }));
    assert.equal(request.stream, true);
    assert.deepEqual(result.map((event) => event.type), ['text-delta', 'tool-call', 'finish'], name);
    assert.equal(result[0].text, '你好');
    assert.deepEqual(result[1].toolCall, { id: 'id', name: 'lookup', arguments: { x: 1 } });
    assert.equal(result[2].result.outcome, 'tool_calls');
    assert.equal(result[2].result.text, '你好');
  }
});

test('stream reports refusals, truncation, malformed data and provider failures safely', async () => {
  const run = async (name, events) => {
    const wire = events.map((event) => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`).join('');
    const model = createProvider(config(), { getEnv: () => 'key', fetch: async () => new Response(wire) }).use(name, 'chat');
    return collect(model.stream({ messages: [{ role: 'user', content: 'hi' }] }));
  };
  const refused = await run('local', [{ choices: [{ delta: { refusal: 'no' }, finish_reason: 'stop' }] }, '[DONE]']);
  assert.equal(refused.at(-1).result.outcome, 'refused');
  assert.equal(refused.at(-1).result.refusal, 'no');
  const incomplete = await run('anthropic', [
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'id', name: 'f', input: {} } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'max_tokens' } }, { type: 'message_stop' },
  ]);
  assert.deepEqual(incomplete.map((event) => event.type), ['finish']);
  assert.equal(incomplete[0].result.outcome, 'incomplete');
  await assert.rejects(() => run('openai', [{ type: 'response.failed', response: { error: { message: 'secret' } } }]), (error) => error.code === 'RESPONSE_FAILED' && !error.message.includes('secret'));
  await assert.rejects(() => run('anthropic', [{ type: 'error', error: { message: 'secret' } }]), { code: 'RESPONSE_FAILED' });
  await assert.rejects(() => run('local', [{ choices: [{ delta: { content: 'partial' } }] }]), { code: 'INVALID_RESPONSE' });
  await assert.rejects(() => run('local', ['{bad json']), { code: 'INVALID_RESPONSE' });
  await assert.rejects(() => run('anthropic', [
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'id', name: 'f', input: {} } },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' } }, { type: 'message_stop' },
  ]), { code: 'INVALID_RESPONSE' });
  await assert.rejects(() => run('openai', [
    { type: 'response.completed', response: { status: 'completed', output: [{ type: 'function_call', status: 'incomplete', call_id: 'id', name: 'f', arguments: '{}' }] } },
  ]), { code: 'INVALID_RESPONSE' });
});

test('stream cancellation and early consumer exit release the response body', async () => {
  let cancelled = 0;
  const fetch = async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"x"}}]}\n\n')); },
    cancel() { cancelled++; },
  }));
  const model = createProvider(config(), { getEnv: () => 'key', fetch }).use('local', 'chat');
  for await (const event of model.stream({ messages: [{ role: 'user', content: 'hi' }] })) { assert.equal(event.text, 'x'); break; }
  assert.equal(cancelled, 1);
  const controller = new AbortController();
  const iterator = model.stream({ messages: [{ role: 'user', content: 'hi' }], signal: controller.signal })[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value.text, 'x');
  const pending = iterator.next();
  controller.abort();
  await assert.rejects(() => pending, { name: 'AbortError' });
  assert.equal(cancelled, 2);
  const buffered = createProvider(config(), { getEnv: () => 'key', fetch: async () => new Response('data: {"choices":[{"delta":{"content":"x"}}]}\n\ndata: {"choices":[{"delta":{"content":"y"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n') }).use('local', 'chat');
  const pendingController = new AbortController();
  const bufferedIterator = buffered.stream({ messages: [{ role: 'user', content: 'hi' }], signal: pendingController.signal })[Symbol.asyncIterator]();
  assert.equal((await bufferedIterator.next()).value.text, 'x');
  pendingController.abort();
  await assert.rejects(() => bufferedIterator.next(), { name: 'AbortError' });
});

test('Codex streams Responses and stream errors preserve transport and cancellation semantics', async () => {
  let sent;
  const codex = createProvider({ providers: { codex: { adapter: 'openai-codex-responses', options: { accessToken: { env: 'TOKEN' } }, models: { main: { id: 'model' } } } } }, {
    getEnv: () => 'token',
    fetch: async (url, init) => {
      sent = { url: String(url), auth: init.headers.get('authorization'), body: JSON.parse(init.body) };
      return new Response('data: {"type":"response.output_text.delta",\n' +
        'data: "delta":"ok"}\n\n' +
        'data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"ok"}]}]}}\n\n');
    },
  }).use('codex', 'main');
  const events = await collect(codex.stream({ messages: [{ role: 'user', content: 'hi' }] }));
  assert.equal(events.at(-1).result.outcome, 'completed');
  assert.equal(sent.url, 'https://api.openai.com/v1/responses');
  assert.equal(sent.auth, 'Bearer token');
  assert.equal(sent.body.stream, true);
  const failing = createProvider(config(), { getEnv: () => 'key', fetch: async () => new Response('secret', { status: 429 }) }).use('local', 'chat');
  await assert.rejects(() => collect(failing.stream({ messages: [{ role: 'user', content: 'hi' }] })), (error) => error.code === 'REQUEST_FAILED' && error.status === 429 && !error.message.includes('secret'));
  let called = false;
  const aborted = createProvider(config(), { getEnv: () => 'key', fetch: async () => { called = true; return new Response(); } }).use('local', 'chat');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => collect(aborted.stream({ messages: [{ role: 'user', content: 'hi' }], signal: controller.signal })), { name: 'AbortError' });
  assert.equal(called, false);
});

test('generate preserves cancellation while reading the response body', async () => {
  const controller = new AbortController();
  const model = createProvider(config(), { getEnv: () => 'key', fetch: async () => new Response(new ReadableStream({ start(body) {
    body.enqueue(new TextEncoder().encode('{'));
    controller.signal.addEventListener('abort', () => body.error(controller.signal.reason), { once: true });
  } })) }).use('local', 'chat');
  const pending = model.generate({ messages: [{ role: 'user', content: 'hi' }], signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 10));
  controller.abort();
  await assert.rejects(() => pending, { name: 'AbortError' });
  const broken = createProvider(config(), { getEnv: () => 'key', fetch: async () => new Response(new ReadableStream({ start(body) { body.error(new Error('sensitive')); } })) }).use('local', 'chat');
  await assert.rejects(() => broken.generate({ messages: [{ role: 'user', content: 'hi' }] }), (error) => error.code === 'REQUEST_FAILED' && !error.message.includes('sensitive'));
});

test('malformed tool identifiers are never returned as executable calls', async () => {
  const cases = [
    ['local', { choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ type: 'function', id: '', function: { name: 'x', arguments: '{}' } }] } }] }],
    ['openai', { status: 'completed', output: [{ type: 'function_call', call_id: 'i', name: ' ', arguments: '{}' }] }],
    ['anthropic', { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: '', name: 'x', input: {} }] }],
  ];
  for (const [name, data] of cases) {
    const model = createProvider(config(), { getEnv: () => 'key', fetch: async () => reply(data) }).use(name, 'chat');
    await assert.rejects(() => model.generate({ messages: [{ role: 'user', content: 'hi' }] }), { code: 'INVALID_RESPONSE' });
  }
});

test('OpenAI completions token field is configurable for native and compatible endpoints', async () => {
  const source = config(); source.providers.local.options.maxTokensField = 'max_completion_tokens';
  const bodies = [];
  const model = createProvider(source, { getEnv: () => 'key', fetch: async (_url, init) => { bodies.push(JSON.parse(init.body)); return reply({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }); } }).use('local', 'chat');
  await model.generate({ messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 42 });
  assert.equal(bodies[0].max_completion_tokens, 42);
  assert.equal('max_tokens' in bodies[0], false);
  source.providers.local.options.maxTokensField = 'bad';
  assert.throws(() => createProvider(source), { code: 'CONFIG_INVALID' });
});

test('Responses can continue a stored response with a tool result', async () => {
  const bodies = [];
  const model = createProvider(config(), { getEnv: () => 'key', fetch: async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return reply(bodies.length === 1 ? { id: 'resp_1', status: 'completed', output: [{ type: 'reasoning', id: 'rs_1' }, { type: 'function_call', call_id: 'call_1', name: 'lookup', arguments: '{}' }] } : { id: 'resp_2', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'done' }] }] });
  } }).use('openai', 'chat');
  const first = await model.generate({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(first.responseId, 'resp_1');
  await model.generate({ previousResponseId: first.responseId, messages: [{ role: 'tool', toolCallId: first.toolCalls[0].id, content: 'result' }] });
  assert.equal(bodies[1].previous_response_id, 'resp_1');
  assert.deepEqual(bodies[1].input, [{ type: 'function_call_output', call_id: 'call_1', output: 'result' }]);
  const local = createProvider(config(), { getEnv: () => 'key' }).use('local', 'chat');
  await assert.rejects(() => local.generate({ previousResponseId: 'resp_1', messages: [{ role: 'user', content: 'hi' }] }), { code: 'INVALID_INPUT' });
});

test('Anthropic preserves thinking and signatures across streamed tool use', async () => {
  const events = [
    { type: 'message_start', message: { usage: { input_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'thought' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'id', name: 'lookup', input: {} } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"x":1}' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' } }, { type: 'message_stop' },
  ];
  const wire = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
  const requests = [];
  const model = createProvider(config(), { getEnv: () => 'key', fetch: async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return requests.length === 1 ? new Response(wire) : reply({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] });
  } }).use('anthropic', 'chat');
  const result = (await collect(model.stream({ messages: [{ role: 'user', content: 'hi' }] }))).at(-1).result;
  assert.deepEqual(result.continuation.content, [{ type: 'thinking', thinking: 'thought', signature: 'sig' }, { type: 'tool_use', id: 'id', name: 'lookup', input: { x: 1 } }]);
  await model.generate({ messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: result.text, toolCalls: result.toolCalls, continuation: result.continuation }, { role: 'tool', toolCallId: 'id', content: 'result' }] });
  assert.deepEqual(requests[1].messages[1].content, result.continuation.content);
  const raw = [{ type: 'redacted_thinking', data: 'encrypted' }, { type: 'tool_use', id: 'id', name: 'lookup', input: { x: 1 } }];
  const nonstream = createProvider(config(), { getEnv: () => 'key', fetch: async () => reply({ content: raw, stop_reason: 'tool_use' }) }).use('anthropic', 'chat');
  assert.deepEqual((await nonstream.generate({ messages: [{ role: 'user', content: 'hi' }] })).continuation.content, raw);
});

test('model metadata is available on the model and list without changing requests', async () => {
  const source = config();
  Object.assign(source.providers.local.models.chat, {
    name: 'Local model', reasoning: true, input: ['text', 'image'],
    cost: { input: 0, output: 1, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 131072, maxTokens: 32000,
    thinkingLevelMap: { minimal: null, high: 'high' },
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
  });
  let sent;
  const provider = createProvider(source, { getEnv: () => 'key', fetch: async (_url, init) => {
    sent = JSON.parse(init.body);
    return reply({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] });
  } });
  source.providers.local.models.chat.cost.output = 99;
  const model = provider.use('local', 'chat');
  assert.equal(model.metadata.name, 'Local model');
  assert.equal(model.metadata.cost.output, 1);
  assert.equal(Object.isFrozen(model.metadata.cost), true);
  assert.equal(provider.list()[0].models[0].name, 'Local model');
  await model.generate({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(sent.model, 'model-chat');
  assert.equal('reasoning_effort' in sent, false);
  assert.equal('max_tokens' in sent, false);
});

test('model thinking maps and limits apply consistently to all built-in protocols and stream', async () => {
  const source = config();
  source.providers.codex = { adapter: 'openai-codex-responses', options: { accessToken: { env: 'KEY' } }, models: { chat: { id: 'codex' } } };
  for (const name of ['local', 'openai', 'anthropic', 'codex']) {
    Object.assign(source.providers[name].models.chat, { maxTokens: 200, reasoning: true, thinkingLevelMap: { high: 'high', low: null }, compat: { supportsReasoningEffort: true } });
  }
  const requests = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body); requests.push({ url: String(url), body });
    if (body.stream) {
      if (String(url).endsWith('/chat/completions')) return new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
      if (String(url).endsWith('/messages')) return new Response('data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"ok"}}\n\ndata: {"type":"content_block_stop","index":0}\n\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\ndata: {"type":"message_stop"}\n\n');
      return new Response('data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"ok"}]}]}}\n\n');
    }
    if (String(url).endsWith('/chat/completions')) return reply({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] });
    if (String(url).endsWith('/messages')) return reply({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] });
    return reply({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] });
  };
  const provider = createProvider(source, { getEnv: () => 'key', fetch });
  for (const name of ['local', 'openai', 'anthropic', 'codex']) {
    const model = provider.use(name, 'chat');
    const input = { messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 200, thinkingLevel: 'high' };
    await model.generate(input);
    await collect(model.stream(input));
    for (const { body } of requests.slice(-2)) {
      if (name === 'local') assert.equal(body.reasoning_effort, 'high');
      else if (name === 'anthropic') assert.deepEqual(body.output_config, { effort: 'high' });
      else assert.deepEqual(body.reasoning, { effort: 'high' });
    }
    const before = requests.length;
    for (const bad of [{ maxOutputTokens: 201 }, { thinkingLevel: 'low' }, { thinkingLevel: 'medium' }]) {
      await assert.rejects(() => model.generate({ messages: input.messages, ...bad }), { code: 'INVALID_INPUT' });
      await assert.rejects(() => collect(model.stream({ messages: input.messages, ...bad })), { code: 'INVALID_INPUT' });
    }
    assert.equal(requests.length, before);
  }
});

test('compatibility flags enforce developer and thinking support; maxTokens is a ceiling, not a default', async () => {
  const source = config();
  Object.assign(source.providers.local.models.chat, { maxTokens: 100, compat: { supportsDeveloperRole: false, supportsReasoningEffort: false } });
  const bodies = [];
  const provider = createProvider(source, { getEnv: () => 'key', fetch: async (_url, init) => { bodies.push(JSON.parse(init.body)); return reply({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }); } });
  const model = provider.use('local', 'chat');
  await assert.rejects(() => model.generate({ messages: [{ role: 'developer', content: 'rules' }] }), { code: 'INVALID_INPUT' });
  await assert.rejects(() => model.generate({ messages: [{ role: 'user', content: 'hi' }], thinkingLevel: 'high' }), { code: 'INVALID_INPUT' });
  assert.equal(bodies.length, 0);
  await model.generate({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal('max_tokens' in bodies[0], false);
  const allow = config(); allow.providers.local.models.chat.compat = { supportsDeveloperRole: true };
  const allowed = createProvider(allow, { getEnv: () => 'key', fetch: async (_url, init) => { bodies.push(JSON.parse(init.body)); return reply({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }); } }).use('local', 'chat');
  await allowed.generate({ messages: [{ role: 'developer', content: 'rules' }], thinkingLevel: 'medium' });
  assert.equal(bodies[1].messages[0].role, 'developer');
  assert.equal(bodies[1].reasoning_effort, 'medium');
  const anthropic = createProvider(config(), { getEnv: () => 'key' }).use('anthropic', 'chat');
  await assert.rejects(() => anthropic.generate({ messages: [{ role: 'developer', content: 'rules' }] }), { code: 'INVALID_INPUT' });
  await assert.rejects(() => anthropic.generate({ messages: [{ role: 'user', content: 'hi' }], thinkingLevel: 'minimal' }), { code: 'INVALID_INPUT' });
  const limited = config(); limited.providers.anthropic.models.chat.maxTokens = 100;
  const limitedModel = createProvider(limited, { getEnv: () => 'key' }).use('anthropic', 'chat');
  await assert.rejects(() => limitedModel.generate({ messages: [{ role: 'user', content: 'hi' }] }), { code: 'INVALID_INPUT' });
});

test('configured and per-request headers merge case-insensitively with environment snapshots', async () => {
  const source = config();
  source.providers.local.options.headers = { 'X-Tenant': 'default', 'x-api-key': { env: 'GATEWAY_KEY' } };
  let gatewayKey = 'first-header-secret';
  const requests = [];
  const provider = createProvider(source, {
    getEnv: (name) => name === 'GATEWAY_KEY' ? gatewayKey : 'model-secret',
    fetch: async (_url, init) => {
      requests.push(init.headers);
      return reply({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] });
    },
  });
  const first = provider.use('local', 'chat');
  gatewayKey = 'second-header-secret';
  const second = provider.use('local', 'chat');
  await first.generate({ messages: [{ role: 'user', content: 'hi' }], headers: { 'x-tenant': 'request', 'X-Trace': 'trace-1' } });
  await second.generate({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(requests[0].get('x-tenant'), 'request');
  assert.equal(requests[0].get('x-trace'), 'trace-1');
  assert.equal(requests[0].get('x-api-key'), 'first-header-secret');
  assert.equal(requests[1].get('x-tenant'), 'default');
  assert.equal(requests[1].get('x-api-key'), 'second-header-secret');
  assert.equal(requests[0].get('authorization'), 'Bearer model-secret');
  assert.equal(JSON.stringify(provider.list()).includes('header-secret'), false);
});

test('invalid or protected request headers fail without sending requests or exposing values', async () => {
  const source = config();
  let sent = false;
  const fetch = async () => { sent = true; return reply({}); };
  const provider = createProvider(source, { getEnv: () => 'key', fetch });
  const model = provider.use('local', 'chat');
  for (const headers of [
    { Authorization: 'secret-value' }, { 'content-type': 'text/plain' },
    { 'x-test': 'line\nbreak' }, { 'X-Test': 'one', 'x-test': 'two' },
  ]) {
    await assert.rejects(() => model.generate({ messages: [{ role: 'user', content: 'hi' }], headers }), (error) => error.code === 'INVALID_INPUT' && !JSON.stringify(error).includes('secret-value'));
  }
  assert.equal(sent, false);
  source.providers.local.options.headers = { Authorization: { env: 'GATEWAY_KEY' } };
  assert.throws(() => createProvider(source), { code: 'CONFIG_INVALID' });
  source.providers.local.options.headers = { 'X-Gateway-Key': { env: 'MISSING' } };
  assert.throws(() => createProvider(source, { getEnv: (name) => name === 'KEY' ? 'key' : undefined }).use('local', 'chat'), { code: 'SECRET_MISSING' });
  source.providers.local.options.headers = { 'X-Gateway-Key': { env: 'GATEWAY_KEY' } };
  assert.throws(() => createProvider(source, { getEnv: (name) => name === 'KEY' ? 'key' : 'bad\nvalue' }).use('local', 'chat'), { code: 'CONFIG_INVALID' });
  source.providers.local.options.headers = {};
  source.providers.anthropic.options.headers = { 'X-API-Key': { env: 'GATEWAY_KEY' } };
  assert.throws(() => createProvider(source), { code: 'CONFIG_INVALID' });
  const anthropic = createProvider(config(), { getEnv: () => 'key', fetch }).use('anthropic', 'chat');
  await assert.rejects(() => anthropic.generate({ messages: [{ role: 'user', content: 'hi' }], headers: { 'x-api-key': 'override' } }), { code: 'INVALID_INPUT' });
});

test('validates optional model metadata and keeps custom adapter receiver', async () => {
  for (const metadata of [
    { contextWindow: 0 }, { cost: { input: -1, output: 0, cacheRead: 0, cacheWrite: 0 } },
    { input: [['text']] }, { thinkingLevelMap: { unsupported: 'x' } }, { compat: { supportsDeveloperRole: 'no' } },
  ]) {
    const source = config();
    Object.assign(source.providers.local.models.chat, metadata);
    assert.throws(() => createProvider(source), { code: 'CONFIG_INVALID' });
  }
  const customModel = { provider: 'custom', modelId: 'id', prefix: 'kept', async generate() { return { outcome: 'completed', text: this.prefix, toolCalls: [], finishReason: null }; }, async *stream() { yield { type: 'finish', result: await this.generate() }; } };
  const provider = createProvider({ providers: { c: { adapter: 'custom', options: {}, models: { chat: { id: 'id', name: 'Custom' } } } } }, { adapters: { custom: { validate() {}, createModel() { return customModel; } } } });
  const model = provider.use('c', 'chat');
  assert.equal(model.metadata.name, 'Custom');
  assert.equal((await model.generate({ messages: [{ role: 'user', content: 'hi' }] })).text, 'kept');
  assert.equal((await collect(model.stream({ messages: [{ role: 'user', content: 'hi' }] })))[0].result.text, 'kept');
  assert.equal(Object.hasOwn(customModel, 'metadata'), false);
});
