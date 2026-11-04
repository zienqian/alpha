# Session S2 验收记录

日期：2026-11-04。范围：core 通用运行边界与 Session 插件接入；不包含 Coding C1 文件 / shell 工具。

## 完成项

- `agent.prompt()` 是唯一执行入口，返回原 RunResult；Session 不再有 prompt / abort 或 Agent 工厂配置。
- `createSession` / `createSessionPlugin`、受控历史恢复、CAS 准入、去重短路、等待保存、取消和关闭已实现。
- 保存失败保留候选与真实运行事实；Agent 关闭失败后 Session 仍可补写。Manager / Session 拒绝关闭绑定中的 Agent。
- Session 只使用 core 公开类型；产物无 core / Provider 运行时导入，core / Provider 不反向依赖 Session。
- formatVersion=1 与 Memory / SQLite 协议保持兼容。旧 S1 执行接口已移除，示例迁移至 Agent 入口。

## 自动化验证

| 检查 | 结果 |
| --- | --- |
| `pnpm build` | 4 个项目通过 |
| `pnpm typecheck` | 4 个项目通过 |
| `pnpm lint` | 4 个项目通过 |
| `pnpm test` | 159 项通过：core 83 / Session 51 / Provider 25 |
| Memory 示例 | 恢复预算、两轮归档、重复请求沿用 runId |
| SQLite 示例 | 关闭重开连接后恢复预算、两轮归档、去重通过 |

覆盖准备 / 保存等待、过期历史能力、重复边界注册、脱敏错误、complete 异常隔离；单句柄绑定、保存失败、确认丢失、外部冲突、关闭后补写、取消、未知副作用、完整轮次选择、历史容量、归档版本及身份校验。实际子进程验证竞争准入只执行一次、SQLite 重启恢复、进程在准入 / 工具阶段终止后不自动重跑。

原 S1 的工厂转移 / Session 代理执行测试已按新所有权迁移，Store 与跨进程验证继续使用原存储协议。没有通过保留第二套 Session.prompt 兼容层来满足旧测试。

## 本机模型联调

运行：`node --env-file=.env.local apps/example-agent/integration/session-live.js`

- 端点：`http://127.0.0.1:3425/v1`
- 模型：`codex/gpt-6.1-sol`
- 完成时间：2026-11-04T11:10:05.487Z
- 结果：passed / verified=true；耗时 12,879 ms。
- 3 次模型调用，1 次读取随机验证值的工具执行。
- 重复请求新增 0 次模型调用，返回相同 RunResult。
- SQLite 关闭重开后，从已保存的历史准确恢复工具值；归档为 2 轮、revision=4。

探针使用独立临时 SQLite，最后清理自己的目录；不修改用户项目文件。默认测试仍离线运行。

本地日志：`.nx/s2-build.log`、`.nx/s2-typecheck.log`、`.nx/s2-lint.log`、`.nx/s2-tests.log`、`.nx/session-s2-live.log`。这些日志是本机证据，不是提交所需产物。

## 限制

没有 durable pause、未知 pending 的人工修复、工具重放、文件 checkpoint、摘要或数据库迁移。进程丢失且仅留下 pending 时仍需外部恢复决策；保存失败不等于文件副作用失败。扩展不合作时，取消与关闭继续等待已受理工作。

Agent 上的 requestId 只有配合实现去重的边界才有持久化幂等语义，裸 core 不自动去重。
