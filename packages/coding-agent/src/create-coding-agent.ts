import { canonicalCwd } from './files';
import { createAgent } from '@alpha/adk/core';
import type { Agent } from '@alpha/adk/core';
import type { CodingAgentOptions, CodingContext, CodingContextOptions } from './contracts';
import { createCodingContext } from './context';
import { createCodingPlugin } from './coding-plugin';
import { codingTools, readSkillTool, readContextTool } from './tools/index';
import { createProjectInstructionsPlugin } from './instructions-plugin';
import { createSkillsPlugin } from './skills/plugin';
import { buildCodingInstructions } from './instructions';

export async function createCodingAgent<C = undefined>(options: CodingAgentOptions<C>): Promise<Agent<CodingContext<C>>> {
  const { cwd: directory, shell, fileAccess, commandTimeoutMs, artifacts, readContext, policy, approve, onEvent, appContext, skills, tools: selectedTools, projectInstructions, plugins = [], instructions: extra, ...core } = options;
  const tools = selectedTools ?? [...codingTools, readSkillTool, ...(readContext || artifacts ? [readContextTool] : [])];
  const hasReadSkillTool = tools.includes(readSkillTool);
  const cwd = await canonicalCwd(directory);
  const context = createCodingContext<C>({ cwd, shell, fileAccess, commandTimeoutMs, artifacts, readContext, policy, approve, onEvent, appContext, skills, maxResultBytes: core.limits?.maxToolResultBytes } as CodingContextOptions<C>);
  return createAgent<CodingContext<C>>({
    ...core,
    appContext: context,
    tools,
    instructions: buildCodingInstructions(context, tools, extra),
    limits: { maxModelCalls: 24, maxToolCalls: 64, timeoutMs: 180000, ...core.limits },
    plugins: [
      createCodingPlugin(context, hasReadSkillTool, tools.includes(readContextTool)),
      ...(hasReadSkillTool ? [createSkillsPlugin(context)] : []),
      ...(projectInstructions === false ? [] : [createProjectInstructionsPlugin<CodingContext<C>>({ cwd, fileAccess: context.fileAccess, ...projectInstructions })]),
      ...plugins,
    ],
  });
}
