// HISTORICAL S1 API; superseded by adk-session-example-s2.ts. Not compatible with current S2 exports.
// Implemented S1 API. Runnable offline examples: packages/adk-session/examples/conversation.js.
import { createAgent } from '@alpha/adk/core';
import { createSessionManager } from '@alpha/adk-session';
import { createSqliteSessionStore } from '@alpha/adk-session/sqlite';
import type { LanguageModel } from '@alpha/provider';

// The application supplies its existing provider.use(...) model and authenticated scope.
export async function example(model: LanguageModel, namespace: string) {
  const store = await createSqliteSessionStore({ filename: './sessions.db' });
  const sessions = createSessionManager({
    namespace,
    agentKey: 'support-agent@1',
    store,
    createAgent: ({ signal }) => createAgent({
      model,
      instructions: '根据已有对话回答，明确区分事实与推测。',
      signal,
    }),
    // This selects context; the full archive remains available in the store.
    selectContext: ({ turns }) => turns.slice(-12).map(turn => turn.run.runId),
  });
  try {
    const session = await sessions.createSession({ title: '产品咨询' });
    const unsubscribe = session.subscribe(event => {
      if (event.type === 'agent' && event.event.type === 'model.delta') {
        console.log(event.event.text);
      }
    });
    try {
      const result = await session.prompt('请记住我的预算是 500 元。', {
        requestId: 'request-001',
      });
      console.log(result.run.status, result.persistence.status);
      if (result.persistence.status === 'pending') {
        const saved = await session.flush();
        if (saved.status === 'pending') throw new Error(saved.code);
      }
    } finally {
      unsubscribe();
      await session.close();
    }
    // Reopen after close; after a process restart, rebuild store/manager with the same
    // namespace and agentKey, then open the saved session ID in exactly this way.
    const resumed = await sessions.openSession(session.id);
    const result = await resumed.prompt('我的预算是多少？', { requestId: 'request-002' });
    if (result.persistence.status === 'pending') {
      const saved = await resumed.flush();
      if (saved.status === 'pending') throw new Error(saved.code);
    }
    console.log(result.run.text);
  } finally {
    try { await sessions.close(); }
    finally { await store.close(); }
  }
}
