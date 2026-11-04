# ADK P0 验收记录

日期：2026-11-04 · 基线：[P0 Spec](adk-p0-spec.md) / K3

实现、本地验收与本机真实端点工具闭环均已完成。当前为 **13 / 13 项任务完成，39 / 39 条验收检查完成**。

## 已交付

- 唯一入口 `@alpha/adk/core`，仅导出 createAgent、createTool 两个运行时工厂及相关类型。
- 内置串行 Loop、Provider 直接接入、单 schema 工具、完整历史与容量预留。
- 三个 hook、插件注册与生命周期、顺序事件、取消仲裁、blocked 恢复及幂等关闭。
- 默认离线示例、独立真实端点探针、类型测试、模块边界检查与故障测试。

## 本地命令结果

| 命令 | 结果 |
| --- | --- |
| pnpm install --frozen-lockfile | 通过；锁文件一致 |
| pnpm build | 通过；Provider、ADK、Session、example-agent 四个项目（最新复验） |
| pnpm typecheck | 通过；含基于构建产物的公开类型正反例 |
| pnpm lint | 通过；四个项目通过 |
| pnpm test | 通过；ADK 77 项、Provider 25 项、Session 47 项，合计 149，失败 / 跳过均为 0 |
| pnpm --filter @alpha/example-agent start | 通过；离线 Provider HTTP 夹具，执行 get_order 后返回 completed |
| node --env-file=.env.local packages/adk/integration/live.js | 通过；本机真实端点工具闭环，verified=true，退出码 0 |

测试使用仓库既有 Node.js 内置测试运行器。Windows 下通过显式枚举 .test.js 文件启动测试，避免依赖 shell 的通配符展开。

类型检查使用项目现有 tsrs；当前验证环境 Node.js 20.20.2、pnpm 9.15.1。以上结果不等同于对所有受支持 Node 版本的兼容矩阵验证。

## G1–G10 证据

| 验收组 | 证据文件 | 结果 |
| --- | --- | --- |
| G1 内置循环 | [core.test.js](../packages/adk/test/core.test.js) | 无插件、多轮、串行批次与不同 Agent 运行隔离通过 |
| G2 API / 类型 / 边界 | [types.ts](../packages/adk/test/types.ts)、[boundaries.test.js](../packages/adk/test/boundaries.test.js) | Provider 直接注入、schema 推导、错误上下文、内部入口不可访问与类型依赖规则通过 |
| G3 模型协议 | [history-model.test.js](../packages/adk/test/history-model.test.js) | 缺失 / 重复 finish、迟到事件、坏批次与输出限额通过 |
| G4 工具一致性 | [core.test.js](../packages/adk/test/core.test.js)、[controller.test.js](../packages/adk/test/controller.test.js) | 参数身份一致、授权、执行事实、当前 run 防重与跨响应 ID 通过 |
| G5 串行 / 互斥 | [controller.test.js](../packages/adk/test/controller.test.js)、[termination.test.js](../packages/adk/test/termination.test.js) | 双 prompt、内部重叠、detached 工作的防御与收束通过 |
| G6 取消 | [termination.test.js](../packages/adk/test/termination.test.js) | 模型 / 授权 / 执行 / 结果处理阶段取消与迟到结果通过 |
| G7 历史 / 资源 | [history-model.test.js](../packages/adk/test/history-model.test.js)、[termination.test.js](../packages/adk/test/termination.test.js) | UTF-8 精确容量、占位预留、原子替换、停止等待与监听释放通过 |
| G8 事件 | [plugins-events.test.js](../packages/adk/test/plugins-events.test.js) | seq、同步重入、监听列表快照、异常及异步拒绝隔离通过 |
| G9 插件生命周期 | [plugins-events.test.js](../packages/adk/test/plugins-events.test.js)、[termination.test.js](../packages/adk/test/termination.test.js) | 创建取消、启动失败、逆序清理、注册关闭、幂等 close 通过 |
| G10 Provider | [provider.test.js](../packages/adk/test/provider.test.js)、[live.js](../packages/adk/integration/live.js) | 三种协议本地夹具通过；本机 Chat Completions 真实端点工具闭环通过 |

协议夹具使用实际的 createProvider / provider.use / LanguageModel.stream，覆盖 Chat Completions、Responses、Anthropic Messages；验证工具往返、HTTP 取消、Anthropic continuation 与 Responses 完整历史模式。它们使用注入 fetch，不访问真实服务。

## 边界与产物

core 构建产物共有 17 个 JavaScript 文件，未压缩总计 48211 字节；类型声明共 17252 字节。此清单仅统计 core 目录，不包含 Provider、schema 库或示例；不是 bundle 大小或性能基准。

产物检查确认内核 JavaScript 仅相对引用自身模块；Provider 与 Standard Schema 通过类型声明依赖，Zod 只在测试及示例中使用。package exports 仅开放 ./core，standard、loops、内部路径和包根业务 API 均不可导入。

布局为 core 的公开工厂与契约，加 internal 中的 Loop、controller、网关、历史、事件和插件生命周期模块；没有新的通用 DI 或全局服务注册表。

同步事件回调中的 abort 会立即记录停止，停止通知在当前事件分发完成后依次送达；这是为保证所有订阅者看到同样的 seq 顺序，不是消费者缓冲队列。

## 真实端点工具闭环

2026-11-04 16:25:45（Asia/Shanghai），使用用户提供的本机服务完成真实 Provider → Agent → 工具 → 模型闭环。无 fetch 替身，模型通过工具取得随机值后返回；结果未依赖固定模型文本。

| 项目 | 实测值 |
| --- | --- |
| Base URL | http://127.0.0.1:3425/v1 |
| 模型 | codex/gpt-6.1-sol |
| 适配器 / 请求 | openai-completions / 流式 /chat/completions |
| 认证 | ADK_AUTH=none，端点允许无认证；未配置或输出密钥 |
| 模型调用 / 工具执行 | 2 / 1，工具为只读 get_test_code |
| 结果 / 耗时 | completed，verified=true，7933 ms |

从仓库根目录执行：

```sh
node --env-file=.env.local packages/adk/integration/live.js
```

非敏感模板在 [.env.example](../.env.example)，本机配置副本 `.env.local` 已忽略提交。需要认证的端点移除 `ADK_AUTH=none` 并使用 `ADK_API_KEY_ENV` 指向的凭证环境变量；`pnpm --filter @alpha/adk test:live` 也可直接使用外部注入的环境。

本次原始结果（`.nx/adk-local-live.log`）：

```json
{"status":"passed","verified":true,"endpoint":"http://127.0.0.1:3425","model":"codex/gpt-6.1-sol","date":"2026-11-04T08:25:45.083Z","modelCalls":2,"toolExecutions":1,"runStatus":"completed","elapsedMs":7933}
```

探针限制最多 3 次模型调用、2 次工具执行与 90 秒协作取消时限；默认自动化测试不访问该端点，不将真实联调放入 Nx 缓存。本次验证范围为这一个端点、模型与协议，不代表其他服务或协议已完成真实联调。配置补齐后重新执行 build、typecheck、lint、test 均通过；P0-12、P0-13 的剩余检查已勾选。
