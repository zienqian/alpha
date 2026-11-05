import { z } from 'zod';
import { createAgent, createTool } from '@alpha/adk/core';
import { createProvider } from '@alpha/provider';
import { createDemoFetch } from './demo-transport';

const live = process.argv.includes('--live');
const modelId = live ? process.env.ADK_MODEL : 'offline-demo';
if (!modelId) throw new Error('Set ADK_MODEL before running --live.');
const keyEnv = process.env.ADK_API_KEY_ENV ?? 'OPENAI_API_KEY';
const provider = createProvider({
  providers: { main: {
    adapter: 'openai-completions',
    options: {
      apiKey: live && process.env.ADK_AUTH !== 'none' ? { env: keyEnv } : { none: true },
      baseURL: live ? (process.env.ADK_BASE_URL ?? 'https://api.openai.com/v1') : 'https://offline.invalid/v1',
    },
    models: { chat: { id: modelId } },
  } },
}, live ? {} : { fetch: createDemoFetch() });

const getOrder = createTool({
  name: 'get_order',
  description: '查询演示订单状态',
  input: z.strictObject({ id: z.string().min(1).describe('订单号') }),
  effect: 'read',
  execute({ id }, { signal }) {
    signal.throwIfAborted();
    return JSON.stringify({ id, status: '已发货', source: 'demo' });
  },
});
const agent = await createAgent({
  model: provider.use('main', 'chat'),
  instructions: '查询订单必须调用 get_order，并明确结果是演示数据。',
  tools: [getOrder],
  limits: { maxModelCalls: 3, maxToolCalls: 2, timeoutMs: 90_000 },
});
try {
  console.log(live ? 'Mode: live model + demo tool' : 'Mode: offline Provider fixture');
  agent.subscribe(event => {
    if (event.type === 'model.delta') process.stdout.write(event.text);
    if (event.type === 'tool.start') console.log('\nTool: ' + event.name);
  });
  const result = await agent.prompt('请查询订单 A123 的状态。');
  console.log('\n' + JSON.stringify({ status: result.status, text: result.text }));
  if (result.status !== 'completed') process.exitCode = 1;
} finally {
  await agent.close();
}
