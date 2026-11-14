import { test, expect } from 'bun:test';
import { createAgent, estimateContextTokens } from '@alpha/adk/core';
import { createContextManager } from '../src/index';
import { createSqliteContextStore } from '../src/sqlite';

const answer = text => ({ outcome: 'completed', text, toolCalls: [], finishReason: 'stop' });
const state = JSON.stringify({ objective: ['Implement context management'], constraints: ['No Memory. Source: u0'], decisions: [], completed: [], inProgress: [], failures: [], validation: [], nextSteps: ['Continue'], evidence: ['u0'] });
function history(size = 12, length = 5000) {
  return Array.from({ length: size }, (_, i) => [{ id: `u${i}`, role: 'user', content: `${i ? 'task' : 'No Memory'} ${'中文/code/😀'.repeat(Math.floor(length / 12))}` },
    { id: `a${i}`, role: 'assistant', ...answer('result '.repeat(Math.floor(length / 14))) }]).flat();
}
function model(generate = async () => answer(state), stream) {
  const inputs = [], summaries = [];
  return { provider: 'fake', modelId: 'test', inputs, summaries,
    async generate(input) { summaries.push(input); return generate(input); },
    async *stream(input) { inputs.push(input); if (stream) yield* stream(input); else yield { type: 'finish', result: answer('done') }; },
  };
}
async function fixture(options = {}, suppliedModel = model()) {
  const events = [];
  const manager = createContextManager({ namespace: 'project', sessionId: 'session', contextWindow: 32000, maxOutputTokens: 1024, onEvent: e => events.push(e), ...options });
  await manager.load();
  const agent = await createAgent({ model: suppliedModel, instructions: 'Fixed system instructions.', plugins: [manager.plugin()],
    limits: { maxModelCalls: 20, maxHistoryBytes: null, maxHistoryMessages: null } });
  return { manager, agent, model: suppliedModel, events };
}

test('input references are used for budget counts and compaction without changing canonical evidence', async () => {
  const document = 'DOCUMENT-BODY'.repeat(10000);
  const source = [{ id: 'user', role: 'user', content: 'Create report ' + 'requirements '.repeat(700) },
    { id: 'write', role: 'assistant', ...answer(''), outcome: 'tool_calls', finishReason: 'tool_calls', toolCalls: [{ id: 'c', name: 'create_file', arguments: { path: 'report.html', content: document } }] },
    { id: 'saved', role: 'toolResult', assistantId: 'write', callId: 'c', execution: 'succeeded', content: 'Saved artifact' },
    { id: 'reply', role: 'assistant', ...answer('Report ready') }];
  const references = [{ assistantId: 'write', callId: 'c', field: 'content', reference: 'context://saved-document' }];
  const f = await fixture({ contextWindow: 16000, toolInputReferences: () => references });
  try {
    f.agent.replaceMessages(source);
    expect((await f.agent.prompt('continue')).status).toBe('completed');
    expect(f.model.summaries).toHaveLength(0);
    expect(JSON.stringify(f.model.inputs[0])).not.toContain('DOCUMENT-BODY');
    expect(estimateContextTokens(f.model.inputs[0])).toBeLessThan(5000);
    expect(f.agent.state.messages.slice(0, source.length)).toEqual(source);
    await f.agent.compact();
    expect(JSON.stringify(f.model.summaries)).not.toContain('DOCUMENT-BODY');
    expect(JSON.stringify(f.model.summaries)).toContain('context://saved-document');
  } finally { await f.agent.close(); }
});

test('automatic compaction preserves canonical history, anchors, structured state and actual output reservation', async () => {
  const f = await fixture();
  const source = history(); f.agent.replaceMessages(source);
  const result = await f.agent.prompt('Continue; do not implement Memory.');
  expect(result.status).toBe('completed');
  expect(f.agent.state.messages.slice(0, source.length)).toEqual(source);
  expect(f.manager.checkpoint.coverage).toBeGreaterThan(0);
  const input = f.model.inputs[0];
  expect(input.messages[0].content).toBe('Fixed system instructions.');
  expect(input.messages.at(-1).content).toContain('do not implement Memory');
  expect(input.messages.some(m => m.role === 'assistant' && m.content.includes('SESSION WORK STATE'))).toBe(true);
  expect(input.maxOutputTokens).toBe(1024);
  expect(estimateContextTokens(input)).toBeLessThan(26880);
  expect(f.model.summaries.every(i => i.tools.length === 0 && i.maxOutputTokens > 0)).toBe(true);
  expect(f.events.map(e => e.type)).toContain('end');
  await f.agent.close();
});

test('five incremental manual compactions carry prior state without recopying the archive', async () => {
  const f = await fixture();
  for (let i = 0; i < 5; i++) {
    const source = history(3 + i, 1200); f.agent.replaceMessages(source);
    await f.agent.compact();
    expect(f.manager.checkpoint.generation).toBe(i + 1);
    expect(f.agent.state.messages).toEqual(source);
  }
  expect(f.model.inputs).toHaveLength(0);
  expect(f.model.summaries[1].messages[0].content).toContain('No Memory. Source: u0');
  const newMessages = f.model.summaries[1].messages[0].content.split('New source messages')[1];
  expect(newMessages).not.toContain('"id":"u0"');
  await f.agent.close();
});

test('unknown window disables auto; auto off keeps hard budget and still allows manual compaction', async () => {
  const unknown = await fixture({ contextWindow: undefined });
  unknown.agent.replaceMessages(history(3));
  expect((await unknown.agent.prompt('continue')).status).toBe('completed');
  expect(unknown.model.summaries).toHaveLength(0);
  await expect(unknown.agent.compact()).rejects.toMatchObject({ code: 'CONTEXT_WINDOW_UNKNOWN' });
  await unknown.agent.close();
  const disabled = await fixture({ auto: false });
  disabled.agent.replaceMessages(history(20));
  expect((await disabled.agent.prompt('continue')).status).toBe('failed');
  expect(disabled.model.inputs).toHaveLength(0);
  await disabled.agent.compact();
  expect(disabled.manager.checkpoint).toBeDefined();
  await disabled.agent.close();
});

test('latest parallel batch and injected instructions survive the final projection', async () => {
  const m = model(); const manager = createContextManager({ namespace: 'p', sessionId: 's', contextWindow: 32000, maxOutputTokens: 1024 });
  const batch = [{ id: 'batch', role: 'assistant', outcome: 'tool_calls', text: '', finishReason: 'tool_calls', toolCalls: [1, 2].map(i => ({ id: `c${i}`, name: 'read', arguments: {} })) },
    ...[1, 2].map(i => ({ id: `r${i}`, role: 'toolResult', assistantId: 'batch', callId: `c${i}`, execution: 'succeeded', content: `evidence${i}` }))];
  const agent = await createAgent({ model: m, instructions: 'system', plugins: [manager.plugin()], hooks: { beforeModel: [messages => [{ id: crypto.randomUUID(), role: 'user', content: 'Project AGENTS instructions' }, ...messages]] }, limits: { maxHistoryBytes: null, maxHistoryMessages: null } });
  agent.replaceMessages([...history(8), ...batch, ...history(4).map(x => ({ ...x, id: 'new-' + x.id }))]);
  await agent.prompt('continue');
  const input = m.inputs[0];
  expect(input.messages.filter(m => m.role === 'tool').map(m => m.content)).toEqual(['evidence1', 'evidence2']);
  expect(input.messages.some(m => m.content === 'Project AGENTS instructions')).toBe(true);
  await agent.close();
});

test('invalid summaries retry once and cannot replace the previous checkpoint', async () => {
  let bad = false;
  const f = await fixture({}, model(async () => answer(bad ? 'not JSON' : state)));
  f.agent.replaceMessages(history(3)); await f.agent.compact();
  const saved = f.manager.checkpoint;
  f.agent.replaceMessages(history(4)); bad = true;
  await expect(f.agent.compact()).rejects.toMatchObject({ code: 'CONTEXT_COMPACTION_FAILED' });
  expect(f.manager.checkpoint).toEqual(saved);
  expect(f.model.summaries).toHaveLength(3);
  await f.agent.close();
});

test('cancel and close discard late summaries even with an uncooperative provider', async () => {
  let entered; const started = new Promise(resolve => { entered = resolve; });
  let finish;
  const f = await fixture({}, model(() => { entered(); return new Promise(resolve => { finish = resolve; }); }));
  f.agent.replaceMessages(history(4));
  const work = f.agent.compact(); await started;
  f.agent.abort(); await expect(work).rejects.toBeDefined();
  finish(answer(state)); await Promise.resolve();
  expect(f.manager.checkpoint).toBeUndefined();
  await f.agent.close();
});

test('steering aborts the candidate and pins both current user messages in the resumed request', async () => {
  let entered; const started = new Promise(resolve => { entered = resolve; }); let first = true;
  const f = await fixture({}, model(async input => {
    if (first) { first = false; entered(); await new Promise((_, reject) => input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true })); }
    return answer(state);
  }));
  f.agent.replaceMessages(history());
  const work = f.agent.prompt('original objective'); await started;
  const steered = f.agent.steer('new constraint');
  expect(await steered).toBe(true); expect((await work).status).toBe('completed');
  const input = f.model.inputs[0];
  expect(input.messages.some(m => m.content === 'original objective')).toBe(true);
  expect(input.messages.some(m => m.content === 'new constraint')).toBe(true);
  expect(f.manager.checkpoint.generation).toBe(1);
  await f.agent.close();
});

test('checkpoints save only against committed sources and survive append/restart; changed prefixes invalidate them', async () => {
  const store = createSqliteContextStore(':memory:');
  const f = await fixture({ store }); const source = history(4);
  f.agent.replaceMessages(source); await f.agent.compact();
  await f.manager.persist([]); expect(await store.read('project', 'session')).toBeUndefined();
  await f.manager.persist(source);
  const g = await fixture({ store }); g.agent.replaceMessages([...source, { id: 'append', role: 'user', content: 'next' }]);
  await g.agent.prompt('continue'); expect(g.model.summaries).toHaveLength(0);
  expect(g.model.inputs[0].messages.some(m => m.content.includes('SESSION WORK STATE'))).toBe(true);
  const h = await fixture({ store }); h.agent.replaceMessages(source.map((m, i) => i === 0 ? { ...m, content: 'Changed source' } : m));
  await h.agent.prompt('continue'); expect(h.model.inputs[0].messages.some(m => m.content.includes('SESSION WORK STATE'))).toBe(false);
  const other = await fixture({ store, sessionId: 'new-session' }); expect(other.manager.checkpoint).toBeUndefined();
  await Promise.all([f.agent.close(), g.agent.close(), h.agent.close(), other.agent.close()]); store.close();
});

test('checkpoint CAS rejects a stale writer and repeated acknowledgements are harmless', async () => {
  const store = createSqliteContextStore(':memory:');
  const f = await fixture({ store }); const source = history(4);
  f.agent.replaceMessages(source); await f.agent.compact(); await f.manager.persist(source);
  const cp = f.manager.checkpoint;
  expect(await store.write({ ...cp, id: 'new' }, cp.id)).toBe(true);
  expect(await store.write({ ...cp, id: 'stale' }, cp.id)).toBe(false);
  await f.manager.persist(source); expect((await store.read('project', 'session')).id).toBe('new');
  store.remove('project', 'session');
  expect(await store.read('project', 'session')).toBeUndefined();
  expect(await store.write(cp, 'new')).toBe(false);
  expect(await store.write(cp)).toBe(false);
  await f.agent.close(); store.close();
});

test('typed overflow retries only the uncommitted model request, never tools; partial streams do not retry', async () => {
  let calls = 0;
  const f = await fixture({}, model(undefined, async function* () {
    if (++calls === 1) throw Object.assign(new Error('private'), { code: 'CONTEXT_LENGTH_EXCEEDED' });
    yield { type: 'finish', result: answer('recovered') };
  }));
  f.agent.replaceMessages(history(4));
  expect((await f.agent.prompt('continue')).text).toBe('recovered');
  expect(calls).toBe(2); expect(f.manager.checkpoint).toBeDefined(); await f.agent.close();
  const partial = await fixture({ auto: false }, model(undefined, async function* () {
    yield { type: 'text-delta', text: 'visible' }; throw Object.assign(new Error(), { code: 'CONTEXT_LENGTH_EXCEEDED' });
  }));
  partial.agent.replaceMessages(history(4));
  expect((await partial.agent.prompt('continue')).status).toBe('failed');
  expect(partial.model.inputs).toHaveLength(1); expect(partial.model.summaries).toHaveLength(0); await partial.agent.close();
});

test('auxiliary summary calls consume the run model-call budget', async () => {
  const manager = createContextManager({ namespace: 'p', sessionId: 's', contextWindow: 32000, maxOutputTokens: 1024 }); const m = model();
  const agent = await createAgent({ model: m, instructions: '', plugins: [manager.plugin()], limits: { maxModelCalls: 1, maxHistoryBytes: null, maxHistoryMessages: null } });
  agent.replaceMessages(history());
  const result = await agent.prompt('continue');
  expect(result.status).toBe('limited'); expect(m.summaries).toHaveLength(1); expect(m.inputs).toHaveLength(0);
  await agent.close();
});

test('kernel rejects duplicate providers and attempts to drop protected user anchors', async () => {
  const f = createContextManager({ namespace: 'p', sessionId: 's' });
  await expect(createAgent({ model: model(), instructions: '', plugins: [f.plugin(), { id: 'other', apiVersion: 1, setup(api) { api.provideModelContext({ prepare() { throw new Error(); } }); } }] })).rejects.toMatchObject({ code: 'PLUGIN_CONFLICT' });
  const agent = await createAgent({ model: model(), instructions: '', plugins: [{ id: 'bad', apiVersion: 1, setup(api) { api.provideModelContext({ prepare() { return { messageIds: [], maxOutputTokens: 100 }; } }); } }] });
  expect((await agent.prompt('must keep')).error.code).toBe('MODEL_PROTOCOL'); await agent.close();
});
