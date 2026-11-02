# Alpha Agent 平台：社区调研、技术方案与路线图

> **历史调研稿**：本文保留早期对 AI SDK 的调研和方案，相关选型已被后续决定取代。当前 Provider 自行实现模型接口和协议，最新用法请见 [Provider README](../packages/provider/README.md) 及 Provider API 页面。

> 状态：讨论稿 · 调研日期：2026-11-02 · 适用范围：从零建设的 Agent 开发框架和 monorepo

## 01 / 执行建议

建议以 **TypeScript + pnpm workspace + Nx** 起步，构建两个清晰的能力边界：`provider` 管理模型配置、凭证解析和模型实例；`adk` 管理 Agent、工具和运行循环。第一版复用 Vercel AI SDK 的模型适配接口与具体 provider，避免重复维护多家模型协议；由 Alpha 自己定义 Agent 执行与产品语义。构建一个真实示例验证抽象，再扩展持久化、审批和多 Agent。

当前已有 monorepo 骨架，尚无 Agent 业务实现、业务场景或部署要求。Node.js 服务端、单 Agent 和文本工具调用均为**待确认的设计假设**。包名 `@alpha/*` 为占位符，实际发布前需确认 npm scope。本文是设计方案，不代表功能已经实现。

**第一阶段目标**：开发者用配置选择模型、定义一个带 schema 的工具，通过统一 API 运行 Agent，观察事件流，能够取消运行并限制步数；同一 Agent 切换两个经验证的 provider，无需修改业务代码。

| 决策 | 建议 | 为什么 |
| --- | --- | --- |
| 语言与运行时 | TypeScript，Node.js 服务端优先 | 与 AI SDK 生态契合，便于共享类型；浏览器和其他语言以后单独验证 |
| Monorepo | pnpm workspace + Nx | workspace 管依赖，Nx 管任务图、缓存和模块边界；目录按应用与可复用包划分 |
| 模型接口 | 首版内部采用 AI SDK 的模型接口 | 复用 provider 实现和流式协议，降低重复建设；接受升级耦合，隔离在 provider 与 ADK 的内部边界 |
| Agent runtime | 自建薄层，基于 AI SDK 的生成能力 | 保留运行事件、工具政策和生命周期的控制权；不重新实现厂商 HTTP 协议 |
| 持久化 | MVP 仅内存 session；后续接可替换存储 | 先验证交互与状态边界，避免提前承诺可靠恢复 |
| 编排 | 单 Agent + 工具循环 | 多 Agent、图和持久工作流以真实用例触发，不作为 MVP 前置条件 |

## 02 / 社区调研

调研以官方文档与公开源码为主，结论是针对 Alpha 的工程判断，并非对所有项目的排名。由于未确定首个业务用例，下述对比侧重框架边界而非吞吐或效果基准。

| 参考 | 值得借鉴 | 局限与 Alpha 的选择 |
| --- | --- | --- |
| [Vercel AI SDK：provider 架构](https://github.com/vercel/ai/blob/main/contributing/provider-architecture.md) | provider 规范、具体适配器和上层调用分层；统一模型访问 | 依赖其接口和版本演进；复用模型层，用独立的配置/注册表包承接 Alpha 配置，不包装第二套完整协议 |
| [Google ADK：概览](https://github.com/google/adk-docs/blob/main/docs/get-started/about.md) | Agent、工具、session、memory 等概念明确，支持从单 Agent 成长 | 能力面广；先取 Agent/Runner/session 的边界，延后 memory、复杂多 Agent |
| [OpenAI Agents SDK：TypeScript](https://openai.github.io/openai-agents-js/) | 精简原语、Agent 循环、工具、handoff、trace 和 human-in-the-loop | 有自己的运行模型；参考 API 易用性与可观测性，Alpha 不把某一家 SDK 作为核心运行时 |
| [Mastra](https://github.com/mastra-ai/mastra) | TypeScript 框架与 monorepo 案例，可参考其包组织和示例 | 范围覆盖框架、工具及更多平台能力；许可证需按具体目录核查，不直接照搬全部能力 |
| [LangGraph.js](https://github.com/langchain-ai/langgraphjs) | 图式编排和面向长流程的设计启发 | 图与持久执行增加状态和运维复杂度；真实需求出现时再评估集成或借鉴 |
| [Nx 项目图](https://nx.dev/docs/getting-started/how-nx-works) / [pnpm workspace](https://pnpm.io/workspaces) | `apps/`、`packages/`、显式包依赖、任务图与边界约束 | 不需要照搬模板里的前端或部署服务；以最小目录开始 |

补充参考：[OpenAI sessions](https://openai.github.io/openai-agents-js/guides/sessions/) 展示可替换会话存储；[tracing](https://openai.github.io/openai-agents-js/guides/tracing/) 展示 run / agent / turn / model / tool 的观测层次，也提醒 trace 内容可能含敏感信息。

### 关键取舍：复用还是从零实现？

1. **推荐：AI SDK 模型适配 + Alpha ADK runtime。** 聚焦自身 Agent 体验和工具政策，快速取得多 provider 能力；代价是需要跟踪 AI SDK 的接口、版本及各 provider 的能力差异。
2. **直接采用完整 Agent 框架。** 上手更快，适合业务优先；但 Alpha 需要接受其运行、状态与扩展约束。若第一个业务场景没有差异化框架需求，应通过短期 POC 重新比较这一选项。
3. **完全自建 provider 协议和 runtime。** 控制力强，但工具调用、流式、错误兼容和版本维护成本高；除非存在协议、合规或运行时要求，首版不建议。

## 03 / 目标架构与边界

```text
应用 / CLI / 服务                         组装配置、注入依赖
        |                         |
        v                         v
    @alpha/adk                    @alpha/provider
    Agent / Runner / Tool         配置校验 / 模型注册 / 凭证解析
    循环 / 事件 / 限制             模型实例工厂 / 能力声明
        |                         |
        +------> AI SDK <---------+----> 官方 provider 适配包
                                           |
                                           v
                                    模型服务 / 兼容端点
```

箭头表示依赖方向。`adk` 接收已创建的模型实例；业务入口同时依赖 `adk` 与 `provider` 完成组装。**ADK 不直接依赖 Alpha provider 包**；两者可以共同依赖所选版本的 AI SDK 类型和运行接口。具体厂商包只由 provider 侧或应用组装层引入。禁止 provider 引用 ADK、工具或业务应用。

### Provider：配置与模型解析

- 配置定义 `providerId`、`modelId`、可选 `baseURL`、超时和允许的模型参数；凭证用环境变量名或注入的 secret resolver 表示，不把密钥写入配置文件、日志或事件。
- 配置合并优先级建议：运行时显式覆盖 > 环境变量 > 项目配置 > 安全默认值。启动时校验；错误信息指出字段，隐藏敏感值。请求参数只允许覆盖明确列出的安全字段。
- 注册表按 provider 类型创建 AI SDK 模型实例；提供商的特有参数保留在隔离的扩展字段中，显式校验。以能力声明标记文本、工具调用、流式等支持情况，并通过实际集成测试维护；不假设所有 OpenAI 兼容端点行为一致。
- Provider 只处理连接、实例化和明确归属的模型调用配置；工具执行、会话、循环、审批和业务路由由上层负责。跨厂商自动 fallback 初版不做，尤其不能在工具产生副作用后盲目重放。

### ADK：Agent 的定义与运行

- `Agent` 是声明：名称、指令、模型实例、工具集合及运行默认限制；`Runner` 持有一次 run 的执行状态。工具包含名称、描述、输入 schema 和执行函数。
- 循环：装配上下文 → 调用模型 → 解析输出 → 校验工具参数 → 按策略执行工具 → 将结果回传 → 再次调用模型，直至最终结果、上限、取消或错误。每次 run 独立 `runId`；每个工具调用保留 `toolCallId` 和结果关联。
- 输出统一为事件流和最终 `RunResult`。事件至少包含 `run.started`、`model.started`、`text.delta`、`tool.started`、`tool.completed`、`run.completed`、`run.failed`；携带 runId、时间和必要的调用关联。事件顺序以单个 run 内发送顺序为准，不承诺跨 run 全局顺序。
- 设置 `maxSteps`、超时、`AbortSignal`；错误区分配置、模型调用、输入校验、工具与取消。仅对可判定安全且尚未产生副作用的操作做有限重试；工具默认不自动重试。工具权限由应用注入，MVP 默认仅开放显式注册工具。
- MVP session 为进程内历史，进程退出即丢失；有持久化之前不宣称可恢复。模型上下文是会话历史的受控投影；长期记忆与跨会话检索是独立的未来能力。

## 04 / Monorepo 布局

```text
alpha/
  apps/
    example-agent/             # 第一条端到端示例：唯一应用入口
  packages/
    adk/                       # Agent、Runner、Tool、事件、内存 session
    provider/                  # 配置、注册表、模型工厂与厂商适配组装
  docs/                        # 架构决策与指南
  package.json                 # 根脚本、锁定包管理器版本
  pnpm-workspace.yaml
  pnpm-lock.yaml
  nx.json
  tsconfig.base.json
```

先不拆 `core`、`events`、`memory`、每家 provider 独立包：当存在独立发布、依赖隔离或第二个明确消费者时再提取。应用只能通过包的公开 `exports` 访问；内部依赖使用 `workspace:*`，禁止跨包引用 `src` 私有路径与循环依赖。拟发布包编译到 `dist`，明确 ESM、类型声明与 Node 兼容范围；发布策略和最低版本在落地前锁定。`build` 依赖上游构建，`test`、`typecheck`、`lint` 在 CI 中执行；缓存声明输出，依赖环境变量与密钥的集成测试不使用共享缓存。锁文件入库、使用冻结安装。

## 05 / 接口草案与调用示例

以下为目标 API 的伪代码，不是可直接安装运行的现有 API。具体 AI SDK 版本、schema 库与兼容性在 POC 中锁定。

```ts
// 应用入口负责组装；密钥仅在服务端按名称解析。
const registry = createProviderRegistry({
  providers: { primary: { type: 'openai-compatible', apiKeyEnv: 'MODEL_API_KEY', baseURL: 'https://example.invalid/v1' } },
  models: { assistant: { provider: 'primary', modelId: 'example-model' } },
}, { resolveSecret: (name) => process.env[name] });

const agent = defineAgent({
  name: 'assistant',
  instructions: '帮助用户完成任务。',
  model: registry.model('assistant'),
  tools: [lookupTool], // schema 与 execute 均由业务提供
});

const run = runner.stream(agent, { input: '查询订单状态', maxSteps: 8, signal });
for await (const event of run.events) render(event);
const result = await run.result;
```

建议契约：`registry.model(alias)` 在配置无效或能力不匹配时给出明确错误；`run.events` 是单消费者异步流，`run.result` 在完成后返回结果、用量与终止原因；取消和错误也应使 `result` 结束。若底层流消费影响执行，需在实现时定义背压、消费者提前退出和资源释放语义，不能仅依赖此伪代码推断。

## 06 / 执行、安全与可观测性

| 关注点 | MVP 方案 | 后续演进 |
| --- | --- | --- |
| 运行边界 | 最大步数、超时、取消；工具输入 schema 校验 | 按租户的预算和限流，细粒度策略 |
| 工具副作用 | 显式注册与授权；危险工具默认不提供；不自动重试 | 审批状态机、幂等键、外部操作对账 |
| Prompt injection | 工具结果视作不可信数据；工具权限与输入检查独立于模型指令 | 隔离执行、策略引擎与攻击评测 |
| 状态 | 进程内 session；同一 session 的并发写入需串行或显式拒绝 | 事务、版本控制、恢复、数据保留/删除策略 |
| 日志与 trace | 默认只记录 ID、耗时、状态、用量；密钥和正文不记录 | 显式授权的内容采样、脱敏与可配置 exporter |
| 配置 | 服务端注入 secrets；错误与事件脱敏 | 密钥管理服务、轮换、多租户隔离 |

**重试与恢复边界**：模型请求超时并不证明服务端未处理请求；只对不会触发工具副作用的阶段进行有限重试并记录重复成本。任何外部写操作都需要业务级幂等及对账才能安全恢复；事件流与内存 session 本身不提供 exactly-once 或崩溃恢复保证。

## 07 / Roadmap 与验收

时间按阶段排列而非日期承诺；具体工期取决于团队规模与业务约束。阶段可在上阶段验收后推进。

| 阶段 | 建设内容 | 退出标准 |
| --- | --- | --- |
| P0 / 定方向 | 选首个真实业务场景；确认 TS/Node、目标模型与部署环境；做 AI SDK 与完整框架对照 POC；记录 ADR | 一个场景、两个真实可访问的 provider、平台约束和依赖策略明确；若无差异化需求，重新评估是否自建 runtime |
| P1 / Monorepo 基础 | workspace、Nx、TS 配置、包导出、CI、example 脚手架 | 冻结安装、构建、类型检查、lint、测试在干净环境通过；包依赖无循环 |
| P2 / Provider 层 | schema 校验、配置合并、secret resolver、注册表；接入两个目标 provider | 参数错误及缺少 secret 明确失败且不泄密；通过两家模型的文本、流式、工具调用契约测试；文档注明能力差异 |
| P3 / 单 Agent MVP | Agent/Runner、工具 schema、流式事件、内存 session、步数/超时/取消、示例 | mock 测试覆盖完整循环、无效参数、工具失败、最大步数、取消；真实模型完成端到端示例且切换 provider 不改 Agent 业务逻辑 |
| P4 / 可运营试用 | trace、结构化错误、用量统计、评测集、真实业务试点 | 建立至少一组可复跑的任务集与人工标注基线；记录成功率、延迟、成本及失败分类；默认不泄露正文或密钥 |
| P5 / 按需扩展 | 可持久化 session、审批、MCP、检索或多 Agent | 每项均有独立 ADR、威胁建模及真实需求；恢复、权限与副作用契约经故障测试验证 |

### 首个迭代建议任务

1. 写一页业务用例：输入、预期输出、工具、副作用、成功标准和部署边界；选定两个确实需要支持的模型服务。
2. 用相同场景比较 AI SDK 自带 Agent 能力、OpenAI Agents SDK 与拟议薄层：记录工具循环、流式、迁移成本和失败处理；设定退出条件，避免为了建框架而建框架。
3. 初始化 workspace 并建立 `adk`、`provider`、`example-agent`；先用 mock model 跑通事件与工具循环，再加真实 provider 集成测试。
4. 固化最小开发者体验：示例、配置模板、环境变量说明、测试命令、兼容矩阵及 ADR；禁止提交真实密钥。

## 08 / 测试与验收策略

- **单元测试**：配置合并及脱敏、工具 schema、终止条件、事件顺序和错误分类；使用可控 mock 模型重放工具调用，不消耗真实 API。
- **契约测试**：每个 provider 使用同一测试套件检查文本、工具调用、流式、取消与错误映射；对不支持的能力明确标记并跳过，记录原因。真实 API 在受控环境运行，设置预算且不将输出当作确定性快照。
- **集成测试**：示例使用真实凭证走通模型 → 工具 → 最终回复；验证两个 provider 切换仅改变配置。故障注入超时、畸形参数、工具异常与消费者提前退出。
- **质量门禁**：每个 PR 执行冻结安装、lint、typecheck、单元测试与 build；依赖凭证的测试放在受控环境执行并单独报告。发布前检查包导出、类型声明和干净安装的示例。

## 09 / 风险与待决问题

| 问题或风险 | 当前处理与决策时点 |
| --- | --- |
| 首个 Agent 场景、是否开源、用户是谁 | P0 确认；决定抽象深度和 API 稳定性 |
| 语言/运行时未定 | TS/Node 是建议；如果主要运行在 Python 或浏览器，应重新比较生态和运行边界 |
| provider 是仅模型配置还是统一所有外部服务配置 | 本方案限定为模型提供商；数据库、工具凭证、部署配置由应用或各自适配器负责 |
| AI SDK 上游升级和提供商能力漂移 | 锁定版本、隔离调用、维护契约测试与兼容矩阵，升级走专门变更 |
| 国产模型、私有模型、代理网络和数据合规 | P0 确认目标厂商、端点和数据边界；兼容协议不代表工具语义一致 |
| 多租户、长期任务、审批与持久恢复 | 暂不承诺；有明确要求时先设计状态、隔离、幂等与运维方案 |
| 多模态、语音、A2A、MCP | 不在 MVP；根据业务优先级逐项验证，不预先承诺实现时间 |

## 10 / 参考资料

- [Vercel AI SDK：provider architecture](https://github.com/vercel/ai/blob/main/contributing/provider-architecture.md)
- [Google ADK：概览](https://github.com/google/adk-docs/blob/main/docs/get-started/about.md) · [Agent 概念](https://github.com/google/adk-docs/blob/main/docs/agents/index.md)
- [OpenAI Agents SDK for TypeScript](https://openai.github.io/openai-agents-js/) · [Sessions](https://openai.github.io/openai-agents-js/guides/sessions/) · [Tracing](https://openai.github.io/openai-agents-js/guides/tracing/) · [Testing](https://openai.github.io/openai-agents-js/guides/testing/)
- [Mastra 仓库与许可说明](https://github.com/mastra-ai/mastra) · [LangGraph.js 仓库](https://github.com/langchain-ai/langgraphjs)
- [Nx：项目与任务图](https://nx.dev/docs/getting-started/how-nx-works) · [模块边界](https://nx.dev/docs/kb/enforce-module-boundaries) · [pnpm workspace](https://pnpm.io/workspaces)
