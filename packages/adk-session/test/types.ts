import { createAgent } from '@alpha/adk/core';
import type { AgentEvent, ToolContext, RunResult } from '@alpha/adk/core';
import { createMemorySessionStore, createSessionManager, createSession, createSessionPlugin } from '@alpha/adk-session';
import type { SessionStore, SessionEvent } from '@alpha/adk-session';
import { createSqliteSessionStore } from '@alpha/adk-session/sqlite';

const store = createMemorySessionStore() satisfies SessionStore;
const sessions = createSessionManager({
  namespace: 'test', agentKey: 'agent@1', store,
  selectContext: ({ turns }) => turns.map(turn => turn.run.runId),
});
async function types() {
  const session = await sessions.createSession();
  const agent = await createAgent({ instructions: '', appContext: { tenant: 'one' }, plugins: [createSessionPlugin({ session })] });
  const result: RunResult = await agent.prompt('hello', { requestId: 'request' });
  result.text satisfies string;
  await agent.prompt('new request');
  if (session.state.persistence?.status === 'saved') session.state.persistence.revision satisfies number;
  // @ts-expect-error Session is not an execution object
  await session.prompt('hello');
  // @ts-expect-error cancellation belongs to Agent
  session.abort();
  const snapshot = await sessions.getSession(session.id);
  if (snapshot) {
    // @ts-expect-error readonly archive
    snapshot.data.turns.push({});
    // @ts-expect-error nested metadata is readonly JSON
    snapshot.data.metadata.x = 1;
    // @ts-expect-error readonly run result
    snapshot.data.turns[0].run.text = 'changed';
  }
  session.subscribe((event: SessionEvent) => { event.requestId satisfies string; });
  agent.subscribe((event: AgentEvent) => { event.runId satisfies string; });
  await agent.close(); await session.close(); await sessions.close(); await store.close();
  await createSession({ store, namespace: 'test', agentKey: 'agent@1', metadata: { project: 'one' } });
  await (await createSqliteSessionStore({ filename: 'session.db' })).close();
}
void types;
const context = null as unknown as ToolContext<{ tenant: string }>;
context.app.tenant satisfies string;
// @ts-expect-error Session does not create or own Agents
createSessionManager({ namespace: 'n', agentKey: 'a', store, createAgent: () => createAgent({ instructions: '' }) });
// @ts-expect-error no loop replacement through the Session package
createSessionManager({ namespace: 'n', agentKey: 'a', store, loop: {} });
