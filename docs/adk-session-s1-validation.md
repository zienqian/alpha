# ADK Session S1 验收记录

日期：2026-11-04。S1 已实现，12 / 12 项 TODO、36 / 36 条检查完成。验收基于真实 core、离线可控模型、真实 SQLite 和实际子进程；Session 测试 47 / 47 通过，无跳过。全仓库合计 149 / 149（core 77、Provider 25、Session 47）。

[Spec](adk-session-s1-spec.md) · [TODO](adk-session-s1-todo.md) · [包 README](../packages/adk-session/README.md) · [交互文档](adk-session-design-s1.html)

## 环境与工程证据

| 项目 | 本次结果 |
| --- | --- |
| 平台 | Windows x64，PowerShell，Node v20.20.2，pnpm 9.15.1 |
| 编译 / lint | 仓库固定的 tsrs 0.20.1-ts7.1.0-beta、ESLint 10.14.0、Nx 22.7.12 |
| SQLite | better-sqlite3 12.4.1，SQLite 3.50.4；实际安装原生驱动并打开数据库 |
| 可选驱动 | optional peer `>=12.4.1 <14`；开发依赖固定 12.4.1；根入口和 Memory 在驱动不可用时仍可工作 |
| 连接设置 | WAL、synchronous=FULL、foreign_keys=ON、busy_timeout=5000；初始化逐项核对实际值 |
| 依赖方向 | Nx 实际依赖图：Session → ADK → Provider，无反向依赖；Session 只引用 core 类型 |
| 包内容 | `pnpm pack` 产物 26 个文件，仅 dist、package.json、README；两入口的 JS / d.ts 均存在，内部路径受 exports 限制 |

选择 12.4.1 是为了保持当前 Node 20 / Windows 环境可直接安装，未抬高 workspace engines。[12.4.1 官方 manifest](https://github.com/WiseLibs/better-sqlite3/blob/v12.4.1/package.json) 声明 Node 20、22、23、24；事务采用驱动的同步 `transaction(...).immediate()`，[官方 API](https://github.com/WiseLibs/better-sqlite3/blob/v12.4.1/docs/api.md) 定义其提交与异常回滚行为。其他平台、其他 Node 版本、其他 peer 版本未在本次实测，不能把 peer 范围当作整个组合矩阵都已验证。

## 执行命令与结果

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @alpha/adk-session example
pnpm --filter @alpha/adk-session example --sqlite
pnpm exec nx graph --file=.nx/session-project-graph.json
pnpm --filter @alpha/adk-session exec pnpm pack --pack-destination ../../.nx/session-package
```

冻结安装通过；构建、类型检查和 lint 覆盖 4 个包 / 应用项目，全部通过。3 个测试项目全部通过。最终命令可复用未变化的 Nx 缓存；本轮 core、Provider、Session 的测试均已实际运行，SQLite 和进程终止测试没有用跳过或 mock 数据库替代。

两个示例均输出第一轮 revision=2、恢复后的第二轮 revision=4、预算 500 元、重复请求沿用 runId、完整归档 2 轮。SQLite 示例关闭并重新打开连接，使用自身临时数据库；跨操作系统进程恢复另由下述测试验证。

本地原始日志在 `.nx/session-install.log`、`.nx/session-workspace-{build,typecheck,lint,test}.log`、`.nx/session-tests.log`、`.nx/session-pack.log`，图在 `.nx/session-project-graph.json`。这些临时产物不进入版本控制。

## G1–G11 证据对应

| 组 | 实际验证 | 证据文件 |
| --- | --- | --- |
| G1 API 与边界 | 运行时只有两个入口的三个 createX 工厂；内部路径不可导入；根依赖图无外部运行时包 / SQLite；模拟驱动缺失时 Memory 正常，SQLite 返回明确错误码；类型只读、上下文工厂、事件区分；lint 拒绝 core 运行时 / 私有路径 / Provider / 根层驱动导入 | [boundaries.test.js](../packages/adk-session/test/boundaries.test.js)、[types.ts](../packages/adk-session/test/types.ts)，Nx 图、pack |
| G2 管理与隔离 | 两适配器共用 CRUD / CAS / namespace / 不可变快照 / UTF-8 分页 / 墓碑 / 关闭测试；元数据并发版本校验、旧句柄失效；进程竞争使用数据库原子性 | [stores.test.js](../packages/adk-session/test/stores.test.js)、[session.test.js](../packages/adk-session/test/session.test.js) |
| G3 正常恢复 | 新 Agent 导入完整历史；进程 A 保存退出，进程 B 恢复工具批次和 opaque continuation，第三进程返回原 receipt 且零模型调用 | [session.test.js](../packages/adk-session/test/session.test.js)、[processes.test.js](../packages/adk-session/test/processes.test.js) |
| G4 历史选择 | 完整轮次子集保持顺序与全归档；非法选择、异常选择、工作集超限在准入前拒绝；准入中取消保存空轮次 | [session.test.js](../packages/adk-session/test/session.test.js)、[failures.test.js](../packages/adk-session/test/failures.test.js)、[edges.test.js](../packages/adk-session/test/edges.test.js) |
| G5 准入与去重 | 同句柄 busy；多句柄 pending 拒绝；两个进程屏障等待同一 revision 后竞争，只有一个产生写工具副作用；重复请求不执行、不重放事件，不同输入拒绝；删除先赢准入时零执行 | [failures.test.js](../packages/adk-session/test/failures.test.js)、[processes.test.js](../packages/adk-session/test/processes.test.js)、[edges.test.js](../packages/adk-session/test/edges.test.js) |
| G6 提交与补写 | 保存失败保持 RunResult；flush 不重复工具；create / admission / commit 确认丢失可核对；更高版本仍识别原 receipt；异 token 冲突不覆盖；创建异常保留可核对 ID | [failures.test.js](../packages/adk-session/test/failures.test.js)、[edges.test.js](../packages/adk-session/test/edges.test.js) |
| G7 中断与未知 | 在已落 pending 后和实际文件副作用后强制终止子进程；新进程读到 pending、零模型调用且拒绝自动重跑；unknown 工具结果 archived blocked，空上下文也无法绕过；core 异常 reject 保留 pending | [processes.test.js](../packages/adk-session/test/processes.test.js)、[session.test.js](../packages/adk-session/test/session.test.js)、[failures.test.js](../packages/adk-session/test/failures.test.js) |
| G8 取消与清理 | 预取消零写入；准入期间取消仍保存 cancelled；不合作工厂 / 选择器 / 写工具实际收束后才关闭；监听移除，旧信号不取消后续运行；关闭失败不漏其他 Agent，聚合保留各清理错误；借用 Store 不关闭 | [failures.test.js](../packages/adk-session/test/failures.test.js)、[edges.test.js](../packages/adk-session/test/edges.test.js) |
| G9 格式与容量 | 未知版本、坏 JSON、访问器、孤立工具批次、重复身份、坏 receipt、agentKey 不匹配在运行前拒绝；revision 耗尽拒绝；最后一轮跨阈值仍完整保存；所有 core 终态原样归档 | [stores.test.js](../packages/adk-session/test/stores.test.js)、[session.test.js](../packages/adk-session/test/session.test.js)、[edges.test.js](../packages/adk-session/test/edges.test.js) |
| G10 事件 | run.end 先于 session.saved；补写只通知保存；同状态 unsaved 不重复；重复 receipt 无事件；同步 / 异步观察异常隔离，回调重入拒绝 | [session.test.js](../packages/adk-session/test/session.test.js)、[failures.test.js](../packages/adk-session/test/failures.test.js) |
| G11 SQLite | 真实原生驱动、事务与 trigger 回滚、真实 busy 锁等待、schema 版本保护、坏行检测、临时数据库清理、两进程 CAS、两处崩溃恢复；关闭幂等且拒绝后续 I/O | [stores.test.js](../packages/adk-session/test/stores.test.js)、[processes.test.js](../packages/adk-session/test/processes.test.js) |

## 实施中明确的细节

SessionSnapshot.data 直接使用其各层均 readonly 的 SessionData；RunResult 用有限结构的 DeepReadonly。这样保持对外只读约束，同时避免当前 tsrs 对递归 JSON 再次展开 DeepReadonly 时的递归实例化问题。运行时仍严格深复制、深冻结；API 附件与源契约做过逐字一致性检查，公开类型用例通过。

SQLite 模块无法加载新增脱敏码 `SQLITE_DRIVER_UNAVAILABLE`，已同步 spec；不改变 SaveResult 的两个 pending 错误码。准入 CAS 被删除抢先时返回 SESSION_CONFLICT，已有旧句柄下一次读取删除记录时仍为 SESSION_NOT_FOUND。

这次实现没有改动 core / Provider 的源代码与公开 API。SQLite 同步 I/O 会占用当前线程；全归档快照不是无限会话存储。遗留 pending 与 blocked 不自动修复，分支、摘要、checkpoint、工具重放及人工修复接口均不在 S1。

本次 S1 验收本身使用离线模型。随后 core P0 已通过用户提供的本机服务完成独立真实端点工具闭环，见 [P0 验收记录](adk-p0-validation.md)；不将这一结果扩大为 Session 的真实模型场景全覆盖。
