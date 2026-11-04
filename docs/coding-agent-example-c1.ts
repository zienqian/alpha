// Coding Agent C1 + Session S2: implemented public API, checked against package declarations.
// Local adapter: Windows + PowerShell 7 + ripgrep; other environments implement CodingWorkspace.
import { createCodingAgent, createWorkspacePlugin, createProjectInstructionsPlugin } from '@alpha/coding-agent';
import type { CodingApproval, CodingPolicy, CodingWorkspace } from '@alpha/coding-agent';
import { createLocalWorkspace } from '@alpha/coding-agent/node';
import { createAgent, createTool } from '@alpha/adk/core';
import type { Plugin } from '@alpha/adk/core';
import { createSession, createSessionPlugin } from '@alpha/adk-session';
import type { SessionStore } from '@alpha/adk-session';
import { createProvider } from '@alpha/provider';

// Same endpoint/model already verified by the core integration probe; no new model wrapper.
export const model = createProvider({ providers: { local: {
  adapter: 'openai-completions',
  options: { baseURL: 'http://127.0.0.1:3425/v1', apiKey: { none: true } },
  models: { coding: { id: 'codex/gpt-6.1-sol' } },
} } }).use('local', 'coding');

// Host permission policy is static; no definePolicy or policy registry.
export const policy = {
  decide(action) {
    if (action.kind === 'custom') return 'deny';
    return action.kind === 'command' ? 'ask' : 'allow';
  },
} satisfies CodingPolicy;

// The host supplies its own CLI/UI approval callback.
export async function oneTask(approve: CodingApproval) {
  const workspace = await createLocalWorkspace({ root: process.cwd(), shell: 'powershell' });
  try {
    const agent = await createCodingAgent({ model, workspace, policy, approve });
    try {
      const result = await agent.prompt('修复分页 cursor 的边界问题，并运行相关测试。');
      return result; // ordinary core RunResult; completed does not by itself prove tests passed
    } finally { await agent.close(); }
  } finally { await workspace.close(); }
}

// Application composition example; Session does not create or own the Agent.
export async function createPersistentCodingAgent(namespace: string, workspace: CodingWorkspace, store: SessionStore, approve: CodingApproval) {
  const session = await createSession({
    store, namespace, agentKey: `coding-c1:${workspace.id}:v1`,
  });
  try {
    const agent = await createCodingAgent({
      model, workspace, policy, approve,
      plugins: [createSessionPlugin({ session })],
    });
    return { agent, session };
  } catch (cause) { await session.close(); throw cause; }
}
// Call agent.prompt(input, { requestId }); inspect session.state.persistence separately.
// Keep the Session for flush if saving fails. Close Agent, then Session, then borrowed resources.

// Fully explicit assembly uses the same core factory and plugin contract.
export async function explicitAssembly(workspace: CodingWorkspace, approve: CodingApproval) {
  const observer = {
    id: 'app/run-metrics', apiVersion: 1,
    setup(api) { api.observe(event => { if (event.type === 'run.end') console.log(event.status); }); },
  } satisfies Plugin;
  return createAgent({
    model, instructions: '先读取目标文件；做必要修改；用真实测试结果判断是否修复。',
    plugins: [
      createWorkspacePlugin({ workspace, policy, approve }),
      createProjectInstructionsPlugin({ workspace }),
      observer,
    ],
  });
}

// Custom business tools still use the existing createTool + single input schema.
export { createTool };
