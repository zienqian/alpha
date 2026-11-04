# Alpha ADK：微内核与扩展架构重新设计

> 状态：架构设计草案 · 2026-11-03。替代此前的微内核及实体模型设计。所有代码为目标 API 示例，当前 ADK 尚未实现。

## 1. 为什么前两版不成立

前两版把“支持插件 / 有 hooks”当成微内核的证明；对象之间谁持有状态、谁执行副作用、扩展是否会绕过策略也不清楚。第二版虽然借鉴了 Pi 的有状态 Agent，但又把可替换执行策略、上下文和外部能力的接入退化成几个回调。

本版先回答三个问题：

1. **内核固定什么？** 固定一次运行的状态转换、能力调用入口、约束执行、事件与取消语义。
2. **哪些东西可换？** 运行策略、模型适配、上下文构建、工具来源与执行环境；会话、记忆、编排和观测在外层组合。
3. **插件是什么？** 插件是注册和管理这些扩展的一个载体；不使用插件也能直接注入实现。

设计目标是可嵌入的 TypeScript ADK，不预设每个应用都需要插件宿主、数据库或分布式系统。

## 2. 调研：开源项目的扩展性不止 hooks

| 参考项目 | 源码或官方文档体现的机制 | Alpha 的借鉴和取舍 |
| --- | --- | --- |
| [Pi Agent Core](https://github.com/earendil-works/pi/blob/main/packages/agent/README.md) | 有状态 Agent 与底层 loop 分开；消息、工具、转换和事件为明确实体 | 借鉴实体语义；在 Alpha 增加受控的能力调用边界和可替换运行策略 |
| [Pi Coding Agent Extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md) | 在上层注册工具、命令、provider 和生命周期处理；也允许自定义工具执行后端 | 区分内核能力与产品能力；命令、UI 等不放进通用内核。Pi 的具体扩展 API 不直接照搬 |
| [VS Code Contribution Points](https://code.visualstudio.com/api/references/contribution-points) 和 [Extension Host](https://code.visualstudio.com/api/advanced-topics/extension-host) | 扩展贡献能力；宿主负责加载与运行环境 | 借鉴贡献点和宿主分离；首版只显式安装可信进程内代码，不实现清单发现或进程隔离 |
| [Fastify Plugins](https://fastify.dev/docs/latest/Reference/Plugins/) | 通过插件组合能力，具有封装与作用域语义 | 借鉴明确的组装顺序和作用域；首版仅应用级不可变注册快照，不声称实现 Fastify 的嵌套封装 |
| [OpenTelemetry Tracing SDK](https://opentelemetry.io/docs/specs/otel/trace/sdk/) | 采集 API、处理器和 exporter 分层，支持多个处理管线 | 事件生产与观测导出分离；默认不启用远程 exporter |

结论是：**扩展是多个不同的替换和组合边界**。hooks 适合干预固定时机，无法单独表达更换模型协议、切换上下文构建算法或替换执行环境。

## 3. 架构图与依赖方向

```text
                           应用 / CLI / 服务
           组装模型、工具、策略、存储及可选 Plugin Host
                                 │
           ┌─────────────────────┴─────────────────────┐
           ▼                                           ▼
   Agent（对话实例 / 外观）                  可选的 Plugin Host
   对外 prompt / state / events              装配贡献，不执行 Agent
           │                                           │
           ▼                                           │提供注册快照
 ┌─────────────────────────────────────────────────────┴──┐
 │ ADK 内核                                                │
 │ Run 状态机 / Step 协议 / 能力网关 / 预算 / 取消 / 事件 │
 └────────────────────────────────────────────────────────┘
          │ 调用已注入的契约               │ 调用已授权能力
          ▼                               ▼
  Strategy：下一步是什么           Model / Tool / Context 等接口
          ▲                               ▲
          │                               │
  默认工具循环 / 自定义策略      Provider bridge / 工具 / 执行后端
                                           ▲
                           Session / Memory / MCP / Trace 可选适配
```

箭头表示调用或组装，不表示源码都依赖应用。源码依赖：`app → adk`，`app → provider`；外部扩展 → ADK 的公开接口；ADK 内核不依赖 provider、plugin host、数据库或特定传输协议。内核定义端口，外围提供实现。初期可在同一 `packages/adk` 内分目录实现，后续按照独立依赖或发布需求拆包。

**微内核的可检验定义**：删除 Plugin Host、默认工具循环、所有存储与具体 provider 后，内核仍能以测试用 Strategy 和假 ModelPort 创建并完成一次运行；增加一种策略或工具来源时无需修改内核的状态机。可用性依赖应用注入实现，内核本身不假装具备默认功能。

## 4. 核心实体：每个对象只有一个所有者

| 名称 | 唯一职责 | 持有者与生命周期 | 不负责 |
| --- | --- | --- | --- |
| Agent | 多轮对话的外观；保存消息历史、当前配置和可观察状态 | 应用持有；一个实例可运行多次 | 不执行 provider HTTP，不管理插件安装 |
| Run | 一次 `prompt` 的执行；包含状态、预算、取消和关联 ID | 内核创建；每次 prompt 一个 | 不跨进程恢复，不保存长期历史 |
| Strategy | 根据上下文和前一步结果决定下一条 Step | 应用注入；无状态或每 run 创建实例 | 不直接调用模型、工具或修改 Agent 历史 |
| Step | 策略提交的明确指令：模型调用、工具调用或结束 | 在单次 Run 中产生 | 不是可持久化工作流节点 |
| Capability Gateway | 内核唯一支持的模型/工具调用路径，执行校验、授权、预算和事件 | Run 内核持有 | 不承担工具业务逻辑 |
| AgentMessage | 会话历史中的内容与工具调用/结果 | Agent 持有；可被外层 Session 持久化 | 不自动等于发给模型的完整上下文 |
| ContextBuilder | 从历史和用户输入生成模型请求的消息投影 | 应用注入，供 Strategy 使用 | 不修改 Agent 原始历史 |
| ModelPort / Tool | 分别定义模型调用和工具能力 | 应用或扩展提供 | 不负责调度整个 run |
| Plugin Host | 将插件贡献组装为可用配置 | 应用可选创建 | 不成为 Agent 的必要依赖 |
| SessionStore | 会话历史存取 | 外层应用持有，可选 | 不承诺未完成 run 恢复 |

**状态所有权**：Agent 是跨轮历史的唯一所有者；Run 拥有当前执行的临时状态；Strategy 每次只收到只读视图，并返回 Step，不能直接修改两者。Gateway 是受框架管理的能力调用入口。工具、模型、插件是可信进程内代码；接口不能阻止恶意代码自行访问网络。

`run` = 一次用户输入触发的执行；`turn` = 一次模型调用及其后续工具处理；`step` = Strategy 交给内核处理的一项指令。三者不是可互换的名词。

## 5. 运行协议：微内核真正负责什么

### 5.1 公开类型轮廓

```ts
type Step =
  | { type: 'model'; request: ModelRequest }
  | { type: 'tool'; call: ToolCall }
  | { type: 'finish'; outcome: 'completed' | 'refused' | 'incomplete' | 'unknown';
      text?: string };

type StepResult =
  | { type: 'model'; result: ModelResult }
  | { type: 'tool'; result: ToolResult };

interface StrategyContext<App> {
  readonly messages: readonly AgentMessage[];
  readonly lastResult?: StepResult;
  readonly contextBuilder: ContextBuilder;
  readonly app: Readonly<App>;
}
interface Strategy<App> {
  // 每次 run 新建实例；next 不能执行模型、工具等外部副作用。
  next(context: StrategyContext<App>): Promise<Step>;
}

interface KernelOptions<App> {
  createStrategy(): Strategy<App>;
  model: ModelPort;
  tools: readonly Tool<App, any>[];
  contextBuilder: ContextBuilder;
  authorizeTool: ToolAuthorizer<App>;
  limits: { maxModelCalls: number; maxToolCalls: number; timeoutMs: number };
}
```

`Step` 是受限的判别联合，不支持任意执行函数；内核只识别声明的三种操作。默认工具循环是 `Strategy` 的实现，例如收到 model 结果后按工具调用顺序逐个返回 tool Step；所有策略最终都走同一个网关。

### 5.2 内核调度伪代码

```ts
while (!run.signal.aborted) {
  const step = await strategy.next(readonlyRunView());
  switch (step.type) {
    case 'model':
      // 检查模型预算和消息合法性；等待 model hooks；
      // 调用 ModelPort；收集完整 finish 并发出事件。
      run.lastResult = await gateway.callModel(step.request);
      commitAssistantMessage(run.lastResult);
      break;
    case 'tool':
      // 仅接受最新 assistant 已声明且尚未处理的 toolCallId。
      // 验证工具名/参数 → 授权 → 执行 → 记录结果。
      run.lastResult = await gateway.callTool(step.call);
      commitToolResult(run.lastResult);
      break;
    case 'finish':
      ensureNoUnresolvedToolCalls();
      return completeRun(step);
  }
}
return cancelRun();
```

内核在接受 model / finish 前检查未完成的工具调用；无效 step、越权工具、重复调用 ID 均失败。每次模型调用前检查并扣减预算，每次工具调用前检查并扣减工具预算；再加总 step 上限以防策略无限返回无效操作。超时和外部 AbortSignal 合并，取消后不启动新调用。外部副作用不能回滚；工具不自动重试。

**策略边界的重要限制**：这是同进程协作契约，不是沙箱。自定义 Strategy 仍可通过自己的闭包自行发 HTTP 或执行任意代码；这种行为不经过 Gateway，也不受 ADK 权限、预算和追踪保证。需要对不可信策略强制约束时，必须在进程/容器边界隔离并只暴露受控 RPC；这是后续独立项目。

### 5.3 状态机

```text
created → running → completed / refused / incomplete / unknown
                  → failed
                  → cancelling → cancelled
```

每个 Run 恰好一个终态。单个 Agent 同时只允许一个活跃 Run；不同 Agent 可并发。模型文本增量为暂定数据，最终以模型 finish 和 Run 终态为准。`prompt()` 返回结果并可选择订阅事件；无订阅者时绝不阻塞执行。订阅者同步通知且异常隔离；异步导出由订阅者自行使用有界队列。安全决策不依赖事件监听。

## 6. 扩展点全景：不止 plugin / hooks

下表的“何时”是建议优先级，P1 为首个可用版本，P2/P3 为契约经过用例验证后的扩展，不代表已实现。

| 扩展点 | 扩展机制 | 做什么 / 替换什么 | 边界与优先级 |
| --- | --- | --- | --- |
| ModelPort | 接口适配 | 对接 Alpha Provider、测试模型或其他模型协议 | 单个 Agent 配置一个实例；P1 |
| Tool | 能力贡献 | 接入业务函数、搜索、数据库查询等 | 显式注册；schema 与授权始终经 Gateway；P1 |
| Strategy | 算法替换 | 默认循环、确定性流程、人工控制式流程 | 每 run 创建；只能通过 Step 使用受控能力；P1 验证最小替换 |
| ContextBuilder | 策略注入 | 历史裁剪、上下文模板、RAG 检索结果拼装 | 返回投影、不改历史；检索调用的权限与取消由其外层明确管理；P1 接口，P2 丰富实现 |
| ToolSource | 适配 / 发现 | MCP 服务、本地工具集合、动态服务目录 | 解析为固定的 Tool 列表后注入；P2 |
| ToolExecutor | 执行后端 | 本地函数、远程 RPC、隔离环境 | 由 Tool 调用；认证/超时/幂等各实现负责；P2 |
| SessionStore | 存储适配 | 内存、文件、数据库 | 外层加载/保存；不等于 checkpoint；P2 |
| Memory / Retrieval | 能力组合 | 搜索、长期记忆和索引 | 作为 ContextBuilder 或工具依赖；不直接写 Agent 状态；P2 |
| Hooks / Policy | 固定时机干预 | 工具授权、输入校验、上下文变换 | 在 Gateway 内按确定顺序运行；P1 限定接口 |
| Events / Exporter | 观察管线 | UI、日志、metrics、OpenTelemetry | 不参与授权；默认不采集正文；P1 事件、P2 exporter |
| Workflow / Agent composition | 上层编排 | 顺序/并行调用多个 Agent、handoff | 通过公开 Agent API 组合；不把图引擎塞入内核；P3 |
| Message codec | 数据适配 | 自定义消息转换为模型消息、跨边界序列化 | 未识别或续接数据不兼容时显式失败；P2 |
| Plugin Host | 打包与组装 | 一个扩展一次贡献工具、策略工厂及 hooks | 可选；不是以上能力的唯一入口；P2 |

例如：替换排序策略不应通过 hook 强行改写模型响应；更换向量数据库不需要修改 Agent；MCP 是工具来源而不是一个必须写进内核的特殊工具类别。

## 7. 关键端口与契约

### 7.1 Agent 外观与状态

```ts
interface AgentState {
  readonly status: 'idle' | 'running';
  readonly messages: readonly AgentMessage[];
  readonly pendingToolCalls: readonly string[];
}
interface Agent<App> {
  readonly state: AgentState; // 只读快照
  prompt(input: string, options?: { signal?: AbortSignal }): Promise<RunResult>;
  subscribe(listener: (event: AgentEvent) => void): () => void;
  abort(reason?: unknown): void;
}
function createAgent<App>(
  options: KernelOptions<App> & { systemPrompt: string; app: App },
): Agent<App>;
```

Agent 负责多轮消息与一次 Run 的互斥，不拥有全局注册表。RunResult 包含完成、拒答、不完整、unknown、失败、取消及本次消息；内部状态经网关提交，不让策略随意修改。

### 7.2 模型与现有 Provider

`ModelPort` 由应用组装的 adapter 将 ADK 请求映射到已有 `@alpha/provider` 的 `LanguageModel.stream()`。适配器必须保留 `completed/tool_calls/refused/incomplete/unknown`，只有 tool_calls 可执行工具；以 `finish.result.toolCalls` 为唯一执行来源，不能同时处理 stream 中的 tool-call 和 finish 列表。

Anthropic continuation 要绑定原 assistant 消息并原样续接；Responses 的 previousResponseId 是服务端增量模式，需要独立策略且不能混发完整历史。continuation 属于敏感协议数据，不能跨模型使用；切换模型无法安全转换时明确报错。Alpha 当前 Provider 的真实服务行为尚未验证；模型桥接需真实服务与 mock 契约测试。

### 7.3 工具和授权

```ts
interface Tool<App, Input> {
  name: string;
  description: string;
  schema: { jsonSchema: JsonObject; parse(value: unknown): Input };
  execute(input: Input, ctx: { app: App; signal: AbortSignal;
    callId: string }): Promise<{ content: string; isError?: boolean }>;
}
type ToolAuthorizer<App> = (request: {
  toolName: string; input: unknown; app: App; signal: AbortSignal;
}) => Promise<{ allow: true } | { allow: false; reason: string }>;
```

网关按“确认调用归属 → schema 校验 → 授权 → 执行”顺序工作。业务上下文和凭证不会自动进入模型。默认 authorizer 只允许应用显式注册并允许的工具；危险操作是否需要审批由应用策略决定。若未来要暂停等待人类审批，需引入可持久化 Run 状态和恢复协议，不能用一个等待中的 Promise 宣称可靠恢复。

### 7.4 上下文构建

```ts
interface ContextBuilder {
  build(input: {
    systemPrompt: string;
    history: readonly AgentMessage[];
    tools: readonly ToolDescriptor[];
    signal: AbortSignal;
  }): Promise<ModelRequest>;
}
```

返回值是这次模型调用的投影，历史仍由 Agent 管理；裁剪不能拆开工具调用及其结果。RAG 实现注入其自己的检索服务、权限和取消信号；默认只读历史 builder 不依赖外部服务。

## 8. Hooks、事件、插件：三类东西不要混淆

| 概念 | 用途 | 能否影响执行 | 典型例子 |
| --- | --- | --- | --- |
| Hook | 内核中定义的异步决策/变换点 | 能；内核等待并处理结果 | beforeTool 授权，beforeModel 修改请求 |
| Event | 描述已经发生的事实 | 不能；监听失败隔离 | turn.started、tool.completed、text.delta |
| Plugin | 交付和注册扩展的单元 | 通过注册的能力或 hook 间接影响 | 打包一个工具来源与授权策略 |

建议 P1 hooks 只包含 `beforeModel`、`beforeTool`、`afterTool`；顺序按注册顺序、串行 await。`beforeTool` 任一拒绝则停止后续并拒绝执行，异常 fail closed；`afterTool` 异常可能发生在副作用之后，run 失败且不自动重试。订阅事件不得作为授权边界。事件默认含 ID、耗时、状态；面向 UI 的增量含正文，应与默认脱敏观测通道分开。

## 9. Plugin Host：可选的装配器

直接注入已经满足内核使用；Plugin Host 是扩展生态层，专门收集贡献并构造配置：

```ts
interface Plugin<App> {
  readonly id: string;
  readonly apiVersion: 1;
  setup(registry: Contributions<App>): void;
}
interface Contributions<App> {
  addTool(tool: Tool<App, any>): void;
  addStrategy(id: string, factory: () => Strategy<App>): void;
  addContextBuilder(id: string, builder: ContextBuilder): void;
  onBeforeTool(hook: ToolAuthorizer<App>): void;
  observe(listener: (event: ObservabilityEvent) => void): void;
}
```

首版只做显式安装，不扫描文件、不下载、不热更新。插件按传入顺序 setup；ID 和贡献的同类名称重复时报错。冻结后每个 Agent 从选定贡献创建自己的快照；不共享可变的当前 Agent 状态。setup 失败不创建 Agent；启动资源、依赖解析与异步清理需在扩展到真实需求时增加明确生命周期。

```ts
const auditPlugin: Plugin<App> = {
  id: 'example.audit',
  apiVersion: 1,
  setup(registry) {
    registry.observe(event => auditQueue.tryWrite(event));
    registry.onBeforeTool(async ({ toolName, app }) =>
      app.allowedTools.has(toolName)
        ? { allow: true }
        : { allow: false, reason: '未授权' },
    );
  },
};
```

上面的 `auditQueue` 由应用创建，容量满的处理策略要显式定义。安全审计若要求可靠落盘，应定义独立的同步策略和存储故障行为，不能把普通 observer 当成可靠审计。

## 10. 三条扩展调用链验证

### A. 换模型：业务 Agent 不变

```ts
const agent = createAgent({
  systemPrompt: '帮助用户查询订单。',
  model: adaptProvider(provider.use('primary', 'chat')),
  tools: [getOrder],
  contextBuilder: defaultContextBuilder(),
  createStrategy: () => createToolLoopStrategy(),
  authorizeTool,
  limits,
  app,
});
await agent.prompt('查询 A123');
```

切换 provider 只在组装处替换 model。链路：Agent → Run → Strategy 返回 model Step → Gateway → ModelPort → Provider adapter。工具授权和策略保持不变。跨模型续接要按前述规则验证，不能一概保证无损。

### B. 增加 MCP 工具：不改 loop 和 Gateway

```ts
const mcpTools = await mcpToolSource.list({ signal });
const agent = createAgent({
  ...baseOptions,
  tools: [...localTools, ...mcpTools],
});
```

链路：MCP adapter 把发现的远程能力转成 Tool → Strategy 返回 tool Step → Gateway 验证名称、参数并授权 → Tool adapter 调用 MCP。策略不会看到 MCP 私有传输细节。连接和关闭由应用或未来 Plugin Host 生命周期管理；这里不声称接口已实现。

### C. 更换运行策略：工具与授权不变

```ts
const agent = createAgent({
  ...baseOptions,
  createStrategy: () => new FixedSequenceStrategy(['lookup', 'summarize']),
});
```

链路：新策略决定下一步 → 与默认策略相同的 Step → Gateway → 相同的模型/工具/授权。策略不能让 Gateway 执行不存在于当前 assistant 工具调用中的任意 tool call；若需要确定性业务工具直接调用，未来必须增加一个单独且经授权的 Step 类型，而不是绕开校验。也因此上述示例中的 fixed sequence 只能安排符合现有 Step 契约的流程，不能假设任意工具可直接调用。

## 11. 消息、持久化与恢复

- Agent 持有的 messages 是跨轮历史；ContextBuilder 构建模型看到的投影；Run 状态是本次执行的临时数据。三者互不等价。
- Assistant 的 tool_calls 与每个 toolResult 以 callId 关联；工具成功后即记录结果。取消时未开始的调用可记录明确取消结果；若无法构造可信配对，标记历史不可续接并显式报错。
- SessionStore 在外层保存经过应用处理的历史；需要跨进程并发控制时，存储应提供原子版本检查。默认不保存 app context 或凭证。
- Checkpoint 不是本版内核承诺。恢复未完成流程需独立设计版本、幂等、租约和副作用对账；无 exactly-once 保证。

## 12. 包布局与依赖

```text
packages/adk/src/
  kernel/       run 状态机、Step、Gateway、预算与事件
  agent/        Agent 外观、AgentState、AgentMessage
  ports/        ModelPort、Tool、ContextBuilder、Strategy 契约
  defaults/     默认工具循环、默认 ContextBuilder
  index.ts      公开 API
  extensions/   可选 Plugin Host（首版可不实现）
packages/provider/  现有模型接口与协议
apps/example-agent/ 应用组装及 Provider bridge 示例
```

逻辑依赖为 `agent/defaults/extensions → kernel/ports`；`kernel → ports`；`ports` 不依赖具体实现。模型桥接放在应用或独立可选适配包，不使 ADK 和 Provider 互相依赖。真实实现前需用 lint / Nx 验证依赖方向。

## 13. 实施阶段与可证伪验收

| 阶段 | 做什么 | 验收 |
| --- | --- | --- |
| P0 | 锁定 Step、状态和事件；用 fake model 和 fake tool 验证模型 | 删除默认 Strategy 与所有插件后，测试策略仍能完成模型调用与结束 |
| P1 | Agent、Gateway、默认工具循环、Provider bridge、基础 hooks | 替换策略后同一工具授权仍执行；重复 ID、越权、取消和预算不被绕过 |
| P2 | ContextBuilder、ToolSource、SessionStore、Plugin Host | 直接注入与插件装配产生等价配置；MCP 适配不修改 Gateway 和 loop |
| P3 | 按业务选择执行隔离、多 Agent 或可靠恢复 | 明确进程边界、故障恢复和外部副作用对账，并通过故障注入 |

**重点测试**：模型 stream 断流/重复 finish；tool calls 批量校验；拒答与 incomplete 不执行工具；不订阅事件仍完成；并发 Agent 状态隔离；策略恶意闭包不被当成沙箱；可观察数据默认脱敏；连续 prompt 和异常后历史仍可安全转换。真实 Provider 接口需要额外受控集成验证。

**仍待决定**：首个业务场景、是否需要策略层在首版就支持替换、ContextBuilder 是否允许直接做外部检索、以及持久化的事务语义。若首个场景只需默认循环，可先实现 Step 契约和一个测试策略，不必提前建设完整策略生态。

