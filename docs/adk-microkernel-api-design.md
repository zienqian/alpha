# Alpha ADK 微内核、插件与 Hooks 详细设计

> 状态：设计草案 · 2026-11-03  
> 范围：TypeScript / Node.js，单进程单 Agent 起步；示例为拟议 API，不是当前已实现的 API。

## 1. 目标与边界

构建可嵌入应用的 Agent 开发框架。使用者能够以较少配置运行默认工具循环，也能替换执行器、模型桥接、会话存储和策略。插件通过有限、明确的公开扩展点组合；业务不需要继承框架基类或修改内部状态。

**依赖关系**：应用依赖 `@alpha/adk` 和 `@alpha/provider` 完成组装；两包不互相依赖。外部插件只依赖 ADK 公开 API。当前 Provider 已实现自有 `LanguageModel`，支持 `generate/stream`、工具、使用量、取消和协议续接；本设计不依赖 AI SDK。

**暂不承诺**：跨进程恢复、分布式调度、恰好一次副作用、插件隔离、多 Agent 或图工作流。接口的预留不等于这些能力已经可用。

### 1.1 内核与内置扩展

| 类别 | 内容 | 责任 |
| --- | --- | --- |
| 内核 | Runtime、Run、Executor 契约、模型/工具调用网关、扩展组装、事件、取消、预算 | 实现一致的生命周期和策略执行边界 |
| 默认执行器 | 上下文构造、模型/工具循环和终止判断 | 通过内核网关发起操作 |
| 内置扩展 | 内存 session、日志观察者、工具策略 | 可替换、可不启用 |
| 外部扩展 | MCP、持久化、图执行器、trace exporter | 只使用公开契约；各自独立维护依赖 |

“微内核”是依赖和能力边界，不要求第一天拆多个包。建议先在 `packages/adk` 中分目录，通过 exports 控制公开面。

## 2. 对象模型

| 对象 | 生命周期 | 作用 |
| --- | --- | --- |
| Agent | 定义阶段 | 不可变配置快照：ID、指令、模型、工具、执行器默认值 |
| Runtime | 应用级 | 安装插件，冻结扩展集合，创建 Run |
| Run | 每次请求 | 保存 ID、事件、终态、取消信号与预算 |
| Executor | Runtime 级可复用实例 | 实现算法；每次执行只使用该次 RunContext |
| RunContext | 每次 Run | 只读 ID、信号、预算视图、应用注入的上下文 |
| Tool | 定义阶段 | 输入 schema、校验器、执行函数和副作用声明 |
| Session | 跨 Run | 带版本的会话项读写；不是 checkpoint |
| Plugin | Runtime 级 | 在启动时同步注册能力和 hooks；可选异步启动/关闭 |

约定 Agent 定义使用浅层冻结的快照；嵌套 schema 与数组由创建函数复制，函数和注入的对象按引用持有，使用者负责其线程/并发安全。每个 Run 的可变运行状态独立，插件闭包与注入依赖可能被并发访问。

## 3. 内核公开 API 草案

以下代码块是类型设计示意，省略少量辅助字段；它们一起定义预期语义，不宣称已经编译或发布。

### 3.1 Agent、Runtime 与 Run

```ts
export type Awaitable<T> = T | Promise<T>;
export type Json = null | boolean | number | string | Json[] |
  { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export interface Agent<C = unknown> {
  readonly id: string;
  readonly instructions: string;
  readonly model: ModelPort;
  readonly tools: readonly Tool<C>[];
}

export function defineAgent<C>(definition: Agent<C>): Agent<C>;

export interface RunInput<C> {
  input: string;
  context: C;                       // 应用依赖，不自动发送给模型或持久化
  session?: Session;
  signal?: AbortSignal;
  limits?: { maxModelCalls?: number; timeoutMs?: number };
  stream?: 'none' | 'events';       // 默认为 none
}

export interface Runtime<C = unknown> {
  start(agent: Agent<C>, input: RunInput<C>): Run;
  close(): Promise<void>;
}

export interface Run {
  readonly id: string;
  readonly result: Promise<RunResult>;
  readonly events?: AsyncIterable<RunEvent>; // 仅 stream: 'events' 时存在
  cancel(reason?: unknown): void;
}

export type RunResult =
  | { status: 'completed'; text: string; usage: Usage }
  | { status: 'refused'; text: string; usage: Usage }
  | { status: 'incomplete'; text: string; reason?: string; usage: Usage }
  | { status: 'unknown'; text: string; usage: Usage }
  | { status: 'cancelled'; usage: Usage }
  | { status: 'failed'; error: AdkError; usage: Usage };
```

**运行契约**：

- `start` 立即返回句柄并启动运行；同步参数错误在调用时抛出，执行期间的错误折叠为 `result.status = 'failed'`。取消同样通过 result 表达。避免必须通过异常处理所有业务终态。
- `result` 总会在运行结束时 settle；`close()` 拒绝新运行、取消活跃运行、等待其清理，然后逆序关闭已启动插件。重复调用 `close()` 返回同一关闭结果。
- `stream: 'none'` 时无事件队列，调用方可以只等待结果；观察者仍可收到生命周期通知。
- `stream: 'events'` 必须恰好一个消费者。使用有界队列，队列满时执行器等待消费者，形成背压；结果只有执行完成后才 settle。调用者应立即并发消费流和等待结果。消费者提前 `break`、迭代异常或显式 `cancel` 时取消 run、关闭底层模型流并唤醒阻塞写入；永不消费的调用者应配置 timeout 或主动取消。
- 事件流仅传达本次进程内事件，不是持久日志；流完成不替代检查 `result`。取消是协作式的，无法撤销已发生的副作用。
- 同一 Runtime 可以并发运行不同 Agent；同一 Session 的并发写入按第 8 节处理。无全局可变的当前 Run。

建议消费方式：

```ts
const run = runtime.start(agent, {
  input: '查询订单 A123',
  context: { tenantId: 'tenant-1' },
  stream: 'events',
  limits: { maxModelCalls: 8, timeoutMs: 30_000 },
});

const consume = (async () => {
  for await (const event of run.events!) {
    if (event.type === 'model.text.delta') process.stdout.write(event.text);
  }
})();
const [result] = await Promise.all([run.result, consume]);
if (result.status !== 'completed') handleNonSuccess(result);
```

### 3.2 工具定义与校验

使用 JSON Schema 作为发送给模型的描述，并要求开发者提供与 schema 一致的运行时解析函数。首版不绑定特定 schema 库；适配器可以把 Zod 等库转换成这一对值。

```ts
export interface Schema<T> {
  readonly jsonSchema: JsonObject;
  parse(value: unknown): T;  // 校验失败时抛出，绝不只依赖模型遵循 schema
}
export interface ToolExecutionContext<C> {
  readonly runId: string;
  readonly toolCallId: string;
  readonly signal: AbortSignal;
  readonly app: C;
}
export interface Tool<C = unknown, I = unknown> {
  readonly name: string;
  readonly description: string;
  readonly input: Schema<I>;
  readonly effect: 'read' | 'write' | 'unknown';
  execute(input: I, context: ToolExecutionContext<C>): Promise<string>;
}
export function defineTool<C, I>(tool: Tool<C, I>): Tool<C, I>;
```

`effect` 是开发者声明，不是安全证明。首版结果为字符串，与现有 Provider 的 tool message 对齐；结果大小上限和错误脱敏由网关执行。模型返回的 `toolCallId` 必须存在且同一模型响应中唯一；空值或重复视为协议错误，不能执行任何该响应中的工具。

### 3.3 ModelPort 与 Provider 桥接

避免复制 Provider 的结构后假设类型自然兼容。ADK 使用独立的标准类型，应用显式传入桥接函数；初版桥接可以作为应用级示例，待接口稳定再提取到可选适配包。

```ts
export interface ModelPort {
  readonly id: string;
  stream(request: ModelRequest): AsyncIterable<ModelEvent>;
}
export interface ModelRequest {
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ModelToolDefinition[];
  readonly signal: AbortSignal;
}
export type ModelEvent =
  | { type: 'text.delta'; text: string }
  | { type: 'finish'; result: ModelResult };
export interface ModelResult {
  outcome: 'completed' | 'tool_calls' | 'refused' | 'incomplete' | 'unknown';
  text: string;
  toolCalls: readonly { id: string; name: string; arguments: JsonObject }[];
  usage?: Usage;
  refusal?: string;
  incompleteReason?: string;
  continuation?: ModelContinuation;
}
export interface ModelContinuation {
  readonly owner: string; // 实例/协议身份，由桥接实现校验
  readonly data: unknown; // 不透明；不可记录、修改或跨 owner 使用
}
```

桥接必须：
1. 显式映射消息、schema、终态和错误；仅将 Provider 的 `finish.result.toolCalls` 映射到最终结果，不再执行 Provider 单独发出的 `tool-call` 事件。
2. 保留 Anthropic `continuation` 与对应 assistant 消息的关联；不跨模型使用，也不向日志输出其内容。
3. Responses 的 `previousResponseId` 使用独立的可选续接策略，启用时只发送新增消息且重新提供必要指令；不能同时把全部历史和增量错误叠加。默认优先无状态消息续接，遇到无法安全续接的情形明确失败。
4. 透传 AbortSignal；只有正常结束恰好收到一次 finish 才提交模型结果。缺失或重复 finish 视为协议错误。
5. Provider 当前未用真实服务凭证验证；桥接需契约测试与目标服务验证。

## 4. 执行器与内核网关

```ts
export interface Executor<C> {
  execute(context: ExecutorContext<C>): Promise<RunResult>;
}

export interface ExecutorContext<C> {
  readonly agent: Agent<C>;
  readonly app: C;
  readonly signal: AbortSignal;
  readonly runId: string;
  readonly input: string;
  readonly session?: Session;
  readonly limits: Readonly<RunLimits>;
  readonly services: ExecutionServices<C>;
}

export interface ExecutionServices<C> {
  callModel(request: ModelRequest): Promise<ModelResult>;
  callTool(call: ToolCall): Promise<ToolCallResult>;
  emit(event: ExecutorEvent): Promise<void>;
}
```

`services.callModel` 和 `services.callTool` 是策略、预算、事件和 trace 的统一执行边界。`callModel` 消费 ModelPort 的流、转发暂定文本、等待 finish；`callTool` 执行解析、授权、中间件及工具调用。执行器只通过这些服务获得受框架保护的调用；自行访问网络或直接调用 `agent.model` 无法自动受到框架约束，受信任代码需遵循这一约定。工具网关只允许调用当前 Agent 显式注册的工具。

默认执行器的伪代码：

```ts
async function execute(ctx: ExecutorContext<AppContext>): Promise<RunResult> {
  const messages = await buildContext(ctx);
  while (true) {
    // 网关在发出请求前原子检查并扣减模型调用预算。
    const response = await ctx.services.callModel({
      messages, tools: describeTools(ctx.agent.tools), signal: ctx.signal,
    });
    if (response.outcome !== 'tool_calls') {
      return toTerminalResult(response); // completed / refused / incomplete / unknown
    }
    validateCallIds(response.toolCalls); // 在执行任意工具前整体验证
    messages.push(toAssistantMessage(response)); // 保留续接数据
    for (const call of response.toolCalls) {
      const result = await ctx.services.callTool(call); // 首版串行
      messages.push(toToolMessage(call.id, result));
    }
  }
}
```

工具执行失败可以按配置：终止 run，或返回经过脱敏的工具错误供模型处理；取消、授权拒绝和内部不变量错误不能被误当成普通工具结果。工具默认不重试。模型重试若以后支持，必须限定为未开始工具副作用的请求阶段，记录重复计费可能性。

## 5. 插件 API

插件是**启动期显式注册**，不是动态加载不可信代码的机制。一个插件可以组合多个扩展点；简单替换不必强制包装成插件。

```ts
export interface Plugin<C = unknown> {
  readonly name: string;       // 例如 'acme.audit'
  readonly apiVersion: 1;
  setup(registry: PluginRegistry<C>): void;
  start?(): Awaitable<void>;
  close?(): Awaitable<void>;
}
export interface PluginRegistry<C> {
  useModel(middleware: ModelMiddleware<C>): void;
  useTool(middleware: ToolMiddleware<C>): void;
  observe(observer: RunObserver<C>): void;
}
export interface RuntimeOptions<C> {
  executor: Executor<C>;
  plugins?: readonly Plugin<C>[];
  observerError?: (error: unknown, plugin: string) => void;
}
export function createRuntime<C>(options: RuntimeOptions<C>): Promise<Runtime<C>>;
```

**生命周期与冲突规则**：

1. 先按数组顺序校验插件名唯一、API 版本支持，再同步依次执行 `setup`；任一步失败则不创建 Runtime。setup 只注册，不应启动后台任务或产生外部副作用。
2. 冻结注册表后按顺序 await `start`。启动失败时按逆序 close 已成功启动的插件；聚合清理错误，向调用方报告启动失败。失败插件负责清理自己在 start 部分创建的资源。
3. Runtime 存活期间注册表不变；无需支持动态卸载、热更新和隐式全局注册。
4. 关闭按逆序执行，即使某个 close 失败也继续清理其余插件，最终聚合错误。
5. 插件与应用处于同一进程、拥有相同权限；API 版本用于兼容检查，不提供安全隔离。权限和资源由应用显式注入。
6. 注册顺序即同一扩展点的执行顺序。重复插件名报错；工具重名在 Agent 创建时失败。插件不允许覆盖内核服务或默认工具。

## 6. Hooks 与中间件

区分**能改变执行的中间件**和**只观察的事件订阅**。前者异常会影响 run，后者异常由错误处理器记录，不阻断运行。

### 6.1 拦截点

| 扩展点 | 输入 | 可做的事 | 失败语义 |
| --- | --- | --- | --- |
| model middleware | 请求与只读运行上下文 | 包装调用、检查或拒绝；通过显式 request 副本修改模型输入 | 抛错终止 run |
| tool middleware | 已解析的调用、工具元数据与只读上下文 | 检查或拒绝、计时、包装执行 | 抛错终止 run；不能绕过 schema |
| observer | 不可变事件 | 日志、指标、trace | 异常隔离并报告，不改变 run |

```ts
export interface HookContext<C> {
  readonly runId: string;
  readonly agentId: string;
  readonly signal: AbortSignal;
  readonly app: C;
}
export type ModelMiddleware<C> = (
  ctx: HookContext<C>,
  request: ModelRequest,
  next: (request: ModelRequest) => Promise<ModelResult>,
) => Promise<ModelResult>;

export interface ParsedToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown; // 已经使用该工具的 Schema.parse 校验
  readonly effect: 'read' | 'write' | 'unknown';
}
export type ToolMiddleware<C> = (
  ctx: HookContext<C>,
  call: ParsedToolCall,
  next: () => Promise<ToolCallResult>,
) => Promise<ToolCallResult>;

export type RunObserver<C> = (
  event: Readonly<ObservabilityEvent>,
  context: HookContext<C>,
) => Awaitable<void>;
```

- 中间件按注册顺序进入，逆序退出；`next` 至多调用一次。调用零次表示中断，必须抛出明确的 `PolicyDeniedError`；重复调用由框架拒绝。不能通过多次 next 实现重试。
- 模型中间件能修改请求，最终模型网关在发送前再次验证参数和预算；中间件不得替换 signal 来绕过取消。工具中间件不能直接修改已校验输入；要修改需设计独立转换扩展并重新校验，首版不开放。
- 授权中间件在工具执行前运行。为了避免其他插件通过短路伪造成功结果绕过审计，首版要求中间件调用并等待 next，且返回该次 next 的原始结果对象；网关检查对象身份，否则报插件错误。可扩展缓存要作为后续独立契约评估。
- 观察者按注册顺序调用；每个 observer 的异常被捕获并传给 `observerError`，该回调失败也不影响 run。observer 是可信进程内代码，逻辑只读约束不是安全隔离。
- 观察者若异步且串行等待会增加延迟。首版明确串行 await，建议观察者内部使用有界队列；不提供无限缓冲。默认不将正文、工具参数、结果或续接数据放入观察事件。
- 每个并发 Run 独立执行 hooks；同一插件可能被多个 Run 同时调用，插件维护的共享状态必须自行同步。

### 6.2 生命周期与顺序

```text
run.started
  → 构造上下文 / 加载 session
  → model middleware 进入
      → model.started → 文本增量* → model.completed
    model middleware 退出
  → 参数校验
  → tool middleware 进入
      → tool.started → 执行工具 → tool.completed / tool.failed
    tool middleware 退出
  → 需要时再次调用模型
  → 提交 session（若配置）
  → run.completed / run.failed / run.cancelled（恰好一个终态）
```

钩子/事件位置是契约：`model.started`、`tool.started` 表示底层操作即将真正开始，而不是 middleware 刚进入；策略拒绝不会伪造 started。被调用的工具因参数无效时发出 `tool.rejected`，并按错误策略处理；必须先验证工具调用 ID，再发出任何工具操作。工具返回后，若 middleware 的退出逻辑失败，副作用可能已经发生，run 应失败且不得自动重试。

### 6.3 插件示例：授权与审计

```ts
interface AppContext { tenantId: string; allowedTools: ReadonlySet<string> }

function authorizationPlugin(): Plugin<AppContext> {
  return {
    name: 'example.authorization',
    apiVersion: 1,
    setup(registry) {
      registry.useTool(async (ctx, call, next) => {
        if (!ctx.app.allowedTools.has(call.name)) {
          throw new PolicyDeniedError('TOOL_DENIED');
        }
        return next();
      });
    },
  };
}

function auditPlugin(sink: AuditSink): Plugin<AppContext> {
  return {
    name: 'example.audit',
    apiVersion: 1,
    setup(registry) {
      registry.observe(async (event) => {
        // 默认事件只有元数据，不含输入/输出和凭证。
        await sink.write({ runId: event.runId, type: event.type });
      });
    },
    close: () => sink.flush(),
  };
}
```

以上授权规则仅是示例；`allowedTools` 必须从可信服务端身份解析，不能由模型生成。异步 audit sink 必须有超时和容量限制，避免阻塞所有运行。

## 7. 事件、错误与预算

```ts
export interface EventBase {
  readonly version: 1;
  readonly runId: string;
  readonly sequence: number; // 从 1 开始，同一 run 单调递增
  readonly timestamp: string;
}
export type RunEvent = EventBase & (
  | { type: 'run.started'; agentId: string }
  | { type: 'model.started'; callId: string }
  | { type: 'model.text.delta'; callId: string; text: string }
  | { type: 'model.completed'; callId: string; outcome: ModelResult['outcome'] }
  | { type: 'tool.started'; toolCallId: string; name: string }
  | { type: 'tool.completed' | 'tool.failed' | 'tool.rejected'; toolCallId: string; name: string }
  | { type: 'run.completed' | 'run.failed' | 'run.cancelled' }
);
export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  complete: boolean; // false 表示至少一次调用未提供完整用量
}
export type ObservabilityEvent =
  | (EventBase & { type: 'model.text.delta'; callId: string; textLength: number })
  | Exclude<RunEvent, { type: 'model.text.delta' }>;
```

事件的 delta 用于调用方展示，属于敏感正文；传给 observer 前转换为 `ObservabilityEvent`，其中 `model.text.delta` 只含长度，不含文本。这个区分是隐私默认值的一部分。应用的 `run.events` 才包含展示所需文本。

`AdkError` 至少有 `code`、安全的 `message`、内部 `cause`；对外事件不包含堆栈或参数。建议类别：`CONFIG_INVALID`、`PROTOCOL_INVALID`、`MODEL_FAILED`、`TOOL_INPUT_INVALID`、`TOOL_DENIED`、`TOOL_FAILED`、`BUDGET_EXCEEDED`、`SESSION_CONFLICT`、`PLUGIN_FAILED`。错误码可稳定，详细 message 不作为机器协议。

默认最多 8 次模型调用；`maxModelCalls` 必须为正整数，预算在实际模型调用前递减，恢复运行未来必须保留预算。超时与外部 AbortSignal 合并；第一个取消原因获胜，取消清理必须执行。token 使用量仅累加 Provider 实际返回值；`complete: false` 表示总量不完整，不能用于计算确定的总成本。

## 8. Session 与并发

```ts
export interface SessionSnapshot {
  readonly revision: string;
  readonly items: readonly SessionItem[];
}
export interface Session {
  readonly id: string; // 在同一 Runtime 内稳定且唯一
  read(signal: AbortSignal): Promise<SessionSnapshot>;
  append(expectedRevision: string, items: readonly SessionItem[],
         signal: AbortSignal): Promise<{ revision: string }>;
}
```

首版建议内存实现按 session ID 进行独占租约：从读取到提交，同一进程内另一个 run 使用同一 session 则立即返回 `SESSION_CONFLICT`；不能仅依赖进程内锁保护跨进程存储。接口中的 revision 是存储层 compare-and-swap；外部实现仍需保证原子检查与写入。提交失败时 run 标记失败，不能回滚已经发生的工具副作用。

历史提交策略需避免模型续接缺失：已执行的工具调用及对应结果作为不可拆分的一组保存；中断或失败时，根据实际已完成工作保存安全、有效的调用/结果对及当前输入，而不是伪造成功；拒答或失败不写入未经验证的候选终态。若存储本身失败，向应用报告失败和副作用可能已发生。具体事务边界与内容保留策略在实现前通过协议契约测试锁定。

Session 数据与 `app context` 分开；密钥、连接对象不进入 session。多 Agent、多租户授权、保存时限和删除策略由未来具体实现与应用决定。

## 9. 应用侧组装示例

```ts
import { createProvider } from '@alpha/provider';
import {
  createRuntime, createToolLoopExecutor, defineAgent, defineTool,
} from '@alpha/adk';

const provider = createProvider(providerConfig);  // 配置与密钥由应用管理
const model = adaptAlphaProvider(provider.use('primary', 'chat'));
const orderTool = defineTool<AppContext, { orderId: string }>({
  name: 'get_order',
  description: '查询当前租户的订单',
  effect: 'read',
  input: orderIdSchema, // { jsonSchema, parse }，应用提供
  async execute({ orderId }, { app, signal }) {
    const order = await orderService.get(app.tenantId, orderId, { signal });
    return JSON.stringify(order);
  },
});

const agent = defineAgent<AppContext>({
  id: 'order-assistant',
  instructions: '帮助用户查询订单状态。',
  model,
  tools: [orderTool],
});

const runtime = await createRuntime<AppContext>({
  executor: createToolLoopExecutor(),
  plugins: [authorizationPlugin(), auditPlugin(auditSink)],
});
try {
  const run = runtime.start(agent, {
    input: '订单 A123 到哪里了？',
    context: { tenantId: 'tenant-1', allowedTools: new Set(['get_order']) },
  });
  const result = await run.result;
  if (result.status === 'completed') console.log(result.text);
  else handleNonSuccess(result);
} finally {
  await runtime.close();
}
```

`adaptAlphaProvider`、`providerConfig`、`orderIdSchema`、`orderService`、`auditSink` 和 `handleNonSuccess` 都是示意中由应用或未来适配器提供的内容。当前仓库尚不存在上述 ADK API。

## 10. 扩展点演进与版本

| 阶段 | 开放功能 | 暂缓 |
| --- | --- | --- |
| P0 | 固化模型桥接、事件、Run 和错误契约；编写 mock 验证 | 真实插件生态承诺 |
| P1 | 默认执行器、工具 schema、预算、取消、事件与有限的 model/tool middleware | checkpoint、动态加载、并发工具 |
| P2 | 插件生命周期、观察者、内存 session、自定义执行器 | 不可信插件隔离、热重载 |
| P3 | 经真实业务验证后增加 MCP、更多 session 实现 | 通用分布式框架 |
| 需求驱动 | 图执行器、审批、持久恢复、多 Agent | 未经幂等与故障测试的恢复承诺 |

建议核心 API 与插件 API 在 v0 阶段明确实验性；每次变更提供迁移说明。未来稳定后：新增可选字段通常兼容，删除/重命名扩展点、修改顺序、错误语义和事件含义均视为破坏性变更。插件 `apiVersion` 与 npm 包版本独立管理，加载时校验，无法保证行为兼容时拒绝启动。

## 11. 验收与待决事项

**最小验收**：

1. 使用脚本化 mock model 验证两轮模型调用和一次工具调用；覆盖所有终态、无效/重复工具 ID、schema 错误与工具失败。
2. 断言中间件进入/退出顺序、拒绝、重复 next、插件启动失败时逆序清理及并发隔离。
3. 验证只等待 result 不死锁；流慢消费者背压、提前退出、取消、模型抛错和超时均能结束并释放资源。
4. 验证一个 Agent 能替换模型桥接和执行器；替换 session 与 observer 不改 Agent。
5. 两个同 session run 冲突；模拟 session 提交失败并确认不会重试已发生的工具副作用。
6. 对现有 Provider 的三种协议做桥接契约测试，覆盖 finish、续接及信号，另对目标服务进行受控集成测试。
7. 观察事件、错误和日志不含密钥、工具参数、正文或续接数据；用户流中允许的文本需按应用策略处理。

**实现前需要拍板**：首个业务场景与目标模型；schema 适配采用哪个库；是否允许工具失败后反馈模型；会话写入的具体事务与保留策略；公开 API 稳定级别。本文对这些点提供默认方向，但不假设它们已经经过业务验证。

