import { createAgent, createTool } from '@alpha/adk/core';
import type { Agent, AssistantMessage, Plugin, PluginAPI, ToolContext } from '@alpha/adk/core';
import { createProvider } from '@alpha/provider';
import type { GenerateResult } from '@alpha/provider';
import { z } from 'zod';

const provider = createProvider({ providers: { main: {
  adapter: 'openai-completions', options: { apiKey: { none: true } }, models: { chat: { id: 'type-test' } },
} } });
const model = provider.use('main', 'chat');
const plain = createTool({
  name: 'lookup', description: '', input: z.strictObject({ id: z.string(), nested: z.object({ value: z.number() }) }),
  execute(input, ctx) {
    const id: string = input.id;
    // @ts-expect-error schema infers string
    const wrong: number = input.id;
    // @ts-expect-error parameters are deeply readonly
    input.nested.value = 1;
    // @ts-expect-error an unbound application context is unknown
    ctx.app.tenant;
    return id;
  },
});
type App = { tenant: string };
const contextual = createTool({
  name: 'context', description: '', input: z.strictObject({ id: z.string() }),
  execute({ id }, ctx: ToolContext<App>) { return ctx.app.tenant + id; },
});
const access = {
  id: 'access', apiVersion: 1,
  setup(api) {
    api.hook('authorizeTool', (_call, ctx) => ctx.app.tenant ? { action: 'allow' } : { action: 'deny', reason: 'missing' });
  },
} satisfies Plugin<App>;

const pending: Promise<Agent<App>> = createAgent<App>({
  instructions: '', model, tools: [plain, contextual], plugins: [access], appContext: { tenant: 'x' },
});
const inferred = createAgent({ instructions: '', model, plugins: [access], appContext: { tenant: 'x' } });
const usual = createAgent({ instructions: '', model, tools: [plain] });
// @ts-expect-error agent creation is asynchronous
usual.prompt('test');
// @ts-expect-error required context missing
createAgent<App>({ instructions: '', model, tools: [contextual] });
// @ts-expect-error context incompatible with the tool
createAgent({ instructions: '', model, appContext: { other: 1 }, tools: [contextual] });
// @ts-expect-error no loop option
createAgent({ instructions: '', model, loop: {} });
// @ts-expect-error internal factory is not exported
import { createLoop } from '@alpha/adk/core';
declare const api: PluginAPI<App>;
// @ts-expect-error plugins cannot replace the loop
api.provideLoop({});
// @ts-expect-error plugins cannot invoke internal gateways
api.callModel();

declare const generated: GenerateResult;
const snapshot: AssistantMessage = { ...generated, id: 'a', role: 'assistant' };
// @ts-expect-error history calls are immutable
snapshot.toolCalls.push({ id: 'x', name: 'x', arguments: {} });
// @ts-expect-error nested JSON is immutable
snapshot.toolCalls[0].arguments.id = 'x';
void pending; void inferred;
