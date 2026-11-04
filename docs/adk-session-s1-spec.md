# 历史版本提示

S1 公开调用方式已由 [S2 Spec](adk-session-s2-spec.md) 替代。S2 使用 agent.prompt + Session 插件；本文件保留 S1 设计背景，formatVersion=1 归档继续兼容。

# ADK Session S1 实现规范

状态：S1 已实现并通过本地验收。日期：2026-11-04。

S1 新增可选包 `@alpha/adk-session`，为现有 Agent 提供会话管理、轮次归档和重启后的对话恢复。Session 组合 core 已有的公开 API，负责执行前的原子准入和执行后的保存确认；Loop、工具执行、停止仲裁与进程内历史仍由 core 负责。

[实现 TODO](adk-session-s1-todo.md) · [完整 API 声明](adk-session-api-s1.d.ts) · [使用示例](adk-session-example-s1.ts) · [交互设计](adk-session-design-s1.html) · [core P0 Spec](adk-p0-spec.md)

本文是 S1 实施与验收基线。交互稿说明架构动机；API 附件定义类型。解释差异以本文的行为规定为准，调整时须同步附件和示例。当前实现与测试证据见 [S1 验收记录](adk-session-s1-validation.md)。

<a id="s01"></a>
## S01 范围与必须保持的边界

S1 必须支持创建、打开、读取、分页列出、更新元数据和删除会话；在多轮调用之间保存完整归档，选择完整轮次恢复工作上下文；实现请求去重、原子准入、保存确认、补写、关闭及故障隔离。交付 Memory 与 SQLite 两种存储适配器。

统一使用 Session 表示持久会话。Thread 是同义词，不引入 Thread 对象、ThreadManager 或第二套标识。

以下不在 S1：分支树、自动摘要、向量记忆、任意历史编辑、审批暂停恢复、工具级 checkpoint、运行中断点续执行、锁超时接管、自动重跑、多 Agent 编排、跨模型迁移、JSONL 存储和公共人工修复 API。

必须保持以下不变量：

1. core 不依赖 Session，不新增 Session 专属字段、hook、可写历史出口或可替换 Loop。
2. Session 只能通过 `prompt`、`state`、`replaceMessages`、`subscribe`、`abort`、`close` 等 core 公开 API 组合运行。
3. 每个 Session 句柄独占自己创建的 Agent；不向业务公开裸 Agent。多个句柄可以指向同一持久会话，由存储准入仲裁。
4. 必须先确认 pending 已保存，再调用 core.prompt。最终提交 CAS 不能替代执行前的互斥。
5. 已返回的 RunResult 和正式消息作为执行事实保存；存储失败不能改写为另一种 core 终态。
6. core 事件是观察通知，不承担存储确认。`run.end` 与 `session.saved` 的语义不同。
7. 发现外部 pending 或未知工具结果时，不自动清除标记、不重放工具、不推测执行从未发生。
8. 上下文裁剪不删除归档，也不能绕过归档中的 blocked 状态。
9. 所有存储操作以 `(namespace, sessionId)` 为键；core 的 agentId 和 runId 不承担会话身份。
10. 同一 `(namespace, sessionId)` 删除后不能重新创建，防止旧句柄和旧 revision 命中新记录。

<a id="s02"></a>
## S02 包、导出与依赖

新增 `packages/adk-session`，名称为 `@alpha/adk-session`，沿用仓库 TypeScript、ESM、pnpm、Nx 与 Node 测试工具链。

| 入口 | 运行时导出 | 依赖规则 |
| --- | --- | --- |
| `@alpha/adk-session` | `createSessionManager`、`createMemorySessionStore` | 只引用 core 公开类型；根入口不得加载 SQLite 驱动 |
| `@alpha/adk-session/sqlite` | `createSqliteSessionStore` | 可以加载选定的 Node SQLite 驱动，实现相同 Store 契约 |
| 内部模块 | 无公共导出 | 禁止通过 package exports 绕过业务入口 |

公共类型以 [API 附件](adk-session-api-s1.d.ts) 为准。Session 复用 core 的 Agent、Message、RunResult、AgentEvent 和 JSON 类型，不重新定义模型协议、工具 schema 或执行循环。

工程约束：新增 `layer:session`，允许 Session 指向 core，允许 app 使用 Session；禁止 core 或 Provider 反向依赖 Session。运行时依赖和根入口驱动加载须另做产物检查，不能只依赖 Nx 标签。SQLite 驱动作为可选 peer 并在开发环境显式安装；根入口的使用者无需安装驱动。

SQLite 驱动具体版本在 S1-01 工程预检中锁定：必须兼容仓库声明的 Node 范围、Windows 环境及同步原子事务需求，记录版本和安装证据。若不兼容，应选择兼容实现，不默认抬高 workspace 的 Node 要求。该项完成后才能进入适配器编码。

<a id="s03"></a>
## S03 API 与配置

工厂使用 `createX`；静态实现使用对象加 `satisfies`；行为方法使用语义动词。`createSessionManager` 和 `createMemorySessionStore` 同步；涉及持久会话或 SQLite 打开的操作异步。

| API | 必须提供的行为 |
| --- | --- |
| `createSessionManager(options)` | 复制并校验配置，不执行存储 I/O，也不创建 Agent；绑定 namespace、agentKey、Store 与 Agent 工厂 |
| `manager.createSession(input?)` | 创建唯一持久记录，初始 revision=0，返回新句柄；可指定 ID，否则生成随机 UUID |
| `manager.openSession(id)` | 读取并校验记录和 agentKey，返回新句柄；不调用模型，不恢复未完成执行 |
| `manager.getSession(id)` | 返回只读快照或 undefined；允许检查 pending、blocked 及 agentKey 不匹配的记录 |
| `manager.listSessions(options?)` | 返回当前 namespace 的摘要页，包含 ready / pending / blocked 状态 |
| `manager.updateSession(id, patch, { expectedRevision })` | 只改 title / metadata；metadata 是整对象替换；不存在 pending 时通过 CAS 提交 |
| `manager.deleteSession(id, { expectedRevision })` | 不存在 pending 时 CAS 写入墓碑；不删除外部工具造成的结果 |
| `session.prompt(input, { requestId, signal? })` | 受理前占用本句柄；按 S06 执行，返回 SessionResult |
| `session.flush()` | 只补写本句柄捕获的终态数据，不执行模型或工具；与 prompt 互斥 |
| `session.subscribe(listener)` | 返回取消订阅函数；通知事实，不提供持久化完成承诺之外的事务扩展 |
| `session.abort(reason?)` | 取消本句柄准备 / 执行阶段；保存阶段仍需收束，不撤销已确认工具事实 |
| `session.close()` | 幂等、同一 Promise；停止受理，收束工作，必要时补写一次，释放 Agent |
| `manager.close()` | 幂等、同一 Promise；关闭自己持有的句柄并等待正在进行的管理操作，不关闭借用的 Store |

manager 的 `store` 由应用创建并最终关闭。Agent 工厂必须返回新的、idle、空历史的 core Agent，工厂成功返回后所有权移交给 Session；同一个 Agent 对象不得被两个句柄接收。Session 可延迟至首次非重复 prompt 时创建 Agent，此后在该句柄内复用。工厂内部未能成功返回的资源由工厂自身清理。

所有权移交以实例契约校验成功为前提。检测到工厂返回其他句柄已占用的 Agent 时，只拒绝本次接收，不关闭原持有者的 Agent；无效对象的资源责任仍在工厂。

配置与输入校验在对应写入或模型调用前完成：

- namespace、sessionId、requestId、agentKey 必须为非空字符串，UTF-8 编码不超过 512 字节，不含控制字符；不隐式 trim、改大小写或 Unicode 归一化。
- input 必须为非空白字符串，保留原文本；signal 若提供须为 AbortSignal。首次检查时已 aborted 的请求以 SESSION_ABORTED 拒绝，不写 pending、不创建 core run。
- title 默认为空字符串，最多 4096 UTF-8 字节。metadata 默认为空对象，最多 64 KiB UTF-8 JSON；只接受可深复制的普通 JSON 对象，不接受函数、循环引用、访问器、非有限数值等。
- `limits.maxTurns` 默认 1000，`limits.maxArchiveBytes` 默认 64 MiB；均须为正安全整数。它们约束新运行的准入，详见 S10。
- 可选 `onObserverError` 只接收脱敏错误，不参与执行或存储事务。未知配置字段、错误类型和非函数回调拒绝。
- 稳定 namespace 由宿主根据可信身份构造；它提供地址隔离，鉴权仍由宿主负责。

<a id="s04"></a>
## S04 持久数据与恢复

Store 保存 `SessionSnapshot { revision, data }`。data 使用 formatVersion=1，包含 id、agentKey、title、metadata、createdAt、updatedAt、turns 和 pending。revision 为非负安全整数，所有成功写入推进一个版本。

SessionTurn 包含 requestId、inputHash、core RunResult、本轮新增 Message[]、historyStatus、committedAt 与 committedRevision。committedAt 是生成最终提交内容的 UTC 时间；重试使用同一值，不宣称等于数据库实际提交时刻。committedRevision 是该轮最终保存的版本，供重复请求返回同一 receipt。

PendingRequest 包含 requestId、inputHash、唯一随机 token、startedAt；不把受理标记伪造成正式 user 消息。正常情况下先写 pending，再保存完整 Turn 并清除 pending。每个会话最多一个 pending；已经提交的 requestId 不得再次成为 pending。

历史健康状态由归档推导：存在任何 historyStatus=blocked 的轮次时为 blocked；否则 pending 非空时为 pending；否则 ready。S1 不应产生 blocked 与 pending 同时存在的合法数据。空消息轮次合法，例如准入后取消，core 返回 cancelled 且没有提交 user。

读取须验证 JSON 形状、formatVersion、标识唯一性、版本关系和消息结构。未知版本、损坏数据、孤立 / 重复工具结果、不完整批次返回 SESSION_FORMAT_INVALID，不作为空会话处理。归档可以保存已确认的 outcome_unknown，但不得把它恢复为可执行上下文。Session 的数据校验不得导入 core 私有实现。

恢复流程：

1. 每次非重复 prompt 都重新读取持久记录，不依赖句柄的旧快照。
2. 检查 agentKey、pending 与全归档 blocked 状态。
3. 调用 selectContext，默认选全部轮次。返回值必须是归档中现有且不重复的 runId，顺序须与归档一致。
4. 将选中轮次中的完整消息按顺序展平，交给 idle Agent 的 replaceMessages 校验。历史容量或投影问题在准入前返回 SESSION_CONTEXT_INVALID。
5. 保存导入工作集作为基线。core 返回后校验历史前缀与基线结构完全相同，只将后缀作为本轮消息归档。消息字段、ID、工具配对和 continuation 不重写。

selectContext 只能选择完整轮次，不能编辑消息；异常或非法返回值为 SESSION_CONTEXT_INVALID。它和 Agent 工厂接收当前请求的协作取消信号。signal 不合作时等待它们实际结束，不丢弃后台操作。

agentKey 由应用维护，覆盖模型 / 协议、指令、工具与其他影响历史兼容性的配置。Session 只比较值，不推断同一个 agentKey 内的配置是否被偷偷改变。不匹配时 prompt / openSession 返回 AGENT_MISMATCH；读取接口仍允许检查记录。

<a id="s05"></a>
## S05 状态与本地并发

| Session.status | 语义 | 可进行的关键操作 |
| --- | --- | --- |
| idle | 没有本句柄受理的工作；历史状态另行判断 | prompt、只读操作、flush 检查、close |
| running | 已占用本句柄，包含读取、工厂、投影、准入与 core 运行 | abort、subscribe、close 请求 |
| saving | core 已收束，正在确认最终提交 | subscribe、close 请求；abort 不跳过保存 |
| unsaved | 本句柄持有尚未确认的完整最终提交 | flush、读取、subscribe、close；prompt 拒绝 |
| closed | 本句柄已释放 | 读取缓存 state、取消订阅、重复 close |

state 是只读的最近一次观测快照，不是实时数据库订阅。state.revision 是最近观测的当前记录版本；SessionResult.persistence.revision 是该请求提交的 receipt 版本，两者可能不同。

prompt 必须在首个 await 前占用句柄。重复的并发 prompt 或与 flush 重叠的调用立即 reject SESSION_BUSY，不排队。close 使用独立 closing 标记，立即拒绝新工作，再等待已受理操作；不增加另一套任务调度器。

同步事件分发期间禁止 prompt、flush、close 及 manager 的状态变更操作重入，错误为 SESSION_REENTRANT；abort 是例外。事件分发结束后的异步调用仍需通过正常状态检查。

多个句柄、manager 或进程打开同一会话，不因此获得执行权；只有 S06 的存储准入可以授权一次 core.prompt。SessionStore 不得通过过期时间自动清除 pending。

<a id="s06"></a>
## S06 prompt 与提交协议

一次调用在逻辑上依次经过以下阶段；存储故障不能通过自动重跑 core 解决。

### A 入口与重复请求

占用句柄并校验输入，读取最新快照。inputHash 固定为 SHA-256 的小写十六进制，原文为 UTF-8 编码的 `JSON.stringify([1, agentKey, input])`；不包含 signal、时间或请求 ID。

先查找已有 SessionTurn：同 requestId 且 inputHash 相同，返回原 RunResult 和原 committedRevision，不创建 Agent、不调用选择器、不发执行或 session.saved 事件；inputHash 不同则 REQUEST_MISMATCH。agentKey 的匹配检查仍然必须通过。已提交的只读 receipt 查询可在当前记录 blocked 或另有 pending 时返回。

若请求尚未提交，当前记录有 pending 则 RECOVERY_REQUIRED；这表示已受理但本句柄无法确认其终态，不等价于认定另一个进程已经死亡。归档 blocked 则 HISTORY_BLOCKED。不能在这些状态下通过新 requestId 绕过限制。

### B 准备与准入

检查轮数容量、创建或取得本句柄 Agent、选择并恢复上下文，再检查取消。创建新的 token，生成固定的 admissionCandidate：保持原归档不变、写入 pending、更新 updatedAt。对该候选检查归档字节阈值，通过后才允许 CAS。

读取的旧版本为 r。要求 r ≤ Number.MAX_SAFE_INTEGER − 2，为准入和最终提交各预留一次版本推进。调用 `compareAndSet(key, r, admissionCandidate)`：

- applied=true 且 revision=r+1：获得准入确认，保存完整 admissionSnapshot 与 token。
- applied=false：只读刷新一次；若相同请求已经提交则返回原 receipt，否则返回 SESSION_CONFLICT。不得自动追赶新 revision 并继续执行。
- 抛错：只读核对一次。若确认存储中的 admissionCandidate、token 和 revision=r+1 全部相同，且本调用仍持有“core 从未调用”的本地事实，可以继续；若仍是原快照则 STORE_UNAVAILABLE；其他情况或无法读取则 RECOVERY_REQUIRED。

不做无界存储重试。每次确认读取也要完整验证格式，坏数据不被宽泛归类为暂时网络错误。

### C 执行与收束

只有获得准入确认后，才能调用一次 `await agent.prompt(input, { signal })`。如果取消恰在准入 I/O 期间发生且准入最终成功，仍调用 core.prompt 并传入已取消信号，以获得可保存的 cancelled RunResult；不得执行工具。

正常取得 RunResult 后读取只读历史，验证基线并生成后缀。completed、failed、limited、cancelled、refused、incomplete、unknown 都是可保存的 core 终态。

若 core.prompt 意外 reject，或结果 / 快照不能证明符合契约，不合成虚假的失败 Turn、不清 pending；返回 RECOVERY_REQUIRED，关闭该 Agent 的使用入口，必要清理失败附加为 cleanupErrors。本情况没有完整待提交结果，flush 不能修复。

### D 最终保存

生成且保留唯一的 commitCandidate：在 admissionSnapshot 上追加本轮 Turn、设 committedRevision=r+2、清 pending、更新 updatedAt。任何重试都使用同一个提交内容、token、expectedRevision=r+1。

调用最终 CAS，并按以下顺序解析结果：

1. 确认 applied=true 且 revision=r+2：返回 saved。
2. 未获确认时只读刷新一次。若归档中存在同 requestId、inputHash、run、messages、historyStatus、committedAt 和 committedRevision 的完整相同 Turn，视为原提交已经成功。即使当前记录版本已经更高，也返回该 Turn 原 receipt。
3. 原 admissionSnapshot 仍在且没有其他写入：返回 pending / STORE_UNAVAILABLE，保留候选内容供 flush。
4. 记录消失、token 改变、同 requestId 内容不同或其他无法解释的版本变化：返回 pending / COMMIT_CONFLICT，不覆盖新数据。
5. 无法读回：返回 pending / STORE_UNAVAILABLE；格式损坏按 COMMIT_CONFLICT 隔离并报告脱敏诊断。

session.prompt 返回 `{ requestId, run, persistence }`，run 完整保留 core 结果。进入 unsaved 时禁止新的 prompt；已发生的工具事实不能因存储失败而被当作未执行。存储自身违反 CAS 契约同样不能成为重跑工具的理由。

<a id="s07"></a>
## S07 flush、取消与资源释放

flush 有本地 commitCandidate 时按 S06-D 重试一次 CAS 和必要的确认读取；不得重新进入 Agent 或重新生成消息。成功后清除本地候选，返回 saved；失败继续保留 unsaved。多个 flush 不排队，重叠请求返回 SESSION_BUSY。

没有本地候选时，flush 读取当前记录：ready 返回当前 revision；pending 返回 RECOVERY_REQUIRED；blocked 返回 HISTORY_BLOCKED；不存在则 SESSION_NOT_FOUND。closed 后 flush 返回 SESSION_CLOSED。flush 不负责修复其他进程遗留的 pending。

abort 的信号覆盖准备过程与 core 运行；准备阶段取消且尚未获得准入时返回 SESSION_ABORTED，零模型 / 工具调用。准入后由 core 生成 cancelled 终态。最终保存和 Store.close 不使用运行的 AbortSignal，避免取消把最终结果一起丢弃。

session.close 规则：

1. 首次调用立即设置 closing，并发布可复用的 close Promise。
2. 请求取消并等待已有准备、运行或保存操作实际结束。
3. 如仍有本地待保存结果，再执行一次受控补写；不能等待自己同一个 close Promise。
4. 无论补写是否成功，都取消 core 订阅并 await Agent.close；创建失败的部分资源按所有权清理。
5. 状态置 closed，成功 resolve；保存或清理失败则 reject 脱敏 SessionError，保存主错误优先，其余写入 cleanupErrors。重复 close 不再补写或释放。

若带着 unsaved 关闭，本地补写能力随资源释放结束，不得额外清除可能仍存在的 pending。下一次 openSession 允许读取：若 pending 仍在，prompt 返回 RECOVERY_REQUIRED；若原 Turn 实际已提交，则可核对 receipt。不能仅因为“已经 close”就认为可以安全续接。

manager.close 先禁止新管理操作，取消并关闭所有自有句柄，等待此前受理的 create / open / update / delete / read / list。并发 create 若已写入记录，manager 关闭不能隐式删除它；新句柄须关闭后以 MANAGER_CLOSING 拒绝交付。清理一个句柄失败不阻止其他清理，最终聚合错误。Store 仍由应用在外层 finally 中关闭。

不合作的工厂、选择器、Agent 或 Store 可以让取消 / close 持续等待；S1 不使用丢弃后台工作的 Promise.race，不承诺强杀或固定关闭时限。

<a id="s08"></a>
## S08 Store 契约与 SQLite

SessionStore 的五个行为为 create、read、list、compareAndSet、close，另有 durability 属性。实现须捕获对象方法接收者，复制并冻结返回快照；调用方后续修改输入不得改变已保存记录。

| 行为 | 原子性与结果 |
| --- | --- |
| create | 唯一插入、revision=0；同键活记录或墓碑都返回 SESSION_EXISTS |
| read | 返回完整快照；不存在或墓碑返回 undefined；损坏返回 SESSION_FORMAT_INVALID |
| list | 仅当前 namespace 的活记录；返回摘要而非整段归档 |
| CAS 更新 | 在同一原子操作中匹配旧 revision 并替换数据；成功 revision+1；不匹配 / 不存在 / 已删除则 applied=false，无修改 |
| CAS 删除 | next=null；写入不可复用的墓碑并 revision+1，清理正文；保留键及删除版本 |
| close | 停止新 I/O、等待在途 I/O、释放连接；幂等同一 Promise；关闭后新调用 STORE_CLOSED |

Session 服务校验业务转换，适配器负责隔离、格式、复制和原子性。自定义 Store 必须通过相同契约测试。SessionStore 不是面向不可信客户端的 HTTP 管理 API；不得允许业务绕过 Session 服务任意改 pending 或归档。

分页：默认 limit=20，允许整数 1–100；按 `(createdAt, id)` 降序，ID 比较使用 UTF-8 字节序，不使用 localeCompare。cursor 是版本化的 opaque 值，必须绑定 namespace 与上一页边界，错误 / 跨 namespace cursor 返回 SESSION_INPUT_INVALID。分页不承诺跨页事务快照；并发新增记录需刷新首页，已有记录不会因标题更新改变排序位置。

SQLite 至少使用以下逻辑结构，物理细节可在不改变契约的前提下调整：

```sql
CREATE TABLE sessions (
  namespace TEXT NOT NULL,
  id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  body TEXT,
  PRIMARY KEY (namespace, id)
);
CREATE INDEX sessions_list ON sessions(namespace, deleted, created_at DESC, id DESC);
```

数据库 schema 版本与 SessionData.formatVersion 分开管理。首次空库创建 v1；遇到未知库版本拒绝打开，不擅自迁移或清空。CAS 使用事务和条件更新，检查受影响行数；零行是正常冲突，数据库忙或 I/O 错误是 STORE_UNAVAILABLE。事务失败必须 rollback。不得先无锁 SELECT 再无条件 UPDATE。

SQLite 开启 WAL、foreign_keys，并配置固定的 busy_timeout=5000ms 与 synchronous=FULL；实际执行值须在适配器初始化时验证。busy_timeout 是驱动等待策略，不是整个 Session 的强制超时。Memory 持久性标为 memory，SQLite 标为 transactional；后者保证通过数据库提交并通过进程重启验收，不把事务返回夸大为任意硬件故障保证。

创建后确认丢失的处理：createSession 生成固定 ID 和创建内容；create 抛错时只读核对一次，若确认完全相同的 revision=0 记录则可返回；否则保留脱敏错误并包含可核对的 sessionId。显式重复 create 不默认变成 open。update / delete 不自动重试；确认丢失时由调用方重新读取，不以重复写入假定成功。

<a id="s09"></a>
## S09 事件与错误

SessionEvent 使用独立包裹，不向 core AgentEvent 增加 sessionId：

- `{ type: 'agent', sessionId, event }`：原值转发 core 事件；其 runId / seq 不变。
- `{ type: 'session.saved', sessionId, requestId, revision }`：在取得保存确认并更新句柄状态后通知；同一句柄对同一请求只发一次。
- `{ type: 'session.unsaved', sessionId, requestId, code }`：首次进入 unsaved 时通知；同一状态下重复 flush 失败不刷重复事件，失败原因变更可通知一次。

重复请求仅返回历史 receipt，不重放事件。订阅者列表按分发开始时取快照；unsubscribe 影响后续事件。同步异常和异步拒绝交 onObserverError，缺省吞掉脱敏诊断；错误处理器再失败不递归。慢同步订阅者会阻塞当前栈，没有默认队列、回放或背压承诺。

SessionError 具有稳定 code、脱敏 message 和可选 cleanupErrors；涉及创建确认的错误允许附带 sessionId 以供核对。不得附带原始输入、消息、数据库正文、凭证或底层异常 cause。已受理且获得正常 RunResult 的 core 失败仍在 SessionResult.run 中表达。

| code | 触发条件 |
| --- | --- |
| SESSION_CONFIG_INVALID / SESSION_INPUT_INVALID | 工厂配置 / 操作参数不合法 |
| SESSION_NOT_FOUND / SESSION_EXISTS | 记录缺失 / 唯一键已使用，含墓碑 |
| SESSION_BUSY / SESSION_UNSAVED / SESSION_REENTRANT | 本地并发 / 存在补写数据 / 同步回调重入 |
| SESSION_CLOSED / SESSION_CLOSING | 句柄关闭 / 正在关闭 |
| MANAGER_CLOSED / MANAGER_CLOSING | 管理器关闭 / 正在关闭 |
| SESSION_CONFLICT | 管理操作或准入的 expectedRevision 不匹配 |
| REQUEST_MISMATCH | 同 requestId 对应不同 inputHash |
| AGENT_MISMATCH / AGENT_INVALID / AGENT_CREATE_FAILED | 配置身份不符 / 工厂违反实例契约 / 创建抛错 |
| SESSION_CONTEXT_INVALID / SESSION_FORMAT_INVALID | 选择 / 导入失败，或持久记录损坏 |
| HISTORY_BLOCKED / RECOVERY_REQUIRED | 外部结果未知，或有无法确认完成的受理标记 |
| SESSION_ABORTED / SESSION_CAPACITY | 准入前取消 / 准入容量不足 |
| STORE_UNAVAILABLE / STORE_CLOSED | 存储 I/O 未完成确认 / 适配器已关闭 |
| SQLITE_DRIVER_UNAVAILABLE | 可选 SQLite 驱动模块不可加载；根入口和 Memory 不受影响 |
| AGENT_CLOSE_FAILED / OBSERVER_FAILED | 资源释放失败 / 观察者失败 |

SaveResult 的 pending.code 固定为 STORE_UNAVAILABLE 或 COMMIT_CONFLICT。COMMIT_CONFLICT 表示已有执行结果仍待确认但当前持久状态无法安全覆盖，不应转换为可自动重试的 prompt 错误。

<a id="s10"></a>
## S10 容量、删除与生命周期限制

`maxTurns` 限制准入时已保存的轮次数：达到上限拒绝新运行；重复 receipt、读取、补写、关闭、更新元数据和删除仍可进行。

`maxArchiveBytes` 是准入阈值：对将要写入 pending 的 SessionData 计算 UTF-8 JSON 字节数，超过阈值返回 SESSION_CAPACITY。最终提交即使使归档跨过该阈值也必须尝试完整保存；后续新运行再拒绝。这样一轮已经执行完的结果不会被本地配额丢弃。

该阈值不承诺内存硬上限；Store 的实际空间限制仍可能导致 unsaved。每轮输出与工作历史容量由应用配置的 core limits 约束。S1 使用全快照读写，计算与存储成本随归档增长；没有无限会话或数据库吞吐承诺。

删除需显式 expectedRevision，且最新记录不存在 pending。Session 服务在检查后仍通过 CAS 避免竞争；如果执行者先准入，删除冲突，如果删除先成功，执行者准入失败。blocked 会话可以被显式删除，但删除不代表外部副作用已被修复。

墓碑保留原键，create 永不复用。旧句柄下一次读取返回 SESSION_NOT_FOUND，不自动重建。S1 不提供墓碑清除接口。

<a id="s11"></a>
## S11 验收矩阵

| 组 | 必须证明的行为 | 主要证据 |
| --- | --- | --- |
| G1 API 与边界 | 只有 root / sqlite 入口；core / Provider 不反向依赖；根入口不加载驱动；createX 和类型推导一致 | 构建产物、lint、类型与入口测试 |
| G2 管理与隔离 | CRUD、唯一键、分页、命名空间隔离、只读快照、墓碑不可复用、删除后旧句柄失效 | Memory / SQLite 共用契约测试 |
| G3 正常恢复 | 两轮之间重建 Agent；进程 A 保存、进程 B 打开；消息配对、continuation 与原 receipt 保持 | 真实 core + 可控模型、SQLite 子进程测试 |
| G4 历史选择 | 默认全部、合法完整子集、坏选择拒绝、基线不变、空轮次、归档不被裁剪 | 与 core limits 配合的集成测试 |
| G5 准入与去重 | 同句柄互斥、不同句柄与进程竞争仅一方调用工具；同请求同输入重用结果、不同输入拒绝 | 确定性同步屏障和副作用计数 |
| G6 提交与补写 | 最终保存失败保留结果；flush 不执行工具；准入 / 最终确认丢失可核对；冲突不覆盖 | 故障注入 Store、保存 receipt 断言 |
| G7 中断与未知 | 准入后、工具后强制终止进程；重启 pending 不自动执行；core blocked 不能被选择器绕过 | SQLite 与子进程终止测试 |
| G8 取消与清理 | 预取消零写入、准入竞争取消、取消后仍保存、close 幂等、清理失败继续、manager 不关借用 Store | 可控 Promise 与信号监听测试 |
| G9 格式与容量 | 坏数据 / 未知格式 / agentKey 不符执行前拒绝；阈值前拒绝与阈值后仍保存；revision 溢出保护 | 边界值与损坏数据测试 |
| G10 事件 | core.run.end 先于 session.saved；观察者失败隔离、重入保护、补写不重复 core 事件 | 事件序列与同步 / 异步失败测试 |
| G11 SQLite 工程 | 驱动兼容、初始化、事务回滚、跨进程 CAS、墓碑、busy 错误、Store.close | 目标 Node / Windows 环境的实际数据库测试 |

验收使用现有 core 和离线可控 LanguageModel，不依赖真实模型文本。Session 存储与恢复验收不代替 core P0 尚未完成的真实 Provider 联调，也不以其缺配置为跳过 Session 测试的理由。

<a id="s12"></a>
## S12 交付与完成条件

交付 package exports、源代码、Memory 与 SQLite 适配器、共用契约测试、子进程故障测试、类型测试、包 README、可运行示例以及验收记录。实施顺序和逐项勾选见 [S1 TODO](adk-session-s1-todo.md)。

在支持环境完成冻结锁文件安装、build、typecheck、lint、test；既有 core 与 Provider 测试保持通过。包的入口和依赖边界必须直接检查构建产物。数据库测试与子进程中断必须实际执行，缺驱动、跳过或未测不计通过。

当 G1–G11 都有明确证据、API 与文档一致且 TODO 无未完成必需项时，才能标记 S1 完成。本轮实现已按此条件验收，逐项证据见 [验收记录](adk-session-s1-validation.md)。
