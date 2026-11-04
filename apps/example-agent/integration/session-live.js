// Explicit live probe, outside cached/offline tests. Run from the repo with --env-file=.env.local.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createAgent, createTool } from '@alpha/adk/core';
import { createSessionManager, createSessionPlugin } from '@alpha/adk-session';
import { createSqliteSessionStore } from '@alpha/adk-session/sqlite';
import { createProvider } from '@alpha/provider';

const modelId = process.env.ADK_MODEL, baseURL = process.env.ADK_BASE_URL;
const noAuth = process.env.ADK_AUTH === 'none', keyEnv = process.env.ADK_API_KEY_ENV ?? 'OPENAI_API_KEY';
if (!modelId || !baseURL || (!noAuth && !process.env[keyEnv])) {
  console.log(JSON.stringify({ status: 'not_configured', verified: false })); process.exitCode = 2;
} else {
  const directory = await mkdtemp(join(tmpdir(), 'alpha-session-live-')), started = Date.now(), proof = randomBytes(12).toString('hex');
  let store, sessions, agent, modelCalls = 0, executions = 0;
  const provider = createProvider({ providers: { local: {
    adapter: 'openai-completions', options: { baseURL, apiKey: noAuth ? { none: true } : { env: keyEnv } },
    models: { coding: { id: modelId } },
  } } });
  const lookup = createTool({ name: 'get_session_test_code', description: 'Get the random test code once, then remember it in the conversation.', effect: 'read',
    input: { '~standard': { version: 1, vendor: 'alpha-probe', jsonSchema: { input: () => ({ type: 'object', properties: {}, additionalProperties: false }), output: () => ({ type: 'object' }) },
      validate: value => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0 ? { value: {} } : { issues: [{ message: 'Expected empty object' }] },
    } }, execute() { executions++; return proof; },
  });
  async function connect() {
    store = await createSqliteSessionStore({ filename: join(directory, 'sessions.db') });
    sessions = createSessionManager({ namespace: 'local:integration', agentKey: 'session-live@1', store });
  }
  async function attach(session) {
    agent = await createAgent({ model: provider.use('local', 'coding'), instructions: 'Follow the user request. Use tools only when requested; recall prior tool results from the conversation.', tools: [lookup],
      plugins: [createSessionPlugin({ session })], limits: { maxModelCalls: 3, maxToolCalls: 2, timeoutMs: 90_000 },
    });
    agent.subscribe(e => { if (e.type === 'model.start') modelCalls++; });
  }
  try {
    await connect(); const session = await sessions.createSession(); await attach(session);
    const input = 'Call get_session_test_code exactly once, then report its exact value.';
    const first = await agent.prompt(input, { requestId: 'first' });
    assert.equal(first.status, 'completed'); assert.ok(first.text.includes(proof)); assert.equal(executions, 1); assert.equal(session.state.persistence.status, 'saved');
    const beforeReplay = modelCalls; assert.deepEqual(await agent.prompt(input, { requestId: 'first' }), first); assert.equal(modelCalls, beforeReplay);
    await agent.close(); await sessions.close(); await store.close();
    await connect(); const resumed = await sessions.openSession(session.id); await attach(resumed);
    const second = await agent.prompt('Repeat the exact test code you already obtained. Use the saved conversation; do not call a tool again.', { requestId: 'second' });
    assert.equal(second.status, 'completed'); assert.ok(second.text.includes(proof)); assert.equal(executions, 1); assert.equal(resumed.state.persistence.status, 'saved');
    const archive = await resumed.getSnapshot(); assert.equal(archive.data.turns.length, 2); assert.equal(archive.revision, 4);
    console.log(JSON.stringify({ status: 'passed', verified: true, endpoint: new URL(baseURL).origin, model: modelId, date: new Date().toISOString(),
      modelCalls, toolExecutions: executions, replayModelCalls: 0, archivedTurns: 2, revision: 4, reopenedSqlite: true, elapsedMs: Date.now() - started }));
  } catch (error) {
    console.log(JSON.stringify({ status: 'failed', verified: false, code: typeof error?.code === 'string' ? error.code : 'LIVE_TEST_FAILED', modelCalls, toolExecutions: executions })); process.exitCode = 1;
  } finally {
    try { await agent?.close(); } finally { try { await sessions?.close(); } finally { await store?.close(); } }
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('alpha-session-live-'));
    await rm(directory, { recursive: true, force: true });
  }
}
