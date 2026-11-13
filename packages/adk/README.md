# Alpha ADK

ADK 是带内置 Loop 的单 Agent 微内核。模型、工具和固定阶段的策略通过配置与插件接入，内核管理历史、工具调度、预算、取消和终态。

## 使用

唯一入口是 `@alpha/adk/core`。Provider 通过公开的 LanguageModel 类型直接接入；createAgent 始终异步，createTool 同步。

```ts
import { z } from 'zod';
import { createAgent, createTool } from '@alpha/adk/core';
import { provider } from './provider.js';

const lookup = createTool({
  name: 'lookup',
  description: '查询记录',
  input: z.strictObject({ id: z.string() }),
  effect: 'read',
  execute({ id }, { signal }) {
    signal.throwIfAborted();
    return JSON.stringify({ id, status: 'available' });
  },
});
const agent = await createAgent({
  model: provider.use('main', 'chat'),
  instructions: '先查询事实，再回答。',
  tools: [lookup],
});
try {
  agent.subscribe(event => {
    if (event.type === 'model.delta') process.stdout.write(event.text);
  });
  const result = await agent.prompt('查询 A123');
  console.log(result.status, result.text);
} finally {
  await agent.close();
}
```

input 同时提供 Standard Schema 校验和 Standard JSON Schema 输入描述。模型 schema 在创建工具时编译，执行参数校验一次；授权与 execute 使用同一份冻结后的 JSON 对象。Zod 仅是示例与测试依赖，不进入 ADK 运行时代码。

## 插件与上下文

静态插件直接对象 + satisfies Plugin；有配置或实例资源时用 createXPlugin 工厂。setup 同步注册 provideModel、provideRunBoundary、addTool、hook、observe，返回后注册窗口关闭；外部连接在 start(signal) 中建立，在 dispose 中释放。

三个 hook 为 beforeModel、authorizeTool、mapToolResult。注册顺序确定；首个 deny 短路。插件不持有 Loop 或内部 callModel / callTool 句柄。需要应用依赖的工具标注 ToolContext<App>，通过 appContext 提供；无依赖工具可以混用于不同 Agent。

`provideRunBoundary` 接入可等待的通用运行边界，至多一个贡献者。prepare 可在执行前恢复完整历史、完成准入，或返回旧结果并跳过 Loop；execute 计划的 complete 在运行收束后被等待。history.restore 仅在 prepare 期间有效，不向插件开放可写消息引用。Session 插件使用这个扩展点，core 不依赖 Session 或存储实现。

边界准备失败拒绝本次调用，仅暴露脱敏 code。complete 意外抛错时，保留已完成的 RunResult，将 `agent.state.boundaryStatus` 标为 failed，拒绝后续执行并通过 onObserverError 报告。正常存储失败由 Session 表达为 unsaved，不触发此兜底。

## 运行约定

- 一个 Agent 同时只接受一个 prompt；并发请求 reject，不排队。
- text-delta 是预览；正常情况下仅完整 finish 且流正常结束后提交 assistant，并从其 toolCalls 执行。引导中断时可将已显示文字保存为 `incompleteReason: "steered"` 的 assistant；不保存未完成的工具参数或 provider continuation。
- 工具结果按 assistantId + callId 配对。effect 默认 unknown；write / unknown 工具抛错会将历史标为 blocked。
- 同一响应中连续的 `effect: 'read'` 调用最多 4 个并行，空位释放后继续调度。`limits.maxConcurrentTools` 可设为正整数，设为 1 恢复全串行。write / unknown 调用等待前面的读取和结果处理完成，后续读取也不会越过它们；不推断 shell 命令是否只读。
- 工具准备和 authorizeTool 按调用顺序执行，至多一个待审批调用。并行 read 的 execute / mapToolResult 可能交错，结果及 tool.end 按完成顺序提交；消费者应使用 assistantId + callId 关联。声明 read 的工具及结果钩子须支持并发调用；存在依赖的读取应分轮请求，或配置串行。
- 任一工具失败、达到预算或取消后不再启动新调用；等待所有已启动工作结束并记录执行事实，再补齐未执行调用、保存快照或释放资源。
- 已返回的工具即使后处理失败，也保留 succeeded 事实；内核不重试工具。
- abort / timeout / close 请求协作停止，等待受理中的工作结束；不合作的扩展可能一直等待。
- 初始化 signal 成功创建后解除关联；prompt.signal 仅影响当前 run。
- waitForIdle 等待整个 prompt，包括边界准备和保存尝试；close 还会逆序等待插件释放。重复 close 返回同一 Promise。
- `agent.state.canSteer` 为 true 时，`agent.steer(input)` 中断当前模型生成并向同一 run 追加用户消息，然后以新 signal 和完整历史续跑。中断只影响当前模型请求或工具准备/审批，不将 run 标记为 cancelled；`model.end.outcome: "steered"` 区分这种切换。已开始的工具及结果处理必须先完成，同批未开始的调用写入 `not_executed` 结果后跳过，不自动重跑已执行工具。多个引导按接收顺序提交。返回的 Promise 在提交时为 true，若本轮结束/取消前未提交则为 false，不泄漏到下一次 prompt。true 表示消息已进入历史，不代表模型执行或保存成功；仍应等待当前 prompt 的结果。引导遵循相同的上下文容量、模型调用和运行期限限制，并随当前 run 的快照保存。显式 abort/close/timeout 优先于续跑。模型和准备钩子必须响应 AbortSignal；不合作的扩展仍会被等待，避免后台工作与续跑重叠。中断请求未报告的 token 用量不计入已知用量。
- 历史是进程内只读快照；未安装运行边界时，replaceMessages 在 idle 时原子替换完整历史，拒绝未知结果与未配对调用。安装边界后外部替换被 HISTORY_MANAGED 拒绝。
- prompt 可传稳定的 requestId；省略时为新请求生成 ID。只有安装实现去重的边界（例如 Session 插件）才有跨调用去重语义，裸 core 不承诺该能力。
- 事件同步有序，无消费者队列或持久化保证；观察者错误独立报告。同步重入产生的停止事件在当前分发后顺序通知。
- 默认 8 次模型、32 次工具、4 个并行只读工具、1 MiB 模型输出、128 KiB 工具结果、4 MiB / 512 条历史；timeout 默认不设置。
- 首版完整历史请求，保留 Provider continuation 与 responseId，不自动启用 previousResponseId。

创建错误与入口错误 reject；已受理运行中的失败通过 RunResult.status=failed 返回。错误不包含原始工具参数、凭证或 HTTP 响应。

## 验证

在仓库根目录执行：

```sh
bun run build
bun run typecheck
bun run lint
bun run test
bun run --filter @alpha/example-agent start
```

示例默认使用真实 Provider 实现与离线 HTTP 夹具，无网络请求。协议联调用例覆盖 Chat Completions、Responses 和 Anthropic Messages。

真实端点验证独立显式运行，先在本机环境或忽略提交的 .env.local 中配置 ADK_MODEL、可选 ADK_BASE_URL、可选 ADK_API_KEY_ENV（默认 OPENAI_API_KEY），以及该变量名对应的凭证。无认证端点显式设置 `ADK_AUTH=none`。本机已使用 `http://127.0.0.1:3425/v1` 与 `codex/gpt-6.1-sol` 完成工具闭环；可复用根目录 [.env.example](../../.env.example) 的非敏感配置。然后从仓库根目录运行：

```sh
bun --env-file=.env.local packages/adk/integration/live.js
```

若环境已经由外部注入，可运行 `bun run --filter @alpha/adk test:live`。此项会访问所配置的模型服务，不在默认测试或 Nx 缓存中执行；未配置返回状态 not_configured 和退出码 2，不算通过。只有真实模型调用工具并返回工具生成的随机值才算验证成功。

[Spec](../../docs/adk-p0-spec.md) · [TODO](../../docs/adk-p0-todo.md) · [验收记录](../../docs/adk-p0-validation.md)
