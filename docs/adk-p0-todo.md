# ADK P0 TODO

状态：13 / 13 项完成；真实端点与最终验收通过 · 基线：K3 / ADK P0 Spec · 日期：2026-11-04

P0 目标是交付可用的单 Agent 微内核。以下 13 项按依赖推进；目前 39 / 39 条验收检查完成。实现、本地故障测试、协议夹具与本机真实端点工具闭环均已通过。详见 [验收记录](adk-p0-validation.md)。

[P0 Spec](adk-p0-spec.md) · [详细设计 K3](adk-kernel-detailed-design-k3.html) · [交互评审页](adk-p0-review.html)

## 推进顺序

| 阶段 | 任务 | 退出条件 |
| --- | --- | --- |
| A 契约与基础 | P0-01 → P0-02；随后 P0-03 / 04 / 05 | 公共类型、工具归一化、历史与扩展基础可独立验证 |
| B 内核闭环 | P0-06 → P0-07 / 08 → P0-09 | 无插件也完成模型 → 工具 → 模型 |
| C 装配与验证 | P0-10 → P0-11 / 12 | 插件生命周期与自动化 / 真实模型验证完成 |
| D 完成检查 | P0-13 | 所有验收证据齐全，文档与实现一致 |

斜杠表示前置完成后互不依赖的工作分支，不是必须同时开工。任务不承诺日历工期或人员分配。局部测试随任务完成；P0-11 补跨模块故障组合与类型回归。

<a id="p0-01"></a>
## P0-01 建立 core 导出与依赖边界

依赖：无。规范：[S01](adk-p0-spec.md#s01)、[S02](adk-p0-spec.md#s02)。验收组：G2。

让后续实现落在唯一入口，并落实 ADK → Provider 的单向类型依赖。

实施产物：packages/adk/package.json、src/core/index.ts、相关 tsconfig、eslint.config.js、README.md 与锁文件。

- [x] 新增 ./core 的 ESM / types 导出，内部路径及 standard / loops 不开放；声明所需的 Provider 与标准 schema 类型依赖可解析。
- [x] 调整 Nx / ESLint 标签，同时加入运行时 import 的边界检查；允许类型引用，禁止厂商实现、Provider 工厂与反向依赖。
- [x] 加入 ADK test / 类型测试基础配置，沿用 Node 内置测试与现有工具链；空入口构建和产物导入检查可运行。

<a id="p0-02"></a>
## P0-02 固化公共类型、配置与错误契约

依赖：[P0-01](adk-p0-todo.md#p0-01)。规范：[S02](adk-p0-spec.md#s02)、[S10](adk-p0-spec.md#s10)、[S11](adk-p0-spec.md#s11)。验收组：G2。

把 K3 的统一 API 和本 spec 的错误分支变成可检查的类型约束。

实施产物：core/contracts.ts、内部配置校验与 errors 模块、test/types.ts。

- [x] 声明 Agent、AgentOptions、Tool、Plugin、Hooks、消息、事件与结果；createAgent 始终异步，createTool 同步。
- [x] 冻结限额默认值与稳定错误码；拒绝非法限额、身份、插件版本、缺失 / 冲突模型等配置，错误不含敏感内容。
- [x] 类型用例证明真实 provider.use 可直接注入、appContext 推导正确；loop / createLoop / provideLoop 无公共出口。

<a id="p0-03"></a>
## P0-03 实现单 schema 的 createTool

依赖：[P0-02](adk-p0-todo.md#p0-02)。规范：[S06](adk-p0-spec.md#s06)。验收组：G2 / G4。

让开发者仅写一个 input，完成描述、类型推导与一次校验。

实施产物：core/create-tool.ts、schema 归一化测试与类型用例。

- [x] 从标准结构协议读取 JSON Schema 输入描述并缓存；ADK 不导入具体 schema 库运行时。
- [x] prepare 支持同步 / 异步校验，输出必须为可复制的 JSON 对象；冻结后的同一份参数用于授权与 execute。
- [x] 覆盖转换后的参数一致性、校验失败、非 JSON 输出、输入被修改、普通工具与带上下文工具混用；业务工具默认 effect=unknown。

<a id="p0-04"></a>
## P0-04 实现历史、配对与容量预留

依赖：[P0-02](adk-p0-todo.md#p0-02)。规范：[S07](adk-p0-spec.md#s07)、[S10](adk-p0-spec.md#s10)。验收组：G4 / G7。

先保证已发生的执行事实不会因记录失败或历史修改而丢失。

实施产物：core/internal/history.ts 与纯数据测试。

- [x] 实现消息 ID 校验、assistantId + callId 配对、不可变快照与原子替换；拒绝孤立、重复和不完整工具批次。
- [x] 提交 assistant 前按真实 ID 预留工具结果条数及占位字节；覆盖 UTF-8、continuation 与精确边界容量。
- [x] 覆盖结果正文超限后的占位提交、outcome_unknown 导致 blocked、失败替换保持旧历史和已确认历史恢复。

<a id="p0-05"></a>
## P0-05 实现事件分发与三个 hook

依赖：[P0-02](adk-p0-todo.md#p0-02)。规范：[S08](adk-p0-spec.md#s08)。验收组：G8。

提供确定的扩展顺序，同时保证观察者无法改变运行一致性。

实施产物：core/internal/events.ts、hook 调用辅助与相关测试。

- [x] 实现 run 内 seq、先提交后通知、订阅快照和 unsubscribe；没有监听者时没有额外队列。
- [x] 实现 beforeModel、authorizeTool、mapToolResult 的串行顺序与阶段失败传播；deny 不能被后续 allow 覆盖。
- [x] 隔离同步监听异常与异步拒绝；onObserverError 再失败不递归；覆盖重入保护、abort 例外和正文最小化。

<a id="p0-06"></a>
## P0-06 实现 Run controller 与统一 finalizer

依赖：[P0-04](adk-p0-todo.md#p0-04)、[P0-05](adk-p0-todo.md#p0-05)。规范：[S04](adk-p0-spec.md#s04)、[S09](adk-p0-spec.md#s09)、[S10](adk-p0-spec.md#s10)。验收组：G5 / G6 / G7。

建立所有模型、工具和循环共同遵循的取消、预算与收束机制。

实施产物：core/internal/run-controller.ts、停止信号与故障注入测试。

- [x] 实现 run 占用、activeOp、预算预留、首次 stopIntent 仲裁与单一 finalizer；控制器接口先用可控操作测试。
- [x] 覆盖已取消输入、调用前后取消、预算与错误竞争；禁止提前释放未完成操作，最多一个 run.end。
- [x] finalizer 补齐 pending、判定 blocked、释放计时器和 signal listener；不合作操作在测试主动释放前必须保持等待。

<a id="p0-07"></a>
## P0-07 实现 Provider 模型网关

依赖：[P0-04](adk-p0-todo.md#p0-04)、[P0-05](adk-p0-todo.md#p0-05)、[P0-06](adk-p0-todo.md#p0-06)。规范：[S05](adk-p0-spec.md#s05)、[S10](adk-p0-spec.md#s10)。验收组：G3 / G10。

直接消费现有 LanguageModel，提交可信的模型结果。

实施产物：core/internal/model-gateway.ts、投影函数与流协议测试。

- [x] 投影 instructions、历史与 Tool.info，透传 signal，并以 model.stream(...) 调用保留 this；不增加模型 bridge。
- [x] text-delta 只预览，独立 tool-call 不执行；唯一 finish + 正常迭代结束后才提交 assistant 与 pending。
- [x] 覆盖缺失 / 重复 finish、finish 后事件、流异常、坏调用批次、custom 未转换、取消、超限及 continuation 原值回传。

<a id="p0-08"></a>
## P0-08 实现工具网关与执行账本

依赖：[P0-03](adk-p0-todo.md#p0-03)、[P0-04](adk-p0-todo.md#p0-04)、[P0-05](adk-p0-todo.md#p0-05)、[P0-06](adk-p0-todo.md#p0-06)。规范：[S06](adk-p0-spec.md#s06)、[S07](adk-p0-spec.md#s07)、[S09](adk-p0-spec.md#s09)。验收组：G4 / G6 / G7。

让所有工具能力都经过同一条校验、授权和执行路径。

实施产物：core/internal/tool-gateway.ts 与副作用阶段测试。

- [x] 实现调用归属、prepare、授权、执行预算、开始事件、execute 和结果处理；每次 await 后检查停止意图。
- [x] 实现当前 run 同键防重、跨 assistant 同 callId 合法、未知工具与校验失败不执行、拒绝不消耗执行预算。
- [x] 覆盖 read 异常、write / unknown 异常、返回后处理失败、取消后成功以及历史容量不足；验证 execution、run 与 blocked 一致。

<a id="p0-09"></a>
## P0-09 组装内置 Loop 与 Agent 行为

依赖：[P0-06](adk-p0-todo.md#p0-06)、[P0-07](adk-p0-todo.md#p0-07)、[P0-08](adk-p0-todo.md#p0-08)。规范：[S04](adk-p0-spec.md#s04)、[S09](adk-p0-spec.md#s09)。验收组：G1 / G5 / G6。

形成不依赖外置循环或插件的最小 Agent 执行闭环。

实施产物：core/internal/create-loop.ts、内部 Agent 实例实现与端到端假模型用例。

- [x] 串行 await 模型和当前工具批次，批次完成后再调模型；自然 outcome 与受控停止均进入唯一 finalizer。
- [x] 实现 prompt、state、subscribe、abort、waitForIdle、replaceMessages 及内部关闭运行入口；不增加第二个公开创建函数。
- [x] 无插件完成文本回答和多轮工具调用；验证并发 prompt 拒绝、状态机和共享模型下不同 Agent 的运行隔离。

<a id="p0-10"></a>
## P0-10 完成 createAgent 与插件生命周期

依赖：[P0-02](adk-p0-todo.md#p0-02)、[P0-05](adk-p0-todo.md#p0-05)、[P0-09](adk-p0-todo.md#p0-09)。规范：[S02](adk-p0-spec.md#s02)、[S03](adk-p0-spec.md#s03)、[S09](adk-p0-spec.md#s09)。验收组：G9。

用唯一异步创建工厂完成显式装配、就绪和关闭。

实施产物：core/create-agent.ts、internal/plugin-registry.ts、internal/plugin-lifecycle.ts。

- [x] 实现临时 setup 注册、直接配置合并、依赖顺序、冲突校验、冻结与内置 Loop 装配；捕获的注册句柄在 setup 返回后失效。
- [x] 顺序 start 就绪才返回 Agent；初始化 signal 单独作用，失败 / 取消清理已进入启动阶段者，包含失败者。
- [x] close 先收束 run 再逆序 dispose；覆盖中途清理失败、重复 close、setup 抛错、延迟注册和创建后初始化 signal 不影响运行。

<a id="p0-11"></a>
## P0-11 完成故障矩阵与类型回归

依赖：[P0-09](adk-p0-todo.md#p0-09)、[P0-10](adk-p0-todo.md#p0-10)。规范：[S02](adk-p0-spec.md#s02)、[S04](adk-p0-spec.md#s04)、[S05](adk-p0-spec.md#s05)、[S06](adk-p0-spec.md#s06)、[S07](adk-p0-spec.md#s07)、[S08](adk-p0-spec.md#s08)、[S09](adk-p0-spec.md#s09)、[S12](adk-p0-spec.md#s12)。验收组：G1 / G2 / G3 / G4 / G5 / G6 / G7 / G8 / G9。

把关键不变量变成可重复运行的自动化证据。

实施产物：packages/adk/test 的运行测试、类型测试和测试夹具。

- [x] 对齐 G1–G9，优先补跨模块组合场景；复用已有单元覆盖，不机械重复同一实现断言。
- [x] 使用可控 Promise / 流和副作用计数证明竞态结果；测试自行释放挂起操作，禁止依赖随机时序或真实模型文本。
- [x] 从产物公开入口验证类型与 exports；使用项目 tsrs 验收，必要时 tsc 辅助；默认 pnpm test 包含 ADK 用例。

<a id="p0-12"></a>
## P0-12 交付示例与 Provider 联调证据

依赖：[P0-09](adk-p0-todo.md#p0-09)、[P0-10](adk-p0-todo.md#p0-10)。规范：[S02](adk-p0-spec.md#s02)、[S05](adk-p0-spec.md#s05)、[S12](adk-p0-spec.md#s12)。验收组：G10。

证明抽象能直接连接现有 Provider，并让开发者照文档运行。

实施产物：apps/example-agent、ADK README、Provider 集成夹具与联调记录。

- [x] 示例只从 core 导入 createAgent / createTool，直接传 provider.use；包含一个只读工具、事件消费和 finally close。
- [x] 使用真实 Provider 实现 + 注入 fetch 的协议夹具，覆盖工具往返、取消、Anthropic continuation 与 Responses 完整历史请求。
- [x] 显式运行至少一个已配置真实端点的工具闭环，记录模型、日期、命令和结果；未配置凭证或跳过须标未验证，不冒充通过。

<a id="p0-13"></a>
## P0-13 执行 P0 完成检查

依赖：[P0-11](adk-p0-todo.md#p0-11)、[P0-12](adk-p0-todo.md#p0-12)。规范：[S01](adk-p0-spec.md#s01)、[S12](adk-p0-spec.md#s12)。验收组：G1 / G2 / G3 / G4 / G5 / G6 / G7 / G8 / G9 / G10。

用完整证据判定 P0 完成，避免只跑通主路径。

实施产物：检查记录、更新后的 TODO、README 与 spec。

- [x] 在锁文件一致的环境执行 build、typecheck、lint、test；既有 Provider 测试通过，未把真实端点测试放进默认缓存门禁。
- [x] 核对导出、运行时依赖、包体积清单和文档；无 standard / loops 业务入口，无新模型协议包装，无超出 P0 的能力混入。
- [x] 逐项关联 G1–G10 与测试 / 联调证据后勾选完成；若有失败或未验证，保留未完成状态并写明原因。

## 完成证据与检查命令

任务完成记录至少包括变更位置、相关测试命令及结果；真实模型联调额外记录端点、模型和日期。未实现、失败、跳过与缺凭证都不能勾选为完成。

以下仓库命令已通过验收；真实端点工具闭环也已通过，P0-12 / P0-13 的证据已齐全：

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```

真实端点探针独立显式运行，不进入默认缓存门禁。本次使用 http://127.0.0.1:3425/v1、codex/gpt-6.1-sol 和显式无认证配置完成 2 次模型调用、1 次只读工具执行，verified=true；详见验收记录。

HTML 初始状态来自本文件；浏览器中的手动改动只在本地保存，可导出 JSON，不回写本文件，也不自动验证任务完成。
