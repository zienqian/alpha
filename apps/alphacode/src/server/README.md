# Local server API v1

`index.tsx → connectApplication → ensureServer → remoteChat` 是正常 CLI 启动链路；`createApplication` 保留为进程内 runtime/controller 工厂，由 server 使用，现有离线测试也继续使用它。通信实现保留在应用内部，不再提供独立客户端包。Web 通过同源 GET 读取历史，通过 SSE 与 CLI 同步当前会话，支持在已登记项目中新建、发送、取消及审批。浏览器不导入 CLI、Bun、SQLite 或 Agent。

## 生命周期

同一真实数据库路径对应一个 server。启动子进程前检查私有 descriptor，子进程用独立 SQLite 表的 `BEGIN IMMEDIATE` 原子获取租约，租约记录 PID/instanceId。只有确认旧 PID 不存在才接管；不根据超时猜测或杀掉存活的 owner。多个 CLI 并发启动可以产生短暂的竞选子进程，但只有一个持有租约、提供 API。Windows 子进程隐藏窗口并脱离终端。

server 唯一持有每个已打开 session 的 Chat/runtime。恢复会话使用 single-flight；多个客户端不会各自创建 Agent。每个 runtime 保留原有 SessionManager/SQLite 连接和保存协议，registry 的单独连接只负责历史索引。API 操作、SSE 连接、进行中的请求、待审批、未保存/blocked 状态都会阻止空闲退出。普通 detach 不调用 runtime.cancel/close。

新建会话先分配稳定 ID，作为 server 内存草稿提供 GET/SSE 和 `/web` 访问；不写入会话数据库，也不进入 `GET /api/sessions` 历史列表。首条有效模型请求准备完成后才创建持久化 Session 和 Agent，并在模型调用前保存 admission。草稿权限随首条消息一起保存；仅启动、查看 `/skills`、无效输入或关闭草稿不会生成历史记录。server 退出会丢弃尚未发送消息的草稿，之后访问该 ID 返回 `SESSION_NOT_FOUND`。

## 本地访问边界

Web 按单机使用、信任本机进程的前提设计，不使用浏览器登录、授权码、认证 cookie 或独立 CSRF token。所有请求验证 Host，存在的 Origin 必须与 server 同源，禁止 cross-site fetch。没有原生 bearer token 的写请求必须携带同源 Origin；POST 请求体只接受 JSON，上限 256 KiB。服务无 CORS 放行，仅监听 `127.0.0.1` 随机端口；这些来源校验不替代用户身份认证，不能隔离同机的其他用户或进程，不适用于局域网或公网开放。

`POST /api/connect` 和 `POST /api/web` 仍只允许携带 `Authorization: Bearer <server.json token>` 的原生客户端。`/api/web` 懒加载静态资源后返回 `/?session=<sessionId>`，浏览器直接访问 API/SSE；链接不是凭证，可在 server 存活时刷新、收藏或重复打开。server 重启后端口可能变化，重新 `/web` 获取新地址即可，不需要重新授权。浏览器请求不携带 cookie 或原生 token；原生 RPC/SSE 强制直连，不使用 HTTP_PROXY/HTTPS_PROXY/ALL_PROXY；所有客户端拒绝 API 重定向，避免本地认证或配置被转发。工具审批与执行权限保持独立，不因免登录而跳过。

当前协议版本为 2，已移除 `/api/browser` 和 `/api/browser/exchange`。升级时重新构建 Web，并关闭旧 CLI/Web 客户端，待任务完成、旧 server 空闲退出后再启动；不会接管或终止仍持有会话的旧 server。

## 接口

| Method | Path | 请求 / 响应 |
| --- | --- | --- |
| GET | `/api/info` | `protocolVersion, instanceId, databasePath` |
| POST | `/api/connect` | 原生专用：`{config, credential?}`；登记项目并新建/恢复 config.sessionId，返回 SessionView |
| GET | `/api/sessions` | `{sessions: SessionInfo[]}`，覆盖所有已登记项目 |
| GET | `/api/sessions/search?q=...` | `{results: SessionSearchResult[]}`；跨项目搜索标题、路径、消息正文和工具记录，忽略大小写、按字面匹配；关键词最多 500 字符，空值返回空结果。读取历史不启动 runtime；每个会话返回匹配消息总数及最多三条上下文片段 |
| POST | `/api/sessions` | `{projectId}`；在已登记项目中新建内存草稿，返回 SessionView；首条有效消息才落盘 |
| GET | `/api/events` | 全局 SSE：`{instanceId, sequence}`；提示重新读取列表 |
| GET | `/api/sessions/:id` | SessionView 全量快照 |
| GET | `/api/sessions/:id/events` | SSE SessionView，全量替换客户端投影 |
| POST | `/api/sessions/:id/requests` | `{requestId, input}`；202 `{requestId, status:"accepted"}`，不代表执行成功或已保存 |
| POST | `/api/sessions/:id/cancel` | `{requestId}`；仅取消当前指定请求 |
| POST | `/api/sessions/:id/approval` | `{requestId, approvalId, allow}`；一次性决策，过时/重复决策 409 |
| POST | `/api/sessions/:id/permission` | `{mode:"ask"\|"auto"\|"full"}`；运行中禁止修改 |
| POST | `/api/web` | 原生专用：`{sessionId}` → `{url:"http://127.0.0.1:<port>/?session=<sessionId>"}`，懒加载静态资源 |

失败响应为 `{code}`，不暴露上游原始错误或凭证。协议类型位于 `protocol.ts`，HTTP/SSE 通信实现位于 `transport.ts`，原生直连封装位于 `http.ts`；聊天契约位于 `../chat/contracts.ts`。

## 同步与去重

新会话首个模型调用在 admission 保存后并行触发一次独立的标题请求：同一 provider/model、无工具、最多 80 输出 token、8 秒超时。创建档案时先保存首条原始消息的短摘要作为兜底；标题请求不进入对话历史、不阻塞回复，失败不影响会话状态。生成结果立即经 `state.sessionTitle`、可选的 `state.titleStatus` / `session.titleStatus`（`pending` 或 `ready`）同步给 CLI 和 Web，在正文和设置写入结束后通过 revision CAS 保存，避免与 Session 的 pending/commit 冲突。关闭时中止标题请求、保留兜底；历史恢复不重新生成标题。

SSE `id` 为 `instanceId:sequence`。连接后直接给出全量快照，慢客户端仅保留一个待发送快照，15 秒心跳也携带快照。客户端重连重新订阅即可；这是快照恢复，不是持久化事件日志，也不宣称支持 Last-Event-ID 历史重放。wire 中 activeRunStartedAt、tool.startedAt/finishedAt 为 epoch 毫秒；TUI adapter 转回本进程 monotonic 时间。

requestId 由客户端创建，同会话重复 ID、相同原始输入不会再次调用模型；修改输入返回 409。server 在调用 runtime 前持久化原始输入 hash 的 admission 回执，并把相同 requestId 传入 Session 层。回执不保存请求正文。已收到的 admission 不随网络断线撤回；客户端不得把响应超时当作“未执行”。正在落盘的并发 admission 可返回 SESSION_BUSY，使用原 ID 重试而不是生成新 ID。

完成后回执变为 settled；这表示处理已结束，成功/失败、是否可继续以 SessionView.state 为准。重启后仍是 accepted 的回执返回 interrupted，不自动重跑。执行中崩溃仍可能留下外部工具副作用，不能承诺工具 exactly-once；Session 的 pending/blocked 恢复规则保持不变。请求回执目前不自动清理，避免过期后重复执行。

## 验证

在应用目录执行 `bun test test/server.test.ts test/server-lifecycle.test.ts`。测试使用真实 loopback HTTP、SQLite、独立 server 进程和受控模型流，不访问付费模型。覆盖双端流式快照、重连、恢复历史、请求去重、审批竞争、跨项目索引、免登录访问、可复用会话链接、Host/Origin/JSON 校验、跨站拒绝、原生专用接口鉴权、空闲退出、并发启动和陈旧 PID 恢复。Web 的 DOM 测试在 `apps/alphacode-web/test`。
