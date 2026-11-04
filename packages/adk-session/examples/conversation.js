import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { createAgent } from '@alpha/adk/core';
import { createMemorySessionStore, createSessionManager, createSessionPlugin } from '@alpha/adk-session';

// Offline fixture: it reads the restored user messages, with no network or credentials.
const model = {
  provider: 'offline-demo', modelId: 'budget-memory',
  async generate() { throw new Error('This fixture implements streaming only'); },
  async *stream(input) {
    const users = input.messages.filter(m => m.role === 'user');
    const budget = users.map(m => m.content).join('\n').match(/预算是\s*(\d+)\s*元/)?.[1];
    const text = users.length === 1 ? '已记录预算。' : `从恢复的 ${users.length - 1} 轮历史中找到预算：${budget ?? '未知'} 元。`;
    yield { type: 'finish', result: { outcome: 'completed', text, toolCalls: [], finishReason: 'stop' } };
  },
};
const sqlite = process.argv.includes('--sqlite');
const directory = sqlite ? await mkdtemp(join(tmpdir(), 'alpha-session-example-')) : undefined;
const openStore = sqlite
  ? async () => (await import('@alpha/adk-session/sqlite')).createSqliteSessionStore({ filename: join(directory, 'sessions.db') })
  : () => createMemorySessionStore();
const createManager = store => createSessionManager({
  namespace: 'demo:user-1', agentKey: 'budget-demo@1', store,
});
const createConversationAgent = session => createAgent({ model, instructions: '记住预算并根据历史回答。', plugins: [createSessionPlugin({ session })] });
async function prompt(agent, session, input, requestId) {
  const result = await agent.prompt(input, { requestId });
  const saved = session.state.persistence.status === 'saved' ? session.state.persistence : await session.flush();
  if (saved.status !== 'saved') throw Object.assign(new Error(saved.code), { code: saved.code });
  console.log(`${requestId}: ${result.text} [${result.status}, saved revision=${saved.revision}]`);
  return result;
}
let store, manager, agent;
try {
  store = await openStore(); manager = createManager(store);
  console.log(`Store: ${store.durability}`);
  const session = await manager.createSession({ title: '预算咨询' }), id = session.id;
  agent = await createConversationAgent(session);
  await prompt(agent, session, '请记住我的预算是 500 元。', 'request-001');
  await agent.close();
  await manager.close();
  // SQLite closes and reopens the connection. Memory must retain the same Store.
  if (sqlite) { await store.close(); store = await openStore(); }
  manager = createManager(store);
  const resumed = await manager.openSession(id);
  agent = await createConversationAgent(resumed);
  const result = await prompt(agent, resumed, '我的预算是多少？', 'request-002');
  const repeated = await agent.prompt('我的预算是多少？', { requestId: 'request-002' });
  console.log(`重复请求沿用 runId: ${result.runId === repeated.runId}`);
  console.log(`完整归档: ${(await manager.getSession(id)).data.turns.length} 轮`);
} finally {
  try { await agent?.close(); }
  finally {
    try { await manager?.close(); }
    finally {
      try { await store?.close(); }
      finally { if (directory) {
        if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('alpha-session-example-')) throw new Error('Unexpected temporary directory');
        await rm(directory, { recursive: true, force: true });
      } }
    }
  }
}
