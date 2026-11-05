// Explicit opt-in integration probe. Never included by bun test or Nx's cached test target.
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { createAgent, createTool } from '@alpha/adk/core';
import { createProvider } from '@alpha/provider';

const modelId = process.env.ADK_MODEL;
const keyEnv = process.env.ADK_API_KEY_ENV ?? 'OPENAI_API_KEY';
const baseURL = process.env.ADK_BASE_URL ?? 'https://api.openai.com/v1';
const noAuth = process.env.ADK_AUTH === 'none';
const missing = [!modelId && 'ADK_MODEL', !noAuth && !process.env[keyEnv] && keyEnv].filter(Boolean);
if (missing.length) {
  console.log(JSON.stringify({ status: 'not_configured', verified: false, missing }));
  process.exitCode = 2;
} else {
  const proof = randomBytes(12).toString('hex');
  let executions = 0, modelCalls = 0, agent;
  const started = Date.now();
  try {
    const provider = createProvider({ providers: { live: {
      adapter: 'openai-completions', options: { baseURL, apiKey: noAuth ? { none: true } : { env: keyEnv } },
      models: { chat: { id: modelId } },
    } } });
    const lookup = createTool({
      name: 'get_test_code', description: 'Return the current test code. Do not guess this value.',
      input: z.strictObject({}), effect: 'read',
      execute() { executions++; return proof; },
    });
    agent = await createAgent({
      model: provider.use('live', 'chat'), instructions: 'Call get_test_code once and report its exact value.',
      tools: [lookup], limits: { maxModelCalls: 3, maxToolCalls: 2, timeoutMs: 90_000 },
    });
    agent.subscribe(event => { if (event.type === 'model.start') modelCalls++; });
    const result = await agent.prompt('Retrieve the current test code using the tool, then tell me the code.');
    const verified = result.status === 'completed' && executions === 1 && result.text.includes(proof);
    console.log(JSON.stringify({
      status: verified ? 'passed' : 'failed', verified, endpoint: new URL(baseURL).origin,
      model: modelId, date: new Date().toISOString(), modelCalls, toolExecutions: executions,
      runStatus: result.status, ...(result.status === 'failed' ? { errorCode: result.error.code } : {}), elapsedMs: Date.now() - started,
    }));
    if (!verified) process.exitCode = 1;
  } catch (cause) {
    console.log(JSON.stringify({ status: 'failed', verified: false, code: typeof cause?.code === 'string' ? cause.code : 'LIVE_TEST_FAILED' }));
    process.exitCode = 1;
  } finally { await agent?.close(); }
}
