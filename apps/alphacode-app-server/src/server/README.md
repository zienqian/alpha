# Local server API v2

`index.tsx → connectApplication → ensureServer → remoteChat` 是正常 CLI 启动链路；`createApplication` 保留为进程内 runtime/controller 工厂，由 server 使用，现有离线测试也继续使用它。服务与通信实现位于业务应用 `apps/alphacode-app-server`，CLI 通过其 `/client` 入口接入，也可用 `bun run dev:server` 单独启动。Web 通过同源 GET 读取历史，通过 SSE 与 CLI 同步当前会话，支持在已登记项目中新建、发送、取消及审批。浏览器不导入 CLI、Bun、SQLite 或 Agent。

## 生命周期

同一真实数据库路径对应一个 server。启动子进程前检查私有 descriptor，子进程用独立 SQLite 表的 `BEGIN IMMEDIATE` 原子获取租约，租约记录 PID/instanceId。只有确认旧 PID 不存在才接管；不根据超时猜测或杀掉存活的 owner。多个 CLI 并发启动可以产生短暂的竞选子进程，但只有一个持有租约、提供 API。Windows 子进程隐藏窗口并脱离终端。

租约由 supervisor 持有，HTTP/runtime 在独立 worker 中运行。每 3 秒比较应用源码（构建模式比较 dist）、基础包源码、依赖清单和 Web 构建入口的内容指纹；连续两次稳定后准备替换。正在执行、审批、保存、生成标题、未保存或 blocked 时延后切换。SSE 连接本身不阻止更新。切换前同步冻结新请求，再经内存 IPC 转交凭据、草稿 ID、权限和当前消息；不把交接数据写入文件。旧 worker 关闭后，新 worker 绑定原端口并沿用 token，descriptor 发布后开放请求。原客户端按既有 SSE 重连逻辑恢复；新 worker 无法导入或恢复时回退旧 worker。

Web 使用该版本的静态入口快照，避免新页面请求旧 API；内容哈希资源保留在私有 `web/assets` 缓存中，支持旧页面延迟加载。缓存目前不自动清理；服务完全退出后可删除 `web/`。页面轮询 `/api/info` 显示等待更新、失败重试或刷新提示，点击刷新时暂存本标签页的文字草稿，恢复后立即移除；附件或无法保存草稿时不刷新，发送结果不明时也禁止该刷新操作。后台更新不会自动刷新页面。普通业务代码/页面更新无需关闭客户端；协议、supervisor 自身或运行环境升级仍需完整重启。

server 唯一持有每个已打开 session 的 Chat/runtime。恢复会话使用 single-flight；多个客户端不会各自创建 Agent。每个 runtime 保留原有 SessionManager/SQLite 连接和保存协议，registry 的单独连接只负责历史索引。API 操作、SSE 连接、进行中的请求、待审批、未保存/blocked 状态都会阻止空闲退出。普通 detach 不调用 runtime.cancel/close。

新建会话先分配稳定 ID，作为 server 内存草稿提供 GET/SSE 和 `/web` 访问；不写入会话数据库，也不进入 `GET /api/sessions` 历史列表。首条有效模型请求准备完成后才创建持久化 Session 和 Agent，并在模型调用前保存 admission。草稿权限随首条消息一起保存；仅启动、查看 `/skills`、无效输入或关闭草稿不会生成历史记录。自动更新保留内存草稿；整个 server 退出或崩溃后未发送消息的草稿会丢失，之后访问该 ID 返回 `SESSION_NOT_FOUND`。

## 本地访问边界

Web 按单机使用、信任本机进程的前提设计，不使用浏览器登录、授权码、认证 cookie 或独立 CSRF token。所有请求验证 Host，存在的 Origin 必须与 server 同源，禁止 cross-site fetch。没有原生 bearer token 的写请求必须携带同源 Origin；JSON 请求体上限 256 KiB，Skills 安装接口额外接受最多 10 MiB 的 ZIP 二进制请求体。服务无 CORS 放行，仅监听 `127.0.0.1` 随机端口；这些来源校验不替代用户身份认证，不能隔离同机的其他用户或进程，不适用于局域网或公网开放。

`POST /api/connect` 和 `POST /api/web` 仍只允许携带 `Authorization: Bearer <server.json token>` 的原生客户端。`/api/web` 懒加载静态资源后返回 `/?session=<sessionId>`，浏览器直接访问 API/SSE；链接不是凭证，可在 server 存活时刷新、收藏或重复打开。server 重启后端口可能变化，重新 `/web` 获取新地址即可，不需要重新授权。浏览器请求不携带 cookie 或原生 token；原生 RPC/SSE 强制直连，不使用 HTTP_PROXY/HTTPS_PROXY/ALL_PROXY；所有客户端拒绝 API 重定向，避免本地认证或配置被转发。工具审批与执行权限保持独立，不因免登录而跳过。

当前协议版本为 2，已移除 `/api/browser` 和 `/api/browser/exchange`。协议兼容的旧后台即使不支持自动更新，也允许 CLI 正常连接，不阻断启动、不要求关闭其他客户端。自动更新机制在后台下一次正常退出并重新启动后生效；旧后台缺少的新接口由对应功能页面提示。不会强行接管仍持有会话的旧 server。

外部 Skills 下载与本地 RPC 分开：遵循服务端的 `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY`，每次请求和重定向都校验目标为公开 HTTPS 地址，并将直连或代理 CONNECT 固定到已校验的 IP，同时保留原主机的 TLS 证书校验。代理凭据不发送给目标站点。

## 接口

| Method | Path | 请求 / 响应 |
| --- | --- | --- |
| GET | `/api/info` | `protocolVersion, instanceId, databasePath, managed, revision, updateStatus`；更新状态为 current / pending / failed |
| POST | `/api/server/update` | 重试失败的更新检查；沿用同源写请求校验，不强制中断任务 |
| GET | `/api/skills?projectId=...` | 项目列表、当前 projectId、目录、Skill 元数据/状态和诊断。未指定项目时取第一个已登记项目；无需已有持久化会话 |
| POST | `/api/skills/install?projectId=...&directoryId=...` | `application/zip` 二进制或 JSON `{url}`；默认目录 `user-local`，返回 201 `{installed, directory, requiresNewSession: true}` |
| POST | `/api/connect` | 原生专用：`{config, credential?}`；登记项目并新建/恢复 config.sessionId，返回 SessionView |
| GET | `/api/sessions` | `{sessions: SessionInfo[]}`，覆盖所有已登记项目 |
| GET | `/api/sessions/search?q=...` | `{results: SessionSearchResult[]}`；跨项目搜索标题、路径、消息正文和工具记录，忽略大小写、按字面匹配；关键词最多 500 字符，空值返回空结果。读取历史不启动 runtime；每个会话返回匹配消息总数及最多三条上下文片段 |
| POST | `/api/sessions` | `{projectId}`；在已登记项目中新建内存草稿，返回 SessionView；首条有效消息才落盘 |
| GET | `/api/events` | 全局 SSE：`{instanceId, sequence}`；提示重新读取列表 |
| GET | `/api/sessions/:id` | SessionView 全量快照 |
| GET | `/api/sessions/:id/events` | SSE SessionView，全量替换客户端投影 |
| POST | `/api/sessions/:id/requests` | `{requestId, input}`；202 `{requestId, status:"accepted"}`，不代表执行成功或已保存 |
| POST | `/api/sessions/:id/queue` | `{requestId, action:"edit", input, expectedInput}` / `{requestId, action:"move", beforeRequestId:string\|null}` / `{requestId, action:"steer"}`；返回 SessionView |
| POST | `/api/sessions/:id/cancel` | `{requestId, queuedOnly?}`；取消指定的当前请求或排队消息；`queuedOnly:true` 只移除尚未开始的消息，已开始返回 409 |
| POST | `/api/sessions/:id/approval` | `{requestId, approvalId, allow}`；一次性决策，过时/重复决策 409 |
| POST | `/api/sessions/:id/permission` | `{mode:"ask"\|"auto"\|"full"}`；运行中禁止修改 |
| POST | `/api/web` | 原生专用：`{sessionId}` → `{url:"http://127.0.0.1:<port>/?session=<sessionId>"}`，懒加载静态资源 |

失败响应为 `{code}`，不暴露上游原始错误或凭证。协议类型位于 `protocol.ts`，HTTP/SSE 通信实现位于 `transport.ts`，原生直连封装位于 `http.ts`；聊天契约位于 `../chat/contracts.ts`。

## 同步与去重

新会话首个模型调用在 admission 保存后并行触发一次独立的标题请求：同一 provider/model、无工具、最多 80 输出 token、8 秒超时。创建档案时标题留空，由 CLI 和 Web 按各自语言统一兜底显示“新对话”；标题请求不进入对话历史、不阻塞回复，失败不影响会话状态。生成结果立即经 `state.sessionTitle`、可选的 `state.titleStatus` / `session.titleStatus`（`pending` 或 `ready`）同步给 CLI 和 Web，在正文和设置写入结束后通过 revision CAS 保存，避免与 Session 的 pending/commit 冲突。关闭时中止标题请求，未生成的标题保持为空并由客户端兜底显示；历史恢复不重新生成标题。

SSE `id` 为 `instanceId:sequence`。连接后直接给出全量快照，慢客户端仅保留一个待发送快照，15 秒心跳也携带快照。客户端重连重新订阅即可；这是快照恢复，不是持久化事件日志，也不宣称支持 Last-Event-ID 历史重放。wire 中 activeRunStartedAt、tool.startedAt/finishedAt 为 epoch 毫秒；TUI adapter 转回本进程 monotonic 时间。

requestId 由客户端创建，同会话重复 ID、相同原始输入不会再次调用模型或重复入队；修改输入返回 409。server 在调用 runtime 前持久化原始输入 hash 的 admission 回执，并把相同 requestId 传入 Session 层。回执不保存请求正文。已收到的 admission 不随网络断线撤回；客户端不得把响应超时当作“未执行”。同会话并发 admission 按接收顺序串行落盘，执行中的新消息进入服务端内存队列；不同会话独立执行。

快照中的 `state.queuedRequests` 包含尚未执行的 `{requestId,input}`，`state.canQueue` 表示当前能否接收新消息；`requestId` 始终指向当前执行的请求。前一轮运行和保存完成后自动依次发送，执行前不插入消息历史。网页刷新、切换会话和客户端断开不会丢弃队列。停止只取消当前请求，后续队列继续；可逐条移除排队消息。设置保存、正在停止、关闭或会话不可继续时禁止入队；运行结束后若保存失败或执行状态不明，队列保留但不执行，仍可移除。后台自动更新和空闲退出等待队列清空；完整关闭或重启会中断尚未执行的消息，对应回执返回 interrupted，不自动重放。

完成后回执变为 settled；这表示处理已结束，成功/失败、是否可继续以 SessionView.state 为准。重启后仍是 accepted 的回执返回 interrupted，不自动重跑。执行中崩溃仍可能留下外部工具副作用，不能承诺工具 exactly-once；Session 的 pending/blocked 恢复规则保持不变。请求回执目前不自动清理，避免过期后重复执行。

排队编辑只修改未执行的正文，保留原 admission hash 供原请求重试去重；`expectedInput` 不匹配时返回 `QUEUE_CONFLICT`。移动到 `beforeRequestId` 前，null 表示末尾。已执行的消息不能编辑或重排。`state.canSteer` 表示当前运行能接收引导；点击引导后该条消息标记 `steering:true`，ADK 中断当前模型流或工具准备/审批，保留已显示文字和已完成结果，再追加引导并续跑。正在执行的工具先完成，同批未开始的调用写入 not_executed 后跳过。其内容属于当前运行，不创建新 run，也不自动重跑工具；消息从队列移除，回执在当前运行保存结束后 settled。若本轮停止前未消费引导，消息留在原队列位置。尚在等待引导的消息不能编辑、移动或删除。

## 验证

在服务应用目录执行 `bun test test/server.test.ts test/server-lifecycle.test.ts test/server-update.test.ts`。测试使用真实 loopback HTTP、SQLite、独立 server 进程和受控模型流，不访问付费模型。覆盖双端流式快照、重连、恢复历史、请求去重、审批竞争、跨项目索引、免登录访问、可复用会话链接、Host/Origin/JSON 校验、跨站拒绝、原生专用接口鉴权、空闲退出、并发启动和陈旧 PID 恢复，以及自动更新等待生成、固定地址、草稿/凭据交接、新代码失败回退和旧服务识别。Web 的 DOM 测试在 `apps/alphacode-web/test`。
