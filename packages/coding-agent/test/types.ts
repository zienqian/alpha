import { createCodingAgent, createWorkspacePlugin } from '@alpha/coding-agent';
import type { CodingWorkspace, CodingPolicy, CodingApproval } from '@alpha/coding-agent';
import { createLocalWorkspace } from '@alpha/coding-agent/node';
import type { LanguageModel } from '@alpha/provider';
import type { Agent } from '@alpha/adk/core';
declare const model: LanguageModel, workspace: CodingWorkspace;
const policy = { decide: () => 'ask' } satisfies CodingPolicy;
const approve: CodingApproval = (action, context) => { action.digest satisfies string; context.signal satisfies AbortSignal; return 'allow'; };
const agent: Promise<Agent<{ tenant: string }>> = createCodingAgent({ model, workspace, policy, approve, appContext: { tenant: 'a' }, hooks: { beforeModel: [(messages, ctx) => { ctx.app.tenant satisfies string; return messages; }] } });
void agent; void createWorkspacePlugin({ workspace, maxResultBytes: 4096 });
void createLocalWorkspace({ root: '.', shell: 'powershell' });
// @ts-expect-error CodingAgent is not a Session and requires a model.
void createCodingAgent({ workspace });
// @ts-expect-error Shell is selected by the host, not an arbitrary executable argument.
void createLocalWorkspace({ root: '.', shell: 'cmd.exe' });
