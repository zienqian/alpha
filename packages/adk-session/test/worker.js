import { appendFileSync } from 'node:fs';
import { createAgent } from '@alpha/adk/core';
import { createSessionManager, createSessionPlugin } from '@alpha/adk-session';
import { createSqliteSessionStore } from '@alpha/adk-session/sqlite';
import { answer, request, model, tool, deferred } from './helpers';

const [filename, sessionId, mode, effectFile, requestId] = process.argv.slice(2);
const gates = { go: deferred(), enter: deferred(), release: deferred() };
process.on('message', message => gates[message]?.resolve());
const backing = await createSqliteSessionStore({ filename });
const store = { ...backing, async compareAndSet(k, r, d) {
  if (d?.pending && mode === 'race') { process.send({ type: 'at-admission' }); await gates.enter.promise; }
  const result = await backing.compareAndSet(k, r, d);
  if (d?.pending && result.applied && mode === 'crash-admission') { process.send({ type: 'admitted' }); await new Promise(() => {}); }
  return result;
} };
const continuation = { protocol: 'anthropic-messages', content: [{ type: 'thinking', signature: 'persist-me', thinking: 'opaque' }] };
const llm = mode === 'resume' || mode === 'inspect' ? model(answer('continued')) : model({ ...request(), continuation }, answer('saved'));
const sessions = createSessionManager({ namespace: 'test', agentKey: 'agent@1', store });
const session = await sessions.openSession(sessionId);
const agent = await createAgent({ model: llm, instructions: '', plugins: [createSessionPlugin({ session })], tools: [tool(async () => {
  appendFileSync(effectFile, `${process.pid}\n`, 'utf8'); process.send({ type: 'effect' });
  if (mode === 'crash-tool') await new Promise(() => {});
  return 'written';
}, 'write')] });
process.send({ type: 'ready' }); await gates.go.promise;
try {
  const run = await agent.prompt(mode === 'resume' ? 'follow up' : 'write', { requestId });
  const result = { run, requestId, persistence: session.state.persistence };
  process.send({ type: 'outcome', result, input: llm.inputs[0], calls: llm.inputs.length });
} catch (error) { process.send({ type: 'outcome', code: error.code, calls: llm.inputs.length }); }
await agent.close(); await sessions.close(); await backing.close(); process.disconnect();
