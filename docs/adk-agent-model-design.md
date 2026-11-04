# Alpha ADK 实体模型设计：参考 Pi Agent

> 状态：重新设计的讨论稿 · 2026-11-03。本文替代此前以 Runtime / Executor 为中心的实体方案；代码均为拟议 API，尚未实现。

## 1. 先说结论

Alpha ADK 的中心对象应该是一个**有状态的 Agent 实例**：它拥有配置、当前对话消息和运行状态；调用 `prompt()` 推进一次对话。底层 `agentLoop()` 只接受一次执行所需的上下文、配置和依赖，执行模型与工具循环并发出事件。Session、插件加载和应用级服务建立在其外层。

```text
应用 / Coding Agent
  ├─ 创建 Agent、工具、插件
  ├─ Session 存储与恢复（可选）
  └─ Plugin Host（可选）
          │ 订阅事件 / 注册 hooks
          ▼
       Agent  ← 持有 AgentState；提供 prompt、abort、subscribe
          │
          ▼
      agentLoop ← AgentContext + AgentLoopOptions
          ├─ model adapter → @alpha/provider 的 LanguageModel
          └─ AgentTool[]
```

本图描述建议的逻辑分层；不要求第一版拆分为多个 npm 包。Agent 可以脱离 Plugin Host 和 Session 独立工作。

## 2. Pi 的实体与我们借鉴什么

以下是对 Pi 源码和官方 README 的归纳，不是 Alpha 已实现的功能：

| Pi 实体 | Pi 中的职责 | Alpha 的选择 |
| --- | --- | --- |
| Agent | 有状态的入口，管理对话、运行生命周期和订阅 | 作为一等实体；同一实例一次只执行一个 run |
| AgentState | system prompt、model、tools、messages 和流式状态 | 显式暴露只读快照；配置变化通过方法完成 |
| AgentContext | 一次 loop 的 system prompt、消息和工具 | 在每次运行开始时从 AgentState 投影 |
| AgentMessage | 会话中的消息，可扩展；与模型输入区分 | 建立 AgentMessage → Provider Message 的明确转换 |
| AgentTool / AgentToolResult | 工具定义与执行结果 | 加入参数校验、取消和结构化结果 |
| AgentEvent | agent、turn、message、tool 生命周期事件 | 保留清晰层级，区分增量与最终消息 |
| agentLoop | 不依赖上层 UI 的底层循环 | 暴露低层函数，并由 Agent 调用 |
| Extension / Session | 由 coding-agent 层组织，扩展工具、事件及应用行为 | 初期放在 ADK 上层可选模块，不使 Agent 依赖文件系统或 UI |

Pi 的具体字段与行为会随版本变化；这里参考其边界，不承诺 API 兼容。参考：[Pi Agent 类型](https://github.com/earendil-works/pi/blob/main/packages/agent/src/types.ts)、[Agent 实现](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent.ts)、[Agent README](https://github.com/earendil-works/pi/blob/main/packages/agent/README.md)、[底层循环](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts)、[Coding Agent 扩展](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)。

## 3. 核心实体与关系

| 实体 | 包含什么 | 谁创建 / 持有 | 生命周期 |
| --- | --- | --- | --- |
| Agent | 配置、消息、当前运行状态、事件订阅 | 应用创建并持有 | 可跨多次 prompt |
| AgentState | Agent 的公开状态快照 | Agent 构造并维护 | 随 Agent 更新 |
| AgentContext | 本次循环使用的 prompt、工具与消息 | Agent 在运行开始时创建 | 一次 run |
| AgentMessage | user、assistant、toolResult 或自定义消息 | 应用和 loop 共同产生，Agent 保存 | 跨多次 prompt |
| AgentTool | 工具 schema 与执行函数 | 应用定义，Agent 引用 | 可被多个 Agent 复用 |
| AgentEvent | 运行过程中发生的事实 | loop 产生，Agent 转发 | 一次 run |
| AgentHooks | 在明确阶段检查或转换行为 | 应用或 Plugin Host 注册 | 一次 Agent 或一次 run |
| ModelAdapter | Alpha 消息与 Provider 协议的转换 | 应用或官方适配器提供 | 可复用 |
| SessionStore | 持久化历史和元信息 | 外层应用持有 | 可跨进程；首版可不实现 |

明确三个容易混淆的词：**run** 是一次 prompt 引发的完整执行；**turn** 是一次模型调用及其后续工具处理；**message** 是历史中的一条消息。一个 run 可以包含多个 turn，一个 turn 可以产生 assistant 和多个 toolResult 消息。

## 4. Agent：主要使用入口

```ts
interface AgentOptions<App = unknown> {
  systemPrompt: string;
  model: AgentModel;
  tools?: readonly AgentTool<App, any>[];
  messages?: readonly AgentMessage[];
  appContext: App;              // 不自动发给模型或持久化
  hooks?: AgentHooks<App>;
  limits?: { maxTurns?: number; timeoutMs?: number };
}

interface AgentState {
  readonly systemPrompt: string;
  readonly modelId: string;
  readonly tools: readonly ToolInfo[];
  readonly messages: readonly AgentMessage[];
  readonly status: 'idle' | 'running';
  readonly streamingMessage?: AssistantMessage;
  readonly pendingToolCalls: readonly string[];
  readonly lastError?: AgentError;
}

class Agent<App = unknown> {
  constructor(options: AgentOptions<App>);
  get state(): AgentState;       // 只读快照，不是可修改内部数组的引用
  prompt(input: string | UserMessage, options?: PromptOptions): Promise<AgentRunResult>;
  abort(reason?: unknown): void;
  waitForIdle(): Promise<void>;
  subscribe(listener: (event: AgentEvent) => void): () => void;
  setModel(model: AgentModel): void;
  setTools(tools: readonly AgentTool<App, any>[]): void;
  setSystemPrompt(text: string): void;
  replaceMessages(messages: readonly AgentMessage[]): void;
}
```

与 Pi 可直接更改部分 state 的方式不同，Alpha 建议对外提供只读快照和明确修改方法，以便控制并发和校验。运行中 `prompt`、`setModel`、`setTools`、`setSystemPrompt` 和 `replaceMessages` 抛出 `AGENT_BUSY`；运行中的用户插话暂不实现。未来的 steer/follow-up 需要明确消息注入时机，不先承诺。

`prompt()` 同步检查输入和 busy 状态；启动后返回 Promise。完成、拒答和不完整结果以状态返回；取消返回 cancelled，模型或工具基础设施故障返回 failed。程序员配置错误在启动时抛出。执行结束后 `status` 恢复 idle，`waitForIdle()` resolve。取消只尽力终止后续操作，不能撤销已产生的外部副作用。

```ts
type AgentRunResult =
  | { status: 'completed'; messages: readonly AgentMessage[]; text: string }
  | { status: 'refused'; messages: readonly AgentMessage[]; text: string }
  | { status: 'incomplete'; messages: readonly AgentMessage[]; reason?: string }
  | { status: 'unknown'; messages: readonly AgentMessage[] }
  | { status: 'cancelled'; messages: readonly AgentMessage[] }
  | { status: 'failed'; messages: readonly AgentMessage[]; error: AgentError };
```

这里的 `messages` 是**本次 run 新增并纳入 AgentState 的消息**，不是全部历史。运行时快照与返回值不包含密钥；`appContext` 不保证可序列化。

## 5. AgentState、AgentContext 与 Message

### 5.1 State 与 Context 的区别

`AgentState` 是 Agent 对外可观察的当前状态；`AgentContext` 是某次 run 开始时传给 loop 的配置和消息快照。loop 通过事件和最终结果向 Agent 返回变化，不直接把外部可变数组当状态仓库。

```ts
interface AgentContext<App> {
  readonly systemPrompt: string;
  readonly model: AgentModel;
  readonly tools: readonly AgentTool<App, any>[];
  readonly messages: readonly AgentMessage[];
  readonly appContext: App;
}
```

上下文快照复制数组；工具、model、appContext 和函数按引用持有。引用对象如含共享可变状态，由应用保证并发安全。一次 run 开始后配置不被外部修改；loop 内部维护自己的消息副本。Agent 是唯一状态持有者，按事件顺序更新其快照。

### 5.2 消息模型

```ts
type AgentMessage =
  | UserMessage
  | AssistantMessage
  | ToolResultMessage
  | CustomMessage;

interface UserMessage {
  role: 'user';
  content: string;
}

interface AssistantMessage {
  role: 'assistant';
  content: string;
  toolCalls: readonly ToolCall[];
  outcome: 'completed' | 'tool_calls' | 'refused' | 'incomplete' | 'unknown';
  continuation?: ModelContinuation; // opaque；只由对应 model adapter 消费
}

interface ToolResultMessage {
  role: 'toolResult';
  toolCallId: string;
  toolName: string;
  content: string;
  isError: boolean;
}

interface CustomMessage {
  role: 'custom';
  type: string;
  data: unknown; // 是否可序列化由应用与 session 实现约定
}
```

模型看到的消息由 `convertMessages` 投影。它将 user / assistant / toolResult 映射到 Provider 的 `Message`；自定义消息必须由应用明确转换或过滤。转换应保留工具调用与工具结果的配对关系，不可将缺少结果的 assistant 工具调用静默发送给模型。消息历史不是自动可恢复执行的 checkpoint。

在 Alpha Provider 当前实现里，Anthropic assistant 消息可能需要原样带上 `continuation`；Responses `previousResponseId` 则有增量消息与服务端状态的独立语义。适配器必须标识续接数据所属模型与协议、避免日志泄露；无法安全续接或换模型时显式失败。默认先验证无状态历史模式，Responses 服务端续接作为单独策略。

## 6. 工具：定义、调用与结果

```ts
interface ToolSchema<I> {
  readonly jsonSchema: JsonObject;
  parse(value: unknown): I;
}
interface AgentTool<App, Input> {
  readonly name: string;
  readonly description: string;
  readonly parameters: ToolSchema<Input>;
  readonly effect: 'read' | 'write' | 'unknown';
  execute(input: Input, ctx: ToolContext<App>): Promise<AgentToolResult>;
}
interface ToolContext<App> {
  readonly toolCallId: string;
  readonly signal: AbortSignal;
  readonly app: App;
  reportProgress(text: string): void;
}
interface AgentToolResult {
  readonly content: string;  // 回传模型
  readonly details?: unknown; // 应用侧元数据，不自动发给模型或持久化
  readonly isError?: boolean;
}
```

工具名称在 Agent 中唯一。执行前先整体校验同一个模型响应中的 toolCallId 非空且不重复，再对每个调用校验工具存在、解析参数、执行 hook 与策略。首版串行，不自动重试；`effect` 仅为声明，不是权限证明。工具进度不进入模型消息，是否落盘由应用决定。

## 7. Agent loop 与事件

底层 loop 接口只围绕它真正需要的实体，不要求先创建一个独立 Runtime 或 Executor：

```ts
interface AgentLoopOptions<App> {
  readonly hooks?: AgentHooks<App>;
  readonly signal: AbortSignal;
  readonly maxTurns: number;
  readonly emit: (event: AgentEvent) => void;
}
function agentLoop<App>(
  context: AgentContext<App>,
  options: AgentLoopOptions<App>,
): Promise<AgentRunResult>;
```

执行概览：Agent 先加入用户消息 → 发出 agent.start → loop 调用模型 → 完成 assistant 消息 → 若为 tool_calls，依次校验并执行工具、加入 toolResult → 再调用模型 → 生成终态 → 发出 agent.end。

```ts
type AgentEvent =
  | { type: 'agent.start'; runId: string }
  | { type: 'turn.start'; runId: string; turn: number }
  | { type: 'message.start'; runId: string; message: AgentMessage }
  | { type: 'message.delta'; runId: string; text: string }
  | { type: 'message.end'; runId: string; message: AgentMessage }
  | { type: 'tool.start'; runId: string; toolCallId: string; name: string }
  | { type: 'tool.progress'; runId: string; toolCallId: string; text: string }
  | { type: 'tool.end'; runId: string; toolCallId: string; isError: boolean }
  | { type: 'turn.end'; runId: string; turn: number }
  | { type: 'agent.end'; runId: string; status: AgentRunResult['status'] };
```

事件在单 run 内顺序分发。订阅者同步收到事件；抛出的异常被隔离并交由应用的错误处理器，不影响运行，也不等待订阅者的异步工作。需要在工具执行前强制授权或等待异步检查，应使用 hook，不能靠订阅者。应用要自行限制事件处理队列大小。事件正文可能敏感，默认不自动写入日志或传输。

Provider 的 `text-delta` 是暂定内容；只在收到有效 finish 后确定 assistant 最终结果。Provider 同时提供的 `tool-call` 事件和 `finish.result.toolCalls` 只能选一处执行：Alpha 以 finish 的最终列表为准。拒答、不完整、unknown 不执行工具。首版仅在模型调用边界应用 `maxTurns`；工具外部副作用不会因取消而回滚。

若工具执行中取消，已实际完成的工具结果保留，未开始的工具记录为取消结果，保证 assistant 工具调用与 toolResult 配对。若因为协议损坏无法构造可信配对，停止后将这组消息标为不可续接，不能悄悄送回模型；具体存储形式在实现时通过契约测试确定。

## 8. Hooks：先用具体生命周期，不先设计万能中间件

Hooks 可以异步，并在定义的边界串行等待；它们能改变运行，与只读事件订阅不同。

```ts
interface AgentHooks<App> {
  beforeModel?: (ctx: HookContext<App>, messages: readonly AgentMessage[]) =>
    Promise<readonly AgentMessage[] | void>;
  beforeTool?: (ctx: HookContext<App>, call: ValidatedToolCall) =>
    Promise<{ action: 'allow' } | { action: 'deny'; reason: string }>;
  afterTool?: (ctx: HookContext<App>, call: ValidatedToolCall,
               result: AgentToolResult) => Promise<AgentToolResult | void>;
}
interface HookContext<App> {
  readonly runId: string;
  readonly signal: AbortSignal;
  readonly app: App;
}
```

| hook | 时机 | 允许的行为 | 失败处理 |
| --- | --- | --- | --- |
| beforeModel | 每次模型调用前 | 返回供本次转换的消息副本；不修改 AgentState | 抛错则 run failed；转换后重新检查消息配对 |
| beforeTool | schema 校验后、副作用前 | 允许或拒绝 | 抛错则 fail closed；拒绝转为安全的工具错误结果 |
| afterTool | 工具结束后、消息保存前 | 检查并替换回传内容 | 抛错则 run failed；原始副作用可能已经发生，不能重试 |

工具返回 `details` 可能含敏感信息；hook 和应用负责最小化使用。工具拒绝是独立的 toolResult，允许模型继续解释或调整；若应用希望直接终止，由独立策略配置明确控制，首版不混入 hook 返回值。

## 9. 插件：在上层组合工具和 hooks

插件是可选的组装机制。底层 Agent 本身只认识工具、hooks 和订阅；它不扫描目录、不知道配置文件、不负责执行任意第三方代码。

```ts
interface AgentPlugin<App> {
  readonly name: string;
  setup(api: PluginAPI<App>): void;
}
interface PluginAPI<App> {
  registerTool<I>(tool: AgentTool<App, I>): void;
  onBeforeModel(hook: NonNullable<AgentHooks<App>['beforeModel']>): void;
  onBeforeTool(hook: NonNullable<AgentHooks<App>['beforeTool']>): void;
  onAfterTool(hook: NonNullable<AgentHooks<App>['afterTool']>): void;
  onEvent(listener: (event: AgentEvent) => void): void;
}
```

`createAgentWithPlugins(options, plugins)` 由上层实现，按插件数组顺序同步 setup、检查名称/工具冲突并创建 Agent；失败时不创建 Agent。相同 hook 按注册顺序运行：beforeModel 每次接收前一个 hook 的结果；beforeTool 遇到首个 deny 即停止；afterTool 依次接收前一个结果。hook 抛错终止，不执行剩余 hook。事件监听异常隔离。初版无动态加载、异步启动和热卸载；需要这些能力时再独立设计。插件以应用权限运行，不是沙箱。

```ts
const authPlugin: AgentPlugin<App> = {
  name: 'example.auth',
  setup(api) {
    api.onBeforeTool(async ({ app }, call) =>
      app.allowedTools.has(call.name)
        ? { action: 'allow' }
        : { action: 'deny', reason: '当前用户没有此工具的权限' },
    );
  },
};
```

## 10. 使用示例

```ts
import { createProvider } from '@alpha/provider';
import { Agent, adaptProviderModel, defineTool } from '@alpha/adk';

// 所有 @alpha/adk API 均为方案示意，目前仓库尚未实现。
const provider = createProvider(providerConfig);
const model = adaptProviderModel(provider.use('primary', 'chat'));

const getOrder = defineTool<App, { id: string }>({
  name: 'get_order',
  description: '查询订单状态',
  parameters: orderIdSchema, // 应用提供 { jsonSchema, parse }
  effect: 'read',
  async execute({ id }, { app, signal }) {
    const order = await app.orders.get(id, { signal });
    return { content: JSON.stringify(order) };
  },
});

const agent = new Agent<App>({
  systemPrompt: '帮助用户查询订单。',
  model,
  tools: [getOrder],
  appContext: { orders, allowedTools },
  hooks: {
    beforeTool: async ({ app }, call) =>
      app.allowedTools.has(call.name)
        ? { action: 'allow' }
        : { action: 'deny', reason: '无权调用该工具' },
  },
});

const unsubscribe = agent.subscribe((event) => {
  if (event.type === 'message.delta') process.stdout.write(event.text);
});
const first = await agent.prompt('查询订单 A123');
const second = await agent.prompt('它什么时候送达？');
console.log(agent.state.messages); // 该 Agent 的跨轮历史
unsubscribe();
```

应用可以用普通函数创建多个 Agent，也可以调用低层 `agentLoop` 自己管理状态。Agent 实例本身不隐式共享对话历史或工具权限。

## 11. Session 和其他外层能力

Session 负责把经过应用策略处理的消息和元数据保存、重新加载；它不等于 AgentState，也不是崩溃恢复执行的 checkpoint。第一版 Agent 不自动绑定存储。应用可在 run 结束后保存快照、启动时显式加载；持久化失败由应用处理，且不撤销工具副作用。

Session 并发写入、审批、图执行器、多 Agent、进程隔离、checkpoint 与跨进程恢复均留给后续需求驱动的模块；这些能力不能靠事件订阅本身获得事务或 exactly-once 保证。

## 12. 与上一版的主要变化

| 上一版 | 新方案 |
| --- | --- |
| Agent 是静态声明，运行从 Runtime.start 进入 | Agent 是有状态实例，从 agent.prompt 进入 |
| Run、Executor 和 Runtime 占据主要心智 | run/turn 是生命周期概念，底层 agentLoop 独立可调用 |
| middleware 先于核心实体被设计 | 先稳定消息、工具、状态、事件，再开放具体 hooks |
| session 边界混入运行框架 | session 是可选外层能力，不强制 Agent 依赖存储 |
| 通用 ModelPort 与 Provider 映射不够具体 | 显式 model adapter、消息转换与续接约束 |

这一版仍保留安全授权、取消、扩展与可观测性，但不让这些外围机制主导 Agent 的实体模型。下一步应先验证 `Agent / State / Message / Tool / Loop` 的类型与 Provider 适配，再实现可选 Plugin Host。

## 13. 实现前的验证

1. 用 mock 模型验证两轮调用、工具结果回传、Agent 状态和事件顺序。
2. 验证同一 Agent 并发 prompt 被拒绝，不同 Agent 不共享消息。
3. 验证 hook 顺序、拒绝、异常、取消；订阅者异常不影响运行。
4. 验证所有 Provider outcome、重复/缺失 toolCallId 和 finish 语义。
5. 对 Anthropic continuation 与 Responses 服务端续接分别做契约测试；使用目标服务受控验证。
6. 验证错误/取消后历史不会产生可被误用的不完整工具调用，且工具不因失败自动重试。

