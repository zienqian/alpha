// Implemented R3 API, checked against the package declarations.
import { createCodingAgent, codingTools, readFileTool, searchTool } from '@alpha/coding-agent';
import type { CodingApproval, CodingPolicy, CodingContext } from '@alpha/coding-agent';
import { createTool, type ToolContext, type Plugin } from '@alpha/adk/core';
import { createSession, createSessionPlugin, type SessionStore } from '@alpha/adk-session';
import { createProvider } from '@alpha/provider';
import { z } from 'zod';

export const model = createProvider({ providers: { local: {
  adapter: 'openai-completions',
  options: { baseURL: 'http://127.0.0.1:3425/v1', apiKey: { none: true } },
  models: { coding: { id: 'codex/gpt-6.1-sol' } },
} } }).use('local', 'coding');
export const policy = {
  decide(action) { return action.kind === 'custom' ? 'deny' : action.kind === 'command' ? 'ask' : 'allow'; },
} satisfies CodingPolicy;

export async function oneTask(approve: CodingApproval) {
  const agent = await createCodingAgent({ model, cwd: process.cwd(), policy, approve });
  try { return await agent.prompt('修复分页边界问题，并运行相关测试。'); }
  finally { await agent.close(); }
}

export async function createPersistentCodingAgent(namespace: string, cwd: string, store: SessionStore, approve: CodingApproval) {
  const session = await createSession({ store, namespace, agentKey: 'coding-r3:v1' });
  try {
    const agent = await createCodingAgent({ model, cwd, policy, approve, plugins: [createSessionPlugin({ session })] });
    return { agent, session };
  } catch (cause) { await session.close(); throw cause; }
}
// Close Agent, then Session, then Store. Retry session.flush() if persistence is pending.

// Explicit tool selection and ordinary core plugins.
export async function readOnlyAgent(cwd: string) {
  const observer = {
    id: 'app/run-metrics', apiVersion: 1,
    setup(api) { api.observe(event => { if (event.type === 'run.end') console.log(event.status); }); },
  } satisfies Plugin<CodingContext<undefined>>;
  return createCodingAgent({ model, cwd, tools: [readFileTool, searchTool], plugins: [observer] });
}

// Static business tools receive application data through ctx.app.data.
export const tenantTool = createTool({ name: 'tenant', description: 'Read caller tenant', input: z.object({}),
  execute: (_args, ctx: ToolContext<CodingContext<{ tenant: string }>>) => ctx.app.data.tenant,
});
export async function businessAgent(cwd: string) {
  return createCodingAgent({ model, cwd, appContext: { tenant: 'alpha' }, tools: [...codingTools, tenantTool],
    policy: { decide: action => action.call.name === 'tenant' ? 'allow' : policy.decide(action) },
  });
}
