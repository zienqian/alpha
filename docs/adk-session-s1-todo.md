# ADK Session S1 实现 TODO

状态：已实现并验收，12 / 12 项完成，36 / 36 条检查完成。日期：2026-11-04。

[验收记录（G1–G11）](adk-session-s1-validation.md) · [实施 Spec](adk-session-s1-spec.md) · [API 声明](adk-session-api-s1.d.ts) · [交互设计](adk-session-design-s1.html)

每项同时交付实现和对应验证，不把所有测试推迟到最后。S1 新增会话包，core 保持当前公开 API。任务顺序表示依赖关系，不表示必须使用多个 Agent 或并行开发。

| 阶段 | 顺序 | 退出条件 |
| --- | --- | --- |
| A 工程与数据 | S1-01 → S1-02 → S1-03 | 依赖可安装、契约固定、Memory Store 可验证 |
| B 会话与运行 | S1-04 → S1-05 → S1-06 → S1-07 | 管理、恢复、原子准入、保存与补写闭环 |
| C 生命周期与持久化 | S1-08 → S1-09 → S1-10 | 取消与清理、SQLite、多进程故障得到验证 |
| D 示例与验收 | S1-11 → S1-12 | 可运行示例和 G1–G11 证据齐全 |

<a id="s1-01"></a>
## S1-01 工程预检与包边界

依赖：无。Spec：S01 / S02 / S12。验收：G1 / G11。

- [x] 确认并锁定兼容仓库 Node 范围与 Windows 的 SQLite 驱动版本，验证安装、事务和目标平台可用性；记录依据，不擅自改变 workspace engines。
- [x] 新建 packages/adk-session 及 root / sqlite exports、构建与测试配置；SQLite 可选 peer 和开发依赖显式声明，更新锁文件。
- [x] 增加 layer:session 与公开导入限制，验证 core / Provider 无反向依赖、根入口不加载驱动、内部路径不可导入。

<a id="s1-02"></a>
## S1-02 公共类型、配置和归档编码

依赖：S1-01。Spec：S03 / S04 / S09 / S10。验收：G1 / G9。

- [x] 落地 API 附件、工厂配置、脱敏 SessionError、默认准入阈值和标识规则；校验未知字段与非法选项。
- [x] 实现严格 JSON 复制 / 冻结、formatVersion=1 编解码、消息配对及 requestId / runId / revision 一致性检查；坏数据不作为空会话。
- [x] 固定 inputHash 编码与 committedRevision 语义；类型用例覆盖上下文 Agent 工厂、静态 Store、事件区分及不可变快照。

<a id="s1-03"></a>
## S1-03 Memory Store 与共用契约

依赖：S1-02。Spec：S08 / S10。验收：G2 / G9。

- [x] 实现原子 create / read / list / CAS / close，区分正常冲突与 I/O / 关闭错误，隔离调用方对象修改。
- [x] 实现作用域与稳定分页 cursor、删除墓碑、ID 永不复用、版本溢出保护；read / list 隐藏墓碑。
- [x] 建立适用于所有 Store 的契约测试，覆盖跨 namespace、并发 CAS、快照、分页、删除和重复关闭。

<a id="s1-04"></a>
## S1-04 SessionManager 与句柄管理

依赖：S1-03。Spec：S03 / S05 / S10。验收：G2 / G5。

- [x] 实现 create / open / get / list / update / delete；更新仅改元数据，确认丢失的创建保留可核对 ID。
- [x] 实现句柄快照、同步占用与 closing 检查；同会话多个句柄各自拥有 Agent，不把 open 当作执行授权。
- [x] 覆盖 pending 时禁止元数据变更 / 删除、删除与准入竞争、旧句柄不能误写复用 ID、agentKey 不匹配的读写边界。

<a id="s1-05"></a>
## S1-05 Agent 组合与历史恢复

依赖：S1-04。Spec：S04 / S05 / S10。验收：G3 / G4 / G9。

- [x] 惰性创建并独占 Agent，校验 fresh / idle / empty 契约；只调用 core 公开 API，不新增 core hook。
- [x] 实现完整轮次选择、工作集导入、基线校验和本轮后缀提取；归档不随上下文裁剪，blocked 不可绕过。
- [x] 使用真实 core 验证多轮恢复、continuation 原值、空轮次、坏选择、工作集超限及选择器异常 / 取消。

<a id="s1-06"></a>
## S1-06 原子准入与请求去重

依赖：S1-05。Spec：S06-A / S06-B / S06-C。验收：G5 / G7 / G9。

- [x] 在任何 core.prompt 前持久化 pending token；版本同时为准入和最终提交预留，达到准入阈值时零执行。
- [x] 实现同 requestId 同输入的历史 receipt 返回、不同输入拒绝、准入冲突和丢失确认的单次读取核对。
- [x] 以确定性屏障证明多句柄仅一个调用模型 / 工具；外部 pending 不接管，core 意外 reject 保留未知状态。

<a id="s1-07"></a>
## S1-07 最终提交与 flush

依赖：S1-06。Spec：S06-D / S07 / S10。验收：G6 / G9。

- [x] 原子保存完整 Turn 与 receipt 并清 pending，执行结果和保存结果分开；固定候选内容用于补写。
- [x] 实现 unsaved / flush、同内容提交确认、错误或更高 revision 的判定；禁止自动重跑 core 或覆盖冲突数据。
- [x] 覆盖执行成功后保存失败、确认丢失、重复 flush、容量阈值被最后一轮跨过仍保存、blocked 原样保存。

<a id="s1-08"></a>
## S1-08 取消、事件与资源生命周期

依赖：S1-07。Spec：S05 / S07 / S09。验收：G8 / G10。

- [x] 实现准备 / 执行取消、准入中取消后的 cancelled 归档、保存信号隔离；不合作操作不提前释放。
- [x] 实现 Session / manager close 同 Promise、等待管理操作、保存失败仍清理、聚合脱敏错误与 Store 所有权。
- [x] 实现事件包裹、saved / unsaved 通知、观察者隔离与重入保护；验证没有重复 core 事件或虚假保存确认。

<a id="s1-09"></a>
## S1-09 SQLite 适配器

依赖：S1-03、S1-08。Spec：S02 / S08。验收：G2 / G11。

- [x] 实现独立 sqlite 子入口、数据库版本、初始化、连接配置验证、close 与驱动缺失诊断。
- [x] 通过事务实现唯一创建、条件 CAS、墓碑和列表索引；失败回滚，busy 错误与版本冲突分开处理。
- [x] 在真实 SQLite 上运行全部共用 Store 契约测试，并验证初始化失败清理、关闭及根入口无驱动加载。

<a id="s1-10"></a>
## S1-10 跨进程恢复与故障矩阵

依赖：S1-09。Spec：S06 / S07 / S08 / S11。验收：G3 / G5 / G6 / G7 / G11。

- [x] 用进程 A 保存、进程 B 恢复证明数据库而非共享内存提供会话连续性，验证原消息与原 receipt。
- [x] 两个真实进程竞争同一会话，只允许一个进入工具执行；竞争测试使用同步屏障，不依赖随机延时。
- [x] 在准入后与工具副作用后实际终止子进程，重启仍保留 pending、拒绝自动重跑；测试自己清理测试进程与临时数据库。

<a id="s1-11"></a>
## S1-11 示例与使用文档

依赖：S1-10。Spec：S03 / S12。验收：G1 / G3 / G8。

- [x] 交付可运行的 Memory 与 SQLite 示例，使用现有 Provider 或离线模型；演示创建、关闭、重新打开和第二轮续接。
- [x] README 明确 namespace / requestId / agentKey、保存结果、flush、取消与资源所有权，示例正确处理 unsaved。
- [x] 同步 API 附件与交互页，明确 Memory 易失、pending 不自动修复、上下文选择不裁归档及线性会话范围。

<a id="s1-12"></a>
## S1-12 完成验收

依赖：S1-11。Spec：S11 / S12。验收：G1–G11。

- [x] 冻结锁文件安装并执行 build、typecheck、lint、test；既有 core / Provider 回归通过，SQLite 和子进程测试实际运行。
- [x] 检查运行时导出、声明、依赖图、包内容与 Node 兼容证据，确认没有新增 core 专属 Session API 或未声明运行时依赖。
- [x] 创建验收记录并逐项关联 G1–G11 的命令、环境与结果；仅证据齐全后勾选完成，有跳过或失败保持未完成。

## 记录规则

本文件是实施进度的权威来源。每个勾选必须能对应实现和验证证据；设计已确认、文件已创建、测试被跳过均不能作为完成条件。HTML 内的本地 Review 选择不会修改本文件，也不自动批准新的范围。

core P0 的真实 Provider 联调已另行通过用户提供的本机服务完成，见 [P0 验收记录](adk-p0-validation.md)。它独立于 S1 的存储 / 恢复验收，不代替 Session 测试。
