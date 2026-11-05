// Opt-in real-service test: bun run build, then bun run --filter @alpha/provider test:live.
import { beforeAll, describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { createProvider } from '../dist/index';

const key = process.env.OPENROUTER_API_KEY;
const modelId = process.env.OPENROUTER_TEST_MODEL ?? 'nvidia/nemotron-3-ultra-550b-a55b:free';

describe.skipIf(!key)('OpenRouter free model: text, streaming and tool round trip', () => {
  beforeAll(() => assert.ok(modelId.endsWith(':free'), 'Integration tests must use a free OpenRouter model'));
  let model;
  beforeAll(() => {
    const provider = createProvider({ providers: { openrouter: {
      adapter: 'openai-completions',
      options: { baseURL: 'https://openrouter.ai/api/v1', apiKey: { env: 'OPENROUTER_API_KEY' } },
      models: { free: { id: modelId } },
    } } });
    model = provider.use('openrouter', 'free');
  });
  const input = { messages: [{ role: 'user', content: 'Reply with a short greeting.' }], maxOutputTokens: 1024 };
  const signal = () => AbortSignal.timeout(60_000);

  test('generate text', async () => {
    const result = await model.generate({ ...input, signal: signal() });
    assert.equal(result.outcome, 'completed');
    assert.ok(result.text.trim(), 'Expected nonempty text');
  }, 240_000);

  test('stream text', async () => {
    let text = ''; let result;
    for await (const event of model.stream({ ...input, signal: signal() })) {
      if (event.type === 'text-delta') text += event.text;
      if (event.type === 'finish') result = event.result;
    }
    assert.equal(result?.outcome, 'completed');
    assert.ok(text.trim(), 'Expected streamed text');
    assert.equal(text, result.text);
  }, 240_000);

  test('cancellation and authentication failure', async () => {
    const controller = new AbortController(); controller.abort();
    await assert.rejects(() => model.generate({ ...input, signal: controller.signal }), { name: 'AbortError' });
    const invalid = createProvider({ providers: { openrouter: {
      adapter: 'openai-completions', options: { baseURL: 'https://openrouter.ai/api/v1', apiKey: { env: 'INVALID_TEST_KEY' } },
      models: { free: { id: modelId } },
    } } }, { getEnv: () => 'invalid-key-for-testing' }).use('openrouter', 'free');
    await assert.rejects(() => invalid.generate({ ...input, signal: signal() }), (error) => error.code === 'REQUEST_FAILED' && error.status === 401);
  }, 240_000);

  test('tool call and continuation', async () => {
    const tools = [{ name: 'get_test_code', description: 'Returns the current test code.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }];
    const messages = [{ role: 'user', content: 'Use get_test_code to retrieve the test code, then tell me what it is. Do not guess.' }];
    const first = await model.generate({ messages, tools, maxOutputTokens: 2048, signal: signal() });
    assert.equal(first.outcome, 'tool_calls', 'Model did not request a tool; tool calling is non-deterministic');
    assert.ok(first.toolCalls.length > 0);
    messages.push({ role: 'assistant', content: first.text, toolCalls: first.toolCalls });
    for (const call of first.toolCalls) {
      assert.equal(call.name, 'get_test_code');
      assert.deepEqual(call.arguments, {});
      messages.push({ role: 'tool', toolCallId: call.id, content: 'ALPHA-TEST-42' });
    }
    const final = await model.generate({ messages, tools, maxOutputTokens: 2048, signal: signal() });
    assert.equal(final.outcome, 'completed');
    assert.match(final.text.replace(/[\u2010-\u2015\u2212]/g, '-'), /ALPHA-TEST-42/i);
  }, 240_000);
});
