# ADK P0 Spec

状态：已实现并通过本地与真实端点验收 · 基线：K3 · 日期：2026-11-04

P0 交付一个可开发单 Agent 的微内核：开发者从 `@alpha/adk/core` 创建 Agent 和工具，直接接入已有 Provider，由内置 Loop 完成模型、工具和最终回答的闭环。配置可以扩展能力，运行一致性由内核负责。

[详细设计 K3](adk-kernel-detailed-design-k3.html) · [P0 TODO](adk-p0-todo.md) · [交互评审页](adk-p0-review.html)

本稿把 K3 收敛为实施规范。架构与 API 方向沿用 K3；限额默认值沿用 K3 的建议，作为 P0 测试基线，后续可通过配置调整。ADK 实现、本地自动化检查与本机真实端点联调已完成。实施证据见 [验收记录](adk-p0-validation.md)。

<a id="s01"></a>
## S01 目标与范围

P0 必须支持文本输入、单 Agent 多轮历史、串行工具批次、流式文本预览、插件装配、三个固定 hook、取消、预算和一致的终态。

| 内核负责 | 通过能力或插件接入 |
| --- | --- |
| 内置 Loop 与运行状态推进 | 现有 Provider 的 LanguageModel |
| 模型与工具的受控调用 | 业务工具、模型适配器 |
| 历史提交、配对、只读快照与限额 | 上下文处理、授权与结果处理策略 |
| 注册、启动、关闭及事件通知 | 外部连接、观测消费者、业务依赖 |

P0 不包含 MCP 客户端、持久化 Session、checkpoint、审批暂停恢复、并行工具执行、多 Agent、图编排、自动重试或 fallback、热更新、插件发现、进程沙箱、服务端 Responses 增量续接。保留接入能力所需的类型与扩展点，不提前实现这些产品能力。

实施环境沿用仓库当前 TypeScript / ESM / Node.js 工具链；不新增浏览器运行兼容承诺，不另换构建或测试框架。

<a id="s02"></a>
## S02 公开 API 与工程边界

ADK 的唯一业务入口为 `@alpha/adk/core`。对外导出 `createAgent`、`createTool` 及 Agent、Tool、Plugin、上下文、事件等类型；内部路径不导出。

| API | P0 约定 |
| --- | --- |
| createAgent(options) | 始终返回 Promise；插件全部就绪后返回 Agent |
| createTool(spec) | 同步返回规范化 Tool；schema 无效则同步抛错 |
| agent.prompt(input, { signal }?) | 返回 Promise<RunResult>；同一 Agent 不排队、不并发 |
| agent.state | 只读快照，含实例状态、历史状态和消息 |
| agent.subscribe(listener) | 返回取消订阅函数 |
| agent.abort(reason?) | 请求停止当前 run；不提前宣告完成 |
| agent.waitForIdle() | 等待当前 run 的 finalizer，不等待插件释放 |
| agent.replaceMessages(messages) | 仅 idle 且非 closing 可原子替换完整历史 |
| agent.close() | 关闭入口，收束 run，释放插件；重复调用复用同一 Promise |

配置字段沿用 K3：id、instructions、model、tools、plugins、hooks、appContext、limits、signal、onObserverError。model 可以直接传入或由插件提供，汇总后必须恰好一个。创建 signal 只影响初始化；prompt.signal 只影响当前 run。

不公开 `loop` 配置、`createLoop`、`provideLoop`、LoopContext、callModel 或 callTool；不提供 standard / loops 第二套入口。静态插件直接使用对象 + satisfies Plugin；有配置或独立资源时使用 createXPlugin。

ADK 仅通过公开类型单向依赖 `@alpha/provider`。禁止 Provider 反向引用 ADK，禁止跨包引用 src 私有路径；ADK 运行时代码不导入 Provider 工厂、厂商 adapter 或特定 schema 库。schema 的标准协议类型必须在产物声明中可解析。

实施需同步 package exports、workspace 依赖、Nx / ESLint 约束和 README；仅放宽 Nx 标签不能替代对运行时依赖的检查。

完整 TypeScript 声明沿用 [K3 接口附件](adk-kernel-detailed-design-k3.html#api)。业务入口如下，模型配置与业务依赖由应用提供：

```ts
import { z } from 'zod';
import { createAgent, createTool } from '@alpha/adk/core';
import { createProvider } from '@alpha/provider';
import { orders } from './app-deps.js'; // 应用提供业务依赖

// 模型目录与协议配置由 Provider 持有；use 创建实例，不发网络请求。
const provider = createProvider({
  providers: {
    primary: {
      adapter: 'openai-completions',
      options: { apiKey: { env: 'OPENAI_API_KEY' } },
      models: { chat: { id: 'your-model-id' } },
    },
  },
});

const getOrder = createTool({
  name: 'get_order',
  description: '查询订单状态',
  input: z.strictObject({ id: z.string().min(1).describe('订单号') }),
  effect: 'read', // 可省略，默认 unknown
  async execute({ id }, { signal }) {
    return JSON.stringify(await orders.get(id, { signal }));
  },
});
const agent = await createAgent({
  model: provider.use('primary', 'chat'), // Provider 直接接入
  instructions: '先查询事实，再回答。',
  tools: [getOrder],
});
try {
  const result = await agent.prompt('查询订单 A123');
  console.log(result.status, result.text);
} finally {
  await agent.close();
}
```

<a id="s03"></a>
## S03 创建与插件生命周期

插件契约为 id、apiVersion: 1、可选 requires、同步 setup、可选异步 start(signal) 与 dispose。requires 必须已在显式清单前面出现；不自动解析或下载依赖。

创建顺序固定：

1. 检查配置、创建信号、插件身份、版本和依赖顺序。
2. 执行 setup，向临时表收集 model、tools、hooks 和 observers；setup 不分配需要释放的外部资源。
3. 校验唯一模型、工具名与限额，复制冻结配置；setup 返回后注册 API 立即关闭。
4. 创建私有 Loop，按清单顺序 await start；缺省 start 视为立即成功。
5. 全部就绪后解除初始化信号关联，返回 idle / ready 的 Agent。

创建失败或取消时，先 abort 启动信号，等待当前启动收束，再逆序 dispose 所有已经进入启动阶段的插件，包含失败者。每个 dispose 至多一次；未进入启动阶段者不清理。保留原失败，附加清理错误。

PluginAPI 只允许 provideModel、addTool、hook 和 observe。直接配置的 hooks 在前，插件贡献按清单顺序追加。start 阶段及之后禁止注册新贡献。

<a id="s04"></a>
## S04 内置 Loop 与运行状态

Loop 是内核实现。一次 prompt 在首个 await 前占用 run，登记信号、发 run.start、提交 user，然后进入以下循环：

1. await 模型网关，取得已正式提交的 assistant。
2. outcome 为 tool_calls 时，按调用列表顺序 await 所有工具结果。
3. 当前批次结果完整后继续调用模型；其他合法 outcome 结束循环。
4. 预算、取消或故障由受控网关中断循环，交给唯一 finalizer。

| 状态 | 含义 |
| --- | --- |
| Agent.status: idle / running / cancelling / closed | 实例当前能否接收工作及是否正在收束 |
| historyStatus: ready / blocked | 历史是否允许安全续接 |
| RunResult.status | completed / refused / incomplete / unknown / limited / cancelled / failed |

同一 Agent 最多一个 run，同一 run 最多一个 activeOp。busy、closed、closing、blocked 或非法输入导致 prompt reject，不产生新 run 或历史变更。已经 aborted 的 prompt.signal 产生一对 run.start / run.end(cancelled)，不提交 user、不调用模型。

自然终态要求 Loop 正常返回、没有停止意图、没有活动操作或未配对调用。内部重叠调用和提前返回是内核不变量错误，不允许留下后台执行。

<a id="s05"></a>
## S05 Provider 直接接入

model 直接接受 `provider.use(...)` 返回的 LanguageModel。内核通过对象方法调用 stream，保留接收者，复用 GenerateInput、GenerateResult 和 StreamEvent。

| 输入或事件 | 内核处理 |
| --- | --- |
| instructions | 每次请求的首条 system 消息 |
| user / assistant / toolResult | 转为 Provider Message；只传协议支持的字段 |
| Tool.info | 投影为 name、description、inputSchema；不传 effect 或执行函数 |
| run.signal | 透传给 GenerateInput.signal |
| text-delta | 只发 model.delta，文本为暂时预览 |
| tool-call | 不执行、不另建 pending 列表 |
| finish.result | 迭代正常结束后验证、复制冻结、提交为 assistant |

必须恰好一个 finish；缺失、重复、finish 后事件或流异常均不提交本次 assistant、不执行本次工具。只有 finish.result.toolCalls 是工具请求的执行来源。tool_calls 必须非空，其他 outcome 不得携带工具；同一响应 callId 非空且唯一。

assistant 保留 GenerateResult 原字段及新增 id / role；正文用 text。refused、incomplete、unknown 是合法终态。RunResult.text 取本 run 最后已提交 assistant 的文本；reason 优先 refusal / incompleteReason，其次 finishReason。

请求使用新建数组与复制数据，不把冻结历史传作可变输入。continuation 必须与对应 assistant 原值一起回传；responseId 保留但不自动使用 previousResponseId。首版始终发送经投影后的完整上下文，跨模型 opaque 数据迁移不保证兼容。

custom 消息必须经 beforeModel 显式转换或移出投影，否则调用失败。保留的工具批次必须完整且与正式历史一致，可以整组裁剪。

<a id="s06"></a>
## S06 工具定义与执行

业务只声明 name、description、input、可选 effect 与 execute。input 同时提供 Standard Schema 校验和 Standard JSON Schema 描述能力；参数类型从该 schema 推导。不要求重复填写 TypeScript 输入类型、JSON Schema 或 parse。

createTool 缓存模型使用的输入 schema 描述，并生成 prepare。prepare 仅校验一次，把规范化后的 JSON 对象复制冻结，用同一份参数执行授权和业务闭包。推导输出必须可表示为 JSON 对象；非 JSON 结果不能进入授权或 execute。无 app 依赖的工具泛型默认为 unknown。

内部调用键为本 run 内的 (assistantId, callId)。同键重复只返回已完成结果；跨 assistant 的相同供应商 callId 是不同调用。每个调用仅有一个结果，不承诺跨进程恰好执行一次。

顺序固定为：归属检查 → prepare → authorizeTool → 预算预留 → tool.start → 重检停止 → execute → 输出检查及 mapToolResult → 提交。每次 await 后都检查停止意图；内核不自动重试。

| 情况 | execution | run 与历史 |
| --- | --- | --- |
| 未知工具、参数无效、执行前失败或取消 | not_executed | 相应 failed / cancelled；补齐后 ready |
| 授权 deny | denied | 不执行，Loop 可继续让模型解释 |
| execute 正常返回 | succeeded | 可继续，ready |
| effect=read 的 execute 抛错 | failed | run failed，ready |
| effect=write / unknown 的 execute 抛错 | outcome_unknown | 首次停止意图决定 run；历史 blocked |
| execute 已返回，后处理或输出检查失败 | succeeded + 占位文本 | run failed，ready，不重跑 |
| 取消后 execute 仍正常返回 | succeeded | 保留结果，run 仍 cancelled |

effect 默认 unknown，是可信代码的声明。业务工具返回字符串；工具事实由 execution 表达，不增设 isError。参数、授权或 hook 的原始错误内容不能直接泄漏给模型或事件消费者。

<a id="s07"></a>
## S07 历史与容量

正式历史由内核独占写入。每次提交产生新顶层数组和不可变记录，旧快照可安全复用；delta 不写入历史。消息 ID 在当前历史中唯一；工具结果按 assistantId + callId 配对，不允许孤立或重复结果。

提交带工具调用的 assistant 前，必须为每个工具结果预留消息条数与最短安全占位记录的字节空间。容量不足则不提交 assistant、不执行该批次。执行后正文放不下时使用预留空间保留 execution，不能丢失副作用事实。

replaceMessages 仅在 idle 且非 closing 生效，完整校验后原子替换；校验失败保留旧历史。拒绝未配对历史与 outcome_unknown。blocked 后须由应用核对外部状态再提供已确认的完整历史，不能直接通过字段切换解锁。

字节限制按 UTF-8 编码的 JSON 计算，包含 continuation。用户客户端、函数和 appContext 不进入历史或快照。

<a id="s08"></a>
## S08 Hooks、事件与重入

| 扩展点 | 确定语义 |
| --- | --- |
| beforeModel | 串行变换本次投影，不修改正式历史；最终统一校验 |
| authorizeTool | 对已校验参数逐项判定；首个 deny 短路，后续 allow 不覆盖 |
| mapToolResult | 串行变换文本，不改 execution、assistantId 或 callId |
| subscribe / observe | 顺序通知事实，不提供运行控制句柄或持久化保证 |

hook 抛错进入统一失败路径；结果处理故障仍保留已确认执行事实。没有可重复调用 next 的通用中间件。

事件包括 run.start、run.stop_requested、model.start / delta / end、tool.start / end、message.commit、run.end。每个事件有 agentId、runId、seq；seq 在 run 内从 1 递增，先提交状态后通知。每个 run 最多一次 stop_requested 和一次 run.end。

除 model.delta 的预览文本外，事件仅携带必要 ID 与状态。没有订阅者时也正常执行；没有默认队列或回放。同步监听异常和异步拒绝交 onObserverError，不影响运行；错误处理器失败不递归报告。慢同步监听会阻塞当前调用栈。

事件回调内拒绝 prompt、replaceMessages、close 等状态重入；abort 例外。订阅列表在分发开始时取快照，增删影响后续事件。

<a id="s09"></a>
## S09 停止、关闭与资源释放

stopIntent 只允许第一次写入 cancelled、failed 或 limited。自然完成不能覆盖已经记录的停止；即使执行成功，取消仍可决定 run 终态。

finalizer 负责等待内置 Loop 和已受理工作，补齐未执行 / 未知工具结果，判定 blocked，生成唯一 RunResult 与 run.end，再释放 run 占用及 timer、外部信号监听和临时账本。

正常路径恢复 idle；关闭路径先禁止新 run，等待当前运行收束，再逆序 dispose，最后 settle close。一个 dispose 失败不阻断其他清理；close 聚合 reject，实例仍关闭，不重跑 dispose，也不改写已完成的 RunResult。

timeoutMs 表示发出取消的时间，不是强杀。模型、工具或 hook 不合作时，prompt / close 可能持续等待。测试必须能控制并释放这类悬挂，不使用丢弃后台工作的 Promise.race 作为实现。

<a id="s10"></a>
## S10 P0 默认限额

| 配置 | 默认值 | 语义 |
| --- | --- | --- |
| maxModelCalls | 8 / run | stream 调用前预留，失败不返还，超限 limited |
| maxToolCalls | 32 / run | 执行前预留；同时限制单响应工具列表长度 |
| timeoutMs | 不设置 | 配置后从 run 受理开始计时，触发 cancelled |
| maxModelOutputBytes | 1 MiB | 分别限制 delta 累积量和最终结果 JSON 字节；超限 failed |
| maxToolResultBytes | 128 KiB | 原返回和每次结果变换均检查；超限保留执行事实并 failed |
| maxHistoryBytes | 4 MiB | 提交前检查，含工具结果容量预留；超限 limited |
| maxHistoryMessages | 512 | 包括预留结果条数；超限 limited |

默认值是配置基线，不是性能结论。限制值必须为非负安全整数，容量值必须大于零；timeoutMs 最大为 2,147,483,647 毫秒，零表示立即请求取消。单响应工具列表超过 maxToolCalls 是模型批次校验失败；运行中剩余执行预算耗尽则 limited。deny、参数错误和执行前取消不消耗工具执行预算；tool.start 通知前已预留时不退还。

<a id="s11"></a>
## S11 错误出口与实现约束

| 错误阶段 | 结果通道 |
| --- | --- |
| createTool schema 无效 | 同步抛 TOOL_SCHEMA_INVALID |
| createAgent 配置、setup、start 或初始化取消 | 清理必要资源后 reject，不暴露 Agent |
| prompt 入口条件不满足 | reject，不产生新 run |
| 已受理 run 的协议、工具或 hook 故障 | resolve RunResult(status=failed, error)，统一收束 |
| 预算或取消 | resolve limited / cancelled，附 reason |
| 观察者故障 | onObserverError，不改变 run |
| close 的插件清理故障 | 清理全部后聚合 reject |

稳定错误类别及主要代码沿用 [K3 错误约定](adk-kernel-detailed-design-k3.html#errors)。P0 补齐三个明确分支的命名：未知工具为 TOOL_NOT_FOUND，setup 异常为 PLUGIN_SETUP_FAILED，setup 结束后注册为 PLUGIN_REGISTRATION_CLOSED；仅细化错误分类，不新增控制 API。

禁止把凭证、完整工具参数、HTTP 原始响应或 continuation 放进公共错误。拒绝的工具结果使用固定或明确处理后的文本。取消期间发生其他错误仍遵循首次停止意图。

保持模块高内聚：Loop / controller 管推进，网关管调用，history 管提交，registry / lifecycle 管插件装配。不新增通用 DI、全局注册表、服务定位器或为了封装而存在的公共对象。

<a id="s12"></a>
## S12 完成标准与验收矩阵

| 验收组 | 必须证明 | 对应任务 |
| --- | --- | --- |
| G1 内置循环 | 无插件、无 loop 配置也完成模型 → 工具 → 模型 | P0-09、P0-11 |
| G2 API 与类型 | core 统一导入；单 schema 推导；错误上下文及公开 loop 被拒绝 | P0-01、P0-02、P0-03、P0-11 |
| G3 模型协议 | 畸形流不提交 assistant，工具执行次数为 0 | P0-07、P0-11 |
| G4 工具一致性 | 校验、授权、配对、当前 run 去重与未知副作用语义 | P0-03、P0-04、P0-08、P0-11 |
| G5 串行与互斥 | 双 prompt、批次顺序与内核错误注入均不产生 detached 工作 | P0-06、P0-09、P0-11 |
| G6 取消 | 执行前无副作用；成功事实不丢；未知写入 blocked | P0-06、P0-08、P0-11 |
| G7 容量与收束 | 空间预留、后处理失败、配对补齐及合作取消 | P0-04、P0-06、P0-11 |
| G8 事件 | 无监听、监听失败、重入与 seq 均满足约定 | P0-05、P0-11 |
| G9 插件生命周期 | 注册冻结、启动失败、取消、逆序清理与幂等 close | P0-10、P0-11 |
| G10 Provider 接入 | 真实 Provider 实现的协议夹具及至少一个真实端点闭环 | P0-12 |

P0 完成须满足：

- 全部任务和 G1–G10 有可追溯证据；关键故障路径不以 happy path 替代。
- 从构建产物公开入口验证 exports、类型声明及内部路径不可访问。
- 仓库 build、typecheck、lint、test 通过；ADK 已进入默认 test，既有 Provider 测试无回归。
- 文档、示例、包边界与本 spec 一致；没有特定 schema 库或厂商 SDK 的运行时依赖进入 ADK。
- 真实端点至少完成一轮工具闭环，记录端点、模型、日期、命令和结果；使用端点要求的认证配置；无认证端点须显式配置 none，不在文档写入密钥。缺少必需凭证或被跳过时单列“未验证”，不能标记该项完成。

自动化门禁应使用可控模型、真实 Provider + 注入 fetch 的协议夹具，不消耗网络配额。真实端点验证独立显式运行，不进入默认 Nx 缓存测试。P0 不承诺所有 Provider / 模型都已实测，也不以固定文本快照评判真实模型输出。

任务顺序、产物和逐项验收见 [P0 TODO](adk-p0-todo.md)。
