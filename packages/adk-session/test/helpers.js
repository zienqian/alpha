import { createAgent } from '@alpha/adk/core';
import { createMemorySessionStore, createSessionManager, createSessionPlugin } from '@alpha/adk-session';

export const answer = (text = 'done') => ({ outcome: 'completed', text, toolCalls: [], finishReason: 'stop' });
export const request = () => ({ outcome: 'tool_calls', text: '', toolCalls: [{ id: 'call', name: 'lookup', arguments: {} }], finishReason: 'tool_calls' });
export function model(...steps) {
  const inputs = [];
  return { inputs, provider: 'fixture', modelId: 'test',
    async generate() { throw new Error('stream required'); },
    async *stream(input) { inputs.push(input); const value = steps.length ? steps.shift() : answer(); const resolved = typeof value === 'function' ? await value(input) : value; yield { type: 'finish', result: resolved }; },
  };
}
export function tool(execute = () => 'ok', effect = 'read') {
  return { info: { name: 'lookup', description: '', inputSchema: { type: 'object', properties: {} }, effect }, prepare: raw => ({ arguments: raw, execute }) };
}
export function fixture(options = {}) {
  const store = options.store ?? createMemorySessionStore(), llm = options.model ?? model(), agents = [];
  const manager = createSessionManager({ namespace: 'test', agentKey: 'agent@1', store,
    ...options.manager,
  });
  async function attach(session, override = {}) {
    const agent = await createAgent({ model: llm, instructions: '', ...options.agent, ...override,
      plugins: [createSessionPlugin({ session }), ...(override.plugins ?? options.agent?.plugins ?? [])],
    });
    agents.push(agent); return { session, agent };
  }
  return { store, manager, model: llm, agents, attach,
    create: async input => attach(await manager.createSession(input)),
    open: async id => attach(await manager.openSession(id)),
    async close() { await Promise.all(agents.map(a => a.close())); await manager.close(); },
  };
}
export const deferred = () => {
  let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
};
export const tick = () => new Promise(resolve => setImmediate(resolve));
export const key = id => ({ namespace: 'test', id });
export const seed = id => ({ formatVersion: 1, id, agentKey: 'agent@1', title: '', metadata: {}, createdAt: '2026-11-04T00:00:00.000Z', updatedAt: '2026-11-04T00:00:00.000Z', turns: [], pending: null });
export const coded = code => Object.assign(new Error('private diagnostic'), { code });
