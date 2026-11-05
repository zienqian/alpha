# @alpha/adk-session

Session S2 是可选持久化扩展。任务统一从 **agent.prompt()** 发起，Session 只管理会话与归档，插件通过 core 的通用运行边界接入。运行包没有 Session.prompt / abort，也不接收 Agent 工厂。

## 使用

```ts
import { createAgent } from '@alpha/adk/core';
import { createSession, createSessionPlugin, createMemorySessionStore } from '@alpha/adk-session';

const store = createMemorySessionStore();
const session = await createSession({
  store, namespace: 'user-42', agentKey: 'support-agent@1',
});
let agent;
try {
  agent = await createAgent({
    model, instructions: '根据已有对话回答。',
    plugins: [createSessionPlugin({ session })],
  });
  const result = await agent.prompt('请记住我的预算是 500 元。', { requestId: 'message-001' });
  console.log(result.text, session.state.persistence);
  // 正常对话继续使用同一个 agent.prompt。保存未确认时先保留句柄并补写。
  if (session.state.persistence?.status === 'pending') {
    const saved = await session.flush();
    if (saved.status === 'pending') console.error('归档仍未确认：', saved.code);
  }
} finally {
  try { await agent?.close(); }
  finally { try { await session.close(); } finally { await store.close(); } }
}
```

`model` 直接来自现有 Provider。省略 requestId 表示一次新请求；重试同一个逻辑输入必须传入原 ID。示例 finally 表示应用退出，不应每条消息都关闭 Agent；持续的保存故障应保留 Session 与 Store，让宿主补写或明确报告退出时未保存。

## 管理、重开与所有权

`createSession` 是单会话便捷工厂。需要列表、修改、删除或重开时使用无执行职责的 Manager：

```ts
import { createSessionManager } from '@alpha/adk-session';
const sessions = createSessionManager({ store, namespace, agentKey });
const session = await sessions.openSession(savedId);
const agent = await createAgent({
  model, instructions,
  plugins: [createSessionPlugin({ session })],
});
const result = await agent.prompt('继续上次的任务');
```

每个 Session 句柄同时只绑定一个 Agent；每个插件实例只能装配一次。Agent 关闭后可以创建一个新的插件，将同一未关闭 Session 绑定到另一个 Agent。不同句柄 / 进程之间由 Store CAS 保护同一归档。

- Agent 拥有执行、abort、waitForIdle、close。close 等待准备、运行、保存尝试及插件释放。
- Session / Manager 不拥有 Agent。存在绑定时它们的 close 返回 SESSION_BOUND，且可在解除绑定后重试。
- Agent 关闭会尝试补写一次再解除绑定，不关闭 Session 或 Store。补写失败时 Agent.close 拒绝，但原 Session 保留候选，可在 Agent 已关闭后继续 flush。
- Session / Manager 关闭遇到未保存候选也会拒绝并保留可重试句柄；不暗中丢弃执行结果。
- 宿主先关闭 Agent，再关闭 Session / Manager，最后关闭借用的 Store。未保存即进程退出仍可能只留下 pending，S2 不承诺恢复丢失的内存结果。

## 身份与保存

| 字段 | 语义 |
| --- | --- |
| namespace | 宿主从可信身份构造的存储作用域；鉴权由宿主负责 |
| session.id | 作用域内唯一，删除后不可复用 |
| agentKey | 宿主维护的模型 / 指令 / 工具兼容版本；不匹配拒绝续接 |
| requestId | 一次逻辑输入的稳定 ID；当前 ID 可在 session.state.requestId 查看 |

Session 插件先恢复并验证正式历史，再用 CAS 写 pending，之后才进入唯一 Loop。运行收束后保存完整 Turn 并清 pending。`agent.prompt()` 等待保存尝试结束，返回原 RunResult；`session.state.persistence` 单独表示 saved / pending。模型已执行但归档未确认时不会改写 RunResult，也不会自动重跑工具。

同请求同输入返回旧 RunResult 和原 committedRevision，不调用模型或工具、不重放事件；同 ID 不同输入返回 REQUEST_MISMATCH。命中旧结果不会强制将历史载入 Agent；下一次真实执行时再恢复，当前归档可从 session.getSnapshot() 读取。

保存未确认时 Session 为 unsaved，后续 prompt 返回 SESSION_UNSAVED。flush 只补写已捕获的候选，STORE_UNAVAILABLE 表示尚未确认，COMMIT_CONFLICT 表示不能安全覆盖。确认丢失会回读核对原候选。

进程崩溃遗留 pending 后，新请求返回 RECOVERY_REQUIRED；没有内存候选的句柄不能通过 flush、换 requestId 或超时接管重跑。未知工具副作用使历史 blocked；即使 selectContext 选择空上下文也不能继续新任务。

## 查询、上下文与事件

Session 提供 id / state / getSnapshot / subscribe / flush / close。state 包含 status、binding、historyStatus、revision、最近 requestId 与 persistence。存储事件使用 session.subscribe，模型 / 工具事件直接使用 agent.subscribe；run.end 先于 session.saved，不能拿 run.end 当保存确认。

Manager 保留 createSession、openSession、getSession、listSessions、updateSession、deleteSession。更新和删除使用 expectedRevision；pending 记录不允许更新或删除。列表按创建时间和 ID 降序分页，默认 20、最大 100。

`selectContext({ turns, signal })` 可返回按归档顺序排列的完整 runId，默认选择所有轮次；不裁剪归档、不自动摘要、不绕过 blocked。项目指令等临时投影不等于完整模型 prompt 审计。

默认准入阈值为 1000 轮 / 64 MiB，已执行的完整结果跨过阈值仍尝试保存。S2 保留 formatVersion=1 与已有 Memory / SQLite 数据，存储全快照的成本随归档增长。

## SQLite 与验证

根入口不加载 SQLite，也没有 core 或 Provider 运行时导入。SQLite 是独立的 `@alpha/adk-session/sqlite` 入口，使用 `better-sqlite3 13.0.3`，在 Bun 1.4.4 下运行。驱动声明为可选 peer dependency（`>=13.0.3 <14`）；工作区开发依赖固定为 13.0.3，仅使用 Memory 的消费者无需安装驱动，SQLite 消费者需要安装它。驱动在创建 SQLite Store 时延迟加载，缺失时返回 `SQLITE_DRIVER_UNAVAILABLE`。事务、WAL、synchronous=FULL、busy_timeout=5000、墓碑及版本校验沿用 S1；表结构、user_version=1 和归档 formatVersion=1 不变。测试使用迁移前 Node / better-sqlite3 和 Bun 内置 SQLite 生成的数据库验证旧历史恢复、请求重放与继续保存。

```ts
import { createSqliteSessionStore } from '@alpha/adk-session/sqlite';
const store = await createSqliteSessionStore({ filename: './sessions.db' });
```

```sh
bun run build
bun run typecheck
bun run lint
bun run test
bun run --filter @alpha/adk-session example
bun run --filter @alpha/adk-session example --sqlite
```

显式真实模型验证：`bun --env-file=.env.local apps/example-agent/integration/session-live.js`。它使用临时 SQLite，验证工具结果、关闭重开后的历史与重复请求去重，不在默认离线测试里执行。

[S2 Spec](../../docs/adk-session-s2-spec.md) · [S2 示例](../../docs/adk-session-example-s2.ts) · [S2 验收](../../docs/adk-session-s2-validation.md) · [Coding Agent 设计](../../docs/coding-agent-design-c1.html)

S1 文档为历史设计；S2 移除了 createAgent 配置、session.prompt / abort 和 Session 转发 Agent 事件，使用方需迁移调用，不需要迁移 formatVersion=1 数据。
