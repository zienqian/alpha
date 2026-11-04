# Alpha ADK 技术预研：API 与运行案例

> 草案 · 2026-11-03。本文用于讨论与验证 API，不是实现文档或已完成能力清单。  
> 当前 `@alpha/adk` 只有空入口；`@alpha/provider` 已实现模型接口与协议适配。下文除明确标为“现有 Provider”的部分外，代码均为拟议 API，不能直接运行。

## 01 / 目标与边界

目标是让开发者按需要组装：**微内核提供 Agent Loop、消息/工具契约与基本运行控制；Session、Memory、Context、工具来源和观测通过模块或适配器接入。**

- 不安装 Session：每次 run 由调用方显式提供消息；ADK 不跨 run 保存对话。
- 不安装 Memory：没有跨会话检索和写入。
- 不安装 Context 模块：发送输入和本次运行新增消息；超过内核配置上限时失败。
- 不安装插件系统也可使用模型、工具和 Loop。模块负责组合能力，不是独立的持久化保证。
- 内核运行时仍需保存**本次**的消息、工具调用和流式状态；它不是零内存系统，必须限制单次运行的输入与输出大小。

### 当前状态与待验证项

| 项目 | 状态 | 证据 / 待验证 |
| --- | --- | --- |
| Provider 模型与工具消息 | 已实现 | `LanguageModel.generate/stream`、`Message`、`ToolDefinition` 和多种 outcome |
| Provider 协议续接 | 已有接口 | Anthropic continuation、Responses previousResponseId；目标服务仍需验证 |
| Agent Loop、工具执行 | 尚未实现 | ADK 当前为空包 |
| Session、Memory、模块机制 | 方案 | 尚无接口或实现 |
| ADK 直接接收 Provider 模型 | 假设 | 必须做结构类型和流式续接 POC；不兼容则使用独立 bridge |
| 下文模块包名 | 命名示意 | 均未创建、未发布；不代表已经决定物理拆包 |

本文示例暂采用 Zod 作为开发者输入 schema 的示例；是否作为依赖、如何转 JSON Schema、如何处理不支持的 schema，需要先做 POC。所有示例中 `orderService`、`permissions`、存储连接和认证上下文都是应用提供的依赖。

## 02 / 一致的 API 约定

以下统一使用 **`agent.run({ input, ... })`**，不混用 `prompt` 和 `start`。

```ts
// 设计示意：类型省略辅助字段；并非已实现 API
interface AgentOptions<App> {
  model: Model;                          // Provider 直连待 POC
  instructions?: string;
  tools?: readonly Tool<App, any>[];
  modules?: readonly AgentModule<App>[];
  limits: RunLimits;
}

interface RunOptions<App> {
  input: string;
  messages?: readonly Message[];         // 无 Session 时由调用方可选提供
  sessionId?: string;                    // 只在安装 Session 时使用
  app: App;                              // 可信服务端依赖，不传给模型
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void; // 只观察；异常隔离
}

type RunResult =
  | { status: 'completed'; text: string; messages: readonly Message[]; usage?: Usage }
  | { status: 'refused'; text: string; messages: readonly Message[]; usage?: Usage }
  | { status: 'incomplete'; text: string; messages: readonly Message[]; usage?: Usage }
  | { status: 'unknown'; messages: readonly Message[]; usage?: Usage }
  | { status: 'cancelled'; messages: readonly Message[]; usage?: Usage }
  | { status: 'failed'; error: AgentError; messages: readonly Message[]; usage?: Usage };

class Agent<App> {
  constructor(options: AgentOptions<App>);
  run(options: RunOptions<App>): Promise<RunResult>;
  close(): Promise<void>;
}
```

- `RunResult.messages` 是本次 run 新增的用户、assistant、工具消息，不是 session 的全部历史。失败或取消时只返回已确认且可表示的部分；不保证外部副作用已撤销。
- 同一个 Agent 可并发执行互不相关的 run；每次 run 的临时状态独立。Session 并发控制由 Session 模块和存储共同实现。
- `app` 由服务端从可信认证信息构造，不从模型参数中取得；不进入模型请求或 Session。
- 无 Session 时 `messages` 是既有对话，`input` 是本轮新用户文本。安装 Session 时禁止同时传 `messages`，避免历史来源不明确；此规则可在后续增加显式合并 API。
- `limits` 是内核强制边界；模块的更严格限制可以生效，但不能放宽内核上限。
- `onEvent` 为同步通知，不等待异步工作；回调抛错被隔离并交给诊断处理器。正文增量用于 UI，默认日志/trace 不记录正文。

推荐所有案例共同使用的限制：

```ts
const limits = {
  maxModelCalls: 8,
  maxToolCalls: 12,
  maxInputBytes: 256_000,
  maxToolResultBytes: 16_384,
  maxOutputBytes: 128_000,
  timeoutMs: 30_000,
};
```

字节上限限制内存和消息规模，**不等于 token 上限**。当前 Provider 没有可靠输入 token 计数。需要模型 token 窗口控制时，Context 模块须注入适用于模型的计数或保守估算能力；无法确定安全性时应返回错误。

## 03 / Case A：无 Session 的最小调用

```ts
import { createProvider } from '@alpha/provider'; // 已有包
import { Agent } from '@alpha/adk';                // 以下 API 拟议

const provider = createProvider({
  providers: {
    primary: {
      adapter: 'openai-completions',
      options: { apiKey: { env: 'MODEL_API_KEY' } },
      models: { chat: { id: 'your-model-id' } },
    },
  },
});

const agent = new Agent({
  model: provider.use('primary', 'chat'), // 直连待 POC
  instructions: '你是一个简洁的助手。',
  limits,
});

try {
  const result = await agent.run({
    input: '什么是微内核？',
    app: {},
  });
  if (result.status === 'completed') console.log(result.text);
  else console.error(result.status);
} finally {
  await agent.close();
}
```

**运行过程：** 初始化一次运行 → 校验输入大小 → 将 instructions 和 input 发送模型 → 等待 finish → 根据 Provider outcome 返回结果 → 清理本次运行。没有 Session 时第二次调用不会自动获得第一次历史。

想由应用自己维护历史，可以再次显式传入：

```ts
const second = await agent.run({
  messages: first.messages, // first 为前一次 RunResult；应用自行决定是否保存
  input: '请举一个例子。',
  app: {},
});
```

完整历史太大时由调用方处理；内核检查上限，超限失败，不无限加载或静默截断。

## 04 / Case B：定义并执行工具

```ts
import { Agent, defineTool } from '@alpha/adk';
import { z } from 'zod';

type App = { tenantId: string; orders: OrderService };

const getOrder = defineTool<App>()({
  name: 'get_order',
  description: '查询当前租户的订单状态',
  parameters: z.object({ orderId: z.string().min(1) }),
  async execute({ orderId }, { app, signal }) {
    const order = await app.orders.get(app.tenantId, orderId, { signal });
    return JSON.stringify(order);
  },
});

const agent = new Agent<App>({
  model,
  tools: [getOrder],
  instructions: '使用工具查询订单，不要编造。',
  limits,
});

const result = await agent.run({
  input: '查询订单 A123',
  app: { tenantId: authenticatedTenantId, orders: orderService },
});
```

**运行过程：**

1. 模型返回 `tool_calls` 和完整工具调用。
2. 内核检查工具是否注册、调用 ID 是否非空且在本响应中唯一；校验输入 schema。
3. 如果配置了授权模块，在执行前等待授权；拒绝时不调用工具。
4. 工具执行完毕，内核检查结果字节上限，并将结果与 `toolCallId` 关联。
5. 内核把 assistant 工具调用和对应结果返回模型；模型给出最终回答或下一轮调用。

首版工具默认串行；工具不自动重试。工具结果超限时返回明确错误，不将无限结果读入或再次发送给模型；实际工具适配器也应支持限制读取，否则工具自身仍可能在返回前占用大量内存。

**Provider 重要约束：** 只以 `finish.result.toolCalls` 为执行来源，不同时执行 stream 的 `tool-call` 事件；`refused/incomplete/unknown` 不执行工具。Anthropic continuation 原样跟随相应 assistant 消息；Responses 服务端续接是另一种策略，不能同时混入完整历史。

## 05 / Case C：流式事件、取消和终态

```ts
const controller = new AbortController();

const run = agent.run({
  input: '查询订单 A123',
  app,
  signal: controller.signal,
  onEvent(event) {
    if (event.type === 'text.delta') process.stdout.write(event.text);
    if (event.type === 'tool.started') console.log('调用工具', event.name);
  },
});

// 例如客户端断开时：controller.abort()
const result = await run;
switch (result.status) {
  case 'completed': console.log(result.text); break;
  case 'cancelled': console.log('已取消'); break;
  case 'failed': console.error(result.error.code); break;
  default: console.log('模型未正常完成：', result.status);
}
```

增量文本是暂定输出，最终以 result 和 Provider finish 为准。中途取消停止后续调用，无法撤销已完成工具副作用。`onEvent` 不提供异步反压；慢速 UI/网络客户端要在应用侧使用有界队列并自行决定溢出处理。只有错误码和必要元数据可进入默认诊断，正文和工具参数不默认导出。

## 06 / Case D：可插拔 Session + 数据库存储

```ts
// 包名均为未来建议；连接池由应用创建
import { session } from '@alpha/adk-session';
import { createPostgresSessionStore } from '@alpha/adk-session-postgres';

const store = createPostgresSessionStore({ pool });
const agent = new Agent<App>({
  model,
  tools: [getOrder],
  limits,
  modules: [
    session({
      store,
      history: { maxItems: 40, maxBytes: 128_000 },
    }),
  ],
});

const result = await agent.run({
  sessionId: 'conversation-123',
  input: '查询订单 A123',
  app,
});
```

**运行过程：** 按可信租户和 sessionId 获取会话 → 有界读取近期历史 → 组装本轮输入 → 内核运行 → 提交本轮消息。需要认证上下文参与存储寻址，应用不能直接信任用户提供的 sessionId。

```ts
interface SessionStore {
  readRecent(key: SessionKey, options: {
    maxItems: number; maxBytes: number; signal: AbortSignal;
  }): Promise<{ revision: string; messages: readonly Message[] }>;
  append(key: SessionKey, expectedRevision: string,
    messages: readonly Message[], signal: AbortSignal):
    Promise<{ revision: string }>;
}
type SessionKey = { tenantId: string; sessionId: string };
```

会话读取必须成对返回 assistant 工具调用及其结果；不能安全截取时返回明确错误。存储的 revision 比较与追加必须原子执行。**同一 Session 并发策略：**生产存储需要在 run 前取得跨进程互斥租约或直接拒绝并发；仅在结束时 CAS 不能防止两个 run 都先执行工具副作用。首版可先只支持单进程互斥的内存开发实现，分布式 lease 另做设计。

提交失败使 run 返回 `failed`，错误码标明会话提交失败；工具可能已执行，不能自动重放。应用应持有业务幂等键并进行对账。Session 保留历史，不等于未完成 run 的 checkpoint。

## 07 / Case E：Memory 可单独接入

```ts
import { memory } from '@alpha/adk-memory';

const agent = new Agent<App>({
  model,
  tools: [],
  limits,
  modules: [
    memory({
      store: memoryStore,           // 应用提供，接口见下
      identify: ({ app }) => app.userId,
      retrieve: { maxItems: 5, maxBytes: 8_000 },
      write: 'explicit',
    }),
  ],
});

// 显式写入用户确认的记忆；不要求安装 Session
await memoryStore.put({
  namespace: app.userId,
  id: 'preferred-language',
  text: '用户偏好中文回答',
});

const result = await agent.run({ input: '解释微内核', app });
```

```ts
interface MemoryStore {
  search(input: {
    namespace: string; query: string; limit: number;
    maxBytes: number; signal: AbortSignal;
  }): Promise<readonly MemoryItem[]>;
  put(item: MemoryItem): Promise<void>;
}
```

Memory 模块以当前用户输入检索有限条目，将结果作为不可信参考内容加入本次上下文；并不自动修改 Session。默认示例只接受显式写入，不把模型生成的内容自动当作事实写入长期记忆。向量检索、全文检索或数据库只是 store 的不同实现；租户隔离、删除和保留策略由存储及应用负责。具体 MemoryItem 的 id、namespace、text 和扩展元数据需在实现前定型。

## 08 / Case F：Context 管理和大小控制

```ts
import { contextWindow } from '@alpha/adk-context';

const agent = new Agent<App>({
  model,
  limits,
  modules: [
    session({ store, history: { maxItems: 40, maxBytes: 128_000 } }),
    memory({ store: memoryStore, identify: ({ app }) => app.userId,
             retrieve: { maxItems: 5, maxBytes: 8_000 }, write: 'explicit' }),
    contextWindow({
      maxInputBytes: 160_000,
      overflow: 'error',
      // 可选：适用于目标模型的 tokenizer / 保守估算器
      tokenCounter: modelTokenCounter,
      maxInputTokens: 24_000,
    }),
  ],
});
```

运行时，Session 和 Memory 分别提供**有界候选内容**；Context 模块最后合并并验证，保证工具调用和结果配对。示例选择超限报错；自动裁剪或摘要是另一个可选择策略，需要定义丢弃顺序、失败处理与成本。若启用 `maxInputTokens` 却没有可用且适用于该模型的计数策略，应在启动或运行时明确失败；不把字节数当作精确 token 数。

## 09 / Case G：权限 hooks 与插件组装

```ts
import { defineModule } from '@alpha/adk';

const authorization = defineModule<App>({
  name: 'orders.authorization',
  setup(api) {
    api.beforeToolCall(async ({ call, app, signal }) => {
      const allowed = await permissions.canUse({
        userId: app.userId,
        toolName: call.name,
        args: call.arguments,
        signal,
      });
      return allowed ? { allow: true } : { allow: false, reason: '没有权限' };
    });
  },
});

const agent = new Agent<App>({
  model,
  tools: [getOrder],
  limits,
  modules: [authorization],
});
```

这是拟议的模块 API。模块按数组顺序安装，重名失败；工具授权按注册顺序执行，一个拒绝或异常即阻止工具副作用。事件监听与授权 hook 分开，事件回调不能决定是否执行。模块在应用进程中运行，是可信代码，不构成沙箱；如需不可信模块隔离，必须另设进程与受控 RPC。

单例贡献冲突（如两个 Session 或两个 Context 管理器）构造 Agent 时失败，不隐式覆盖；多个授权 hook 按顺序组合。首版不扫描文件、不自动下载模块或热加载。

## 10 / Case H：MCP 工具与模型切换

```ts
// 未来适配器示意：连接与关闭由应用管理
const mcp = await connectMcp({ transport, signal });
try {
  const remoteTools = await mcp.listTools({ signal });
  const agent = new Agent<App>({
    model: provider.use('backup', 'chat'),
    tools: [...localTools, ...remoteTools],
    limits,
    modules: [authorization],
  });
  try {
    const result = await agent.run({ input: '查询资料', app, signal });
  } finally {
    await agent.close();
  }
} finally {
  await mcp.close();
}
```

MCP 工具转换为同一个 Tool 契约，仍经过 schema 校验、授权和限制；内核不包含 MCP 网络协议。要将旧历史迁移到新模型时，Provider 特定的 continuation 可能不能转换，应显式失败或由应用采取经过验证的迁移策略。

## 11 / 模块如何参与运行

模块是**内核扩展契约上的注册单元**，而不是每个模块都直接改写内部状态。

```text
创建 Agent：校验模块名称和单例冲突 → 按顺序注册 → 冻结配置
运行开始：认证上下文确定 session key → 可选有界读取 Session
模型调用前：可选检索 Memory → 可选 Context 合并与检查 → 内核最后检查上限
工具调用：参数校验 → 按顺序执行授权 hook → 执行工具 → 记录结果
运行结束：Session 提交本轮消息 → 返回结果 → 释放本次资源
关闭 Agent：停止接受新 run → 取消并等待活跃 run → 逆序清理模块自有资源
```

模块只能通过公开接口提供候选上下文、授权结果或观察事件，不能关闭内核限制。例外和失败：模块初始化失败则不创建 Agent；有状态模块需要明确资源所有权，应用传入的数据库连接池默认由应用关闭；Session 读取/提交失败返回 failed；Memory 检索失败默认 fail closed，也可显式配置为跳过并产生诊断；授权异常拒绝工具。

这里的流程是**目标语义**。详细的模块注册类型、生命周期接口、并发租约和支持单例的范围，需要在 POC 后冻结；示例尚不能编译。

## 12 / API 清单

| 开发者动作 | 拟议 API | 能否不装模块 |
| --- | --- | --- |
| 创建 Agent | `new Agent({ model, tools, limits })` | 可以 |
| 单次运行 | `agent.run({ input, app })` | 可以 |
| 手动传历史 | `agent.run({ messages, input, app })` | 可以 |
| 定义工具 | `defineTool()` | 可以 |
| 流式事件 | `onEvent` | 可以 |
| 取消 / 超时 | `signal` / `limits.timeoutMs` | 可以 |
| 存取会话 | `session({ store })` | 不装则由应用手动管理历史 |
| 长期记忆 | `memory({ store })` | 不装则不检索/写入 |
| 上下文控制 | `contextWindow()` | 不装仍有内核字节上限 |
| 工具授权 | `defineModule().beforeToolCall()` | 不装则仅允许显式注册工具；业务仍负责权限 |
| MCP | 工具来源适配器 | 不装可使用本地工具 |
| 追踪 / 指标 | 观察者模块 | 不装不向外导出 |

## 13 / POC 计划和验收

| 顺序 | 验证内容 | 必须观察的结果 |
| --- | --- | --- |
| 1 | 现有 Provider 的结构类型与 schema 方案 | 证明直连可编译且消息/续接可表达；否则改为独立 bridge |
| 2 | 纯 Loop + mock model/tool | 无任何模块跑通两轮调用；所有终态、参数错误和重复 toolCallId 正确处理 |
| 3 | 大输入和流式边界 | 输入、工具结果、输出超限明确失败；取消不继续执行工具；只处理一次最终工具调用 |
| 4 | Session 模块与受限 store | 有界读取、原子提交和冲突失败；故障发生后不自动重放副作用 |
| 5 | Memory / Context | 无 Session 可检索；token 计数不可用时不伪称安全；工具调用对不会被拆散 |
| 6 | 授权 / 多模块组合 | 同一策略约束本地及 MCP 适配工具；冲突、异常、关闭与资源归属明确 |
| 7 | 两个目标真实模型服务 | 验证文本、流式、工具调用、Anthropic/Responses 续接；模拟测试不代替真实服务验证 |

需要在实现前决定的事项：schema 库与 JSON Schema 子集；Provider 直连或 bridge；Session 的首个持久化后端及租约方式；Context 的 token 计数与溢出策略；工具拒绝后的终止/反馈语义。上面展示的是候选 API，不代表这些选择已经完成。

