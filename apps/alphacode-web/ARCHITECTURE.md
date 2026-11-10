# Web 会话模块职责

本次重构保留 UI 和 HTTP 协议，以会话模块为范围拆出可独立验证的行为。模块通过 `AppProviders` 装配，默认接入 `httpSessionGateway`；测试可注入 `SessionGateway`，不需要模拟全局 `fetch` 来验证应用逻辑。

## 当前结构

| 位置 | 职责 |
| --- | --- |
| `src/features/sessions/domain/request.ts` | 待确认请求实体、请求推进判断、快照顺序规则 |
| `src/features/sessions/domain/history.ts` | 消息可见性、连续工具分组、每轮最终回复、尾部进度状态 |
| `src/features/sessions/domain/search.ts` | 搜索结果实体、本地草稿匹配、最近会话投影 |
| `src/features/sessions/domain/errors.ts` | 查询重试与发送结果不确定性的分类 |
| `src/features/sessions/application/session-gateway.ts` | 查询、搜索、发送、取消、审批与订阅接口 |
| `src/features/sessions/application/session-commands.ts` | 与 React 无关的发送/控制生命周期，按会话隔离锁和状态 |
| `src/features/sessions/application/session-cache.ts` | Query key、快照缓存写入、结构共享策略 |
| `src/features/sessions/application/use-session-search.ts` | 输入法状态、防抖、取消过期查询、合并搜索结果 |
| `src/features/sessions/infrastructure/http-session-gateway.ts` | 将服务接口适配到现有 JSON API 和 SSE |
| `src/features/sessions/presentation/errors.ts` | 将命令状态转换为当前语言的提示 |
| `src/features/sessions/use-session-actions.ts` | 连接命令服务、Query 缓存和 React 订阅 |
| `src/features/sessions/queries.ts` | 查询与实时订阅生命周期、重连、轮询兜底 |
| `src/features/sessions/session-*.tsx` | 交互与展示，消费模型和 Hook |

领域规则不依赖 React、TanStack Query 或浏览器导航；网络实现通过接口注入。`SessionCommands` 的缓存接口也不依赖 QueryClient，因此可直接测试竞态和失败路径。

## 必须保持的行为

- 请求按会话加锁；不确定的发送重试必须沿用原始请求 ID 和正文。
- 接收回执后才通知草稿清理；草稿是否仍是原文由工作区判断。
- admission 回执不代表执行结束；后续快照更新请求状态。
- 请求响应和控制操作始终关联发起时的会话、请求与审批 ID。
- 同一服务实例的旧快照不能覆盖较新的 sequence；服务实例变化允许序号重新开始。
- GET、SSE、命令刷新共用快照顺序规则，未挂载查询的会话也受保护。
- 搜索结果保持服务端顺序；输入法组合输入和防抖等待期间不展示过期结果。
- 历史组件的 Markdown 仍由原来的懒加载边界加载。

## 本次保留的边界

会话标题任务正在同时修改 `api.ts`、`types.ts`、`use-session-workspace.ts` 和标题相关视图，因此本次不修改这些文件，也不复制它们的数据定义。协议类型与 `SessionApiError` 暂由现有 `api.ts` 提供，会话与文件夹实体暂由 `types.ts` 提供；新模块按需引用。

URL 选择、本地草稿、创建会话及草稿转移仍由 `use-session-workspace.ts` 管理。创建接口仍直接使用现有 API，不在本次可注入的 `SessionGateway` 范围内。待并行任务完成后，可继续迁移这些实体、错误类型和创建流程，避免本次改动覆盖标题逻辑。

## 验证

在仓库根目录执行：

```powershell
bun run --cwd apps/alphacode-web typecheck
bun run --cwd apps/alphacode-web lint
bun run --cwd apps/alphacode-web test --maxWorkers=1
bun run --cwd apps/alphacode-web build
bun run --cwd apps/alphacode-web i18n-check
```

现有页面测试覆盖输入、会话切换、搜索、工具历史、语言切换与实时流。新增命令和缓存测试集中验证重复提交、重试身份、晚到回执、服务重启、失效审批与刷新失败。
