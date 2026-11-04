# Session S2：Agent 执行、Session 持久化

状态：已实现并通过验收。详见 [验收记录](adk-session-s2-validation.md)。替代 S1 的公开执行门面；已有 formatVersion=1 归档兼容。

## 公开边界

- 调用方始终使用 `agent.prompt(input, { requestId?, signal? })`，返回原 `RunResult`。
- `createSession({ store, namespace, agentKey, ... })` 创建单会话；批量 CRUD / 重开仍由 `createSessionManager` 提供。
- `createSessionPlugin({ session })` 将会话独占绑定到 Agent。Session 不再提供 prompt / abort，也不接受 createAgent 工厂。
- Session 提供 id、state、getSnapshot、subscribe、flush、close。state 分别记录 binding、归档健康度、最近 requestId 和 persistence。
- Agent 控制执行、取消、等待、关闭；关闭等待准备、执行、保存尝试及插件释放。Session / Store 是借用资源，Agent 不关闭它们。
- Session 或 Manager 存在绑定时，close 以 SESSION_BOUND 拒绝，且允许解除绑定后重试。插件释放尝试补写一次并解除绑定；失败保留原 Session 的补写候选，不把存储失败伪装为执行失败。
- 本仓库尚未发布，移除 S1 的执行门面，不维护两套公开执行 API。

## core 的唯一新增能力

增加 `PluginAPI.provideRunBoundary(boundary)`，至多一个贡献者，不引入 Session / Store 依赖，不开放 Loop、模型和工具的调度方法。

`boundary.prepare(request, history)` 在模型 / 工具前被等待。request 提供 input、requestId、agentId、app、signal；history.restore 仅在 prepare 期间有效，执行前验证并导入完整正式历史。

prepare 返回：

- replay：返回已验证的旧 RunResult，不执行 Loop、不重放 Agent 事件，不强制导入旧历史。
- execute：由 core 执行唯一 Loop，再等待 complete(snapshot)。snapshot 包含原 RunResult、完整当前消息和 historyStatus；若 core 无法形成可信终态则传 undefined。

prepare 的异步能力在返回后失效；complete 期间不能修改正式历史。绑定运行边界后禁用外部 replaceMessages，避免绕过归档来源。执行后 complete 意外抛错：保留真实 RunResult、将 boundaryStatus 标记 failed 并阻止后续执行，同时通过错误观察接口报告脱敏诊断。正常存储失败由 Session 转为 unsaved，不抛到此兜底。

Agent 在整个调用（包括准备和保存）期间保持忙碌；waitForIdle 覆盖整个调用；abort / close 同时取消准备与执行，不能打断已发生副作用的保存收束。边界错误仅保留合规 code，不泄露底层 message / cause。

## 存储协议

1. 校验 requestId / 输入 / 绑定，读取最新归档。
2. 已保存的同 ID 同输入返回旧结果；同 ID 异输入拒绝。默认 ID 仅表示新请求，跨进程重试须由宿主传稳定 ID。
3. pending / blocked / 容量检查；选择完整轮次，通过 core 的受控入口恢复并验证历史。
4. CAS 写 pending 后才能进入 Loop。取消发生在已确认准入之后，仍形成 cancelled Turn 并保存。
5. complete 捕获完整增量和真实工具终态，以 CAS 原子追加 Turn 并清 pending。
6. 保存未确认时，agent.prompt 仍返回真实 RunResult；session.state.persistence=pending，下一次 prompt 拒绝。flush 只补写同一个候选。
7. 确认丢失以原候选回读核对；未知 pending 不超时接管、不重放工具。blocked 不能通过选择空上下文绕过。

## 实施与验收

- [x] core 运行边界注册、历史恢复、结果校验、取消 / 关闭、失效能力防护。
- [x] Session 数据句柄、独占绑定、插件、便捷创建和 Manager 生命周期。
- [x] 迁移示例、类型和文档，删除运行包中的 session.prompt / createAgent 依赖。
- [x] 原 Memory / SQLite 存储与跨进程准入、重启、崩溃证据保留。
- [x] Agent 入口覆盖去重、失联确认、保存故障、未知写结果、绑定冲突、早期取消、关闭等待和可补写清理失败。
- [x] build / typecheck / lint / test 和本机模型联调。

范围：本轮不实现 Coding C1 的文件 / shell 工具或 CLI；它们之后复用同一个 Session 插件。
