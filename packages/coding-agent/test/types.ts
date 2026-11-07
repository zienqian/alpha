import { createCodingAgent, codingTools, readFileTool, loadSkills, formatSkillsForPrompt, readSkill, readSkillTool } from '@alpha/coding-agent';
import type { SkillMetadata, LoadSkillsResult, SkillContent } from '@alpha/coding-agent';
import type { CodingPolicy, CodingApproval, CodingContext } from '@alpha/coding-agent';
import type { LanguageModel } from '@alpha/provider';
import { createAgent, createTool, type Agent, type ToolContext } from '@alpha/adk/core';
import { z } from 'zod';
declare const model: LanguageModel;
declare const skills: readonly SkillMetadata[];
const loaded: Promise<LoadSkillsResult> = loadSkills({ roots: [{ path: process.cwd(), source: 'project', trusted: true }] });
const summary: string = formatSkillsForPrompt(skills);
const content: Promise<SkillContent> = readSkill(skills[0]);
void [loaded, summary, content];
void createCodingAgent({ model, cwd: process.cwd(), skills, tools: [...codingTools, readSkillTool] });
const cwd = process.cwd();
const policy = { decide: () => 'ask' } satisfies CodingPolicy;
const approve: CodingApproval = (action, context) => { action.digest satisfies string; action.cwd satisfies string; context.signal satisfies AbortSignal; return 'allow'; };
const agent: Promise<Agent<CodingContext<{ tenant: string }>>> = createCodingAgent({ model, cwd, policy, approve, appContext: { tenant: 'a' }, hooks: { beforeModel: [(messages, ctx) => { ctx.app.data.tenant satisfies string; ctx.app.cwd satisfies string; return messages; }] } });
void agent;
void createCodingAgent({ model, cwd, tools: [readFileTool] });
void createCodingAgent({ model, cwd, tools: codingTools });
void createCodingAgent({ model, cwd, shell: false });
void createCodingAgent({ model, cwd, shell: '/bin/bash' });
const custom = createTool({ name: 'tenant', description: 'Read caller data', input: z.object({}),
  execute: (_args, ctx: ToolContext<CodingContext<{ tenant: string }>>) => ctx.app.data.tenant,
});
void createCodingAgent({ model, cwd, appContext: { tenant: 'a' }, tools: [...codingTools, custom] });
// @ts-expect-error Static coding tools require a CodingContext, not raw application data.
void createAgent({ model, instructions: '', appContext: { tenant: 'a' }, tools: codingTools });
// @ts-expect-error Custom tools must agree with caller application data.
void createCodingAgent({ model, cwd, appContext: { tenant: 1 }, tools: [custom] });
// @ts-expect-error A model is required.
void createCodingAgent({ cwd });
// @ts-expect-error Workspace factories and adapters are removed.
void createCodingAgent({ model, workspace: { root: cwd } });
