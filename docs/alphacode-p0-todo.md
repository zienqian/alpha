# alphacode P0 实施 TODO

状态：功能已编码，22 项完成自动化验收；T01、T06 尚有人工部分，T24 待人工验收。证据见 [验收记录](alphacode-p0-validation.md)。功能定义以 [P0 Spec](alphacode-p0-spec.md) 为准；[HTML](alphacode-design-a1.html) 用于评审。P0 仅交付终端应用，没有对外 SDK、JSONL、HTTP/RPC 或 app server。

每项完成需要代码、对应验收证据和资源清理检查；不能只以组件出现或类型检查通过勾选。任务按依赖顺序实施，同阶段可在明确边界后拆分。

## G0 — 先验证运行时组合

### T01 — 固定可运行的 OpenTUI + Solid 组合

- [ ] 实现与原生/PTY 检查通过；真实 Windows Terminal 操作和截图记录随 T24 验收。

依赖：无。关联：F01、F10。

改动：独立验证目录中的最小 ESM + Solid universal transform 程序；记录实际发布的 Core、Solid、SolidJS、Node 和 SQLite 版本，不修改已有库的执行模型。

验收：Windows x64 正常挂载 Textarea、Markdown、ScrollBox；中文可输入；resize 后布局恢复；Ctrl+C 退出后光标、raw mode 正常。产出运行命令、版本和截图/录屏记录。

### T02 — 验证 SQLite 与工作区进程生命周期

- [x] 已实现并验证；具体命令、夹具与资源清理证据见 [验收记录](alphacode-p0-validation.md)。

依赖：T01。关联：F01、F06、F07。

改动：同一选定运行时中组合现有 SQLite Store 与 Local Workspace 的小型探针；仅在必要时修正明确的兼容问题。

验收：数据库 create/read/CAS/重开通过；两个并发期望 revision 只有一个成功；运行派生子进程命令并取消，父/子均退出、租约释放。若失败，先修订运行时决定，不开始业务 UI。

## M1 — 能从正确目录输入任务

### T03 — 应用包、bin 与构建

- [x] 已实现并验证；具体命令、夹具与资源清理证据见 [验收记录](alphacode-p0-validation.md)。

依赖：T02。关联：F01。

改动：apps/alphacode 包与 Nx 目标；bin、UI TSX 编译、根启动脚本；仅 bin，无供消费的 exports。库继续现有构建。

验收：从项目外路径调用 bin 保留调用 cwd；help/version 不初始化 renderer、数据库或模型；非 TTY 给出 P0 限制并退出 2。

### T04 — 配置、工作区与用户数据目录

- [x] 已实现并验证；具体命令、夹具与资源清理证据见 [验收记录](alphacode-p0-validation.md)。

依赖：T03。关联：F01。

改动：config.ts；固定读取 os.homedir() 下的 `.alphacode/config.yaml`；单份 YAML 模板/解析/字段校验；Provider 选择；工作区与 `~/.alphacode/sessions.sqlite` 初始化；错误诊断。为 Provider 补充配置内密钥值的直接使用能力，复用已有无鉴权路径；不得通过 process.env 中转。

验收：不接收配置路径参数、不读取 dotenv 或环境变量配置、不合并项目配置；同一用户从两个工作区启动始终读取同一 YAML。缺失文件只创建注释模板并退出，现有文件不覆盖；重复键、错误行列、字段缺失与不可访问路径有明确诊断。完整模型 ID 不被切分；none/value 凭证互斥，直接密钥鉴权与无鉴权分别验证；启动模型调用数为 0，错误不泄漏 key，不退回 Memory Store。

### T05 — 终端骨架与焦点路由

- [x] 已实现并验证；具体命令、夹具与资源清理证据见 [验收记录](alphacode-p0-validation.md)。

依赖：T04。关联：F10。

改动：App/Header/Transcript/Composer/StatusBar；单 Overlay 宿主；统一 keyboard router 与 cleanup。

验收：120×40、80×24、60×18 可用；过小窗口显示提示并保留退出；同一按键不会同时触发 Composer 和 Overlay。

### T06 — Composer、多行与草稿

- [ ] 中文粘贴、换行、草稿和快速提交已有自动化证据；真实 IME 选字行为待 T24。

依赖：T05。关联：F02。

改动：Textarea 绑定；Enter / Ctrl+J；paste；UTF-8 输入限制；输入历史；每会话内存草稿。

验收：中文选字不误提交；20 行粘贴只写入输入框；64 KiB 以上明确拒绝提交；历史切换可找回当前草稿。

### T07 — 首次提交与唯一执行点

- [x] 已实现并验证；具体命令、夹具与资源清理证据见 [验收记录](alphacode-p0-validation.md)。

依赖：T06。关联：F02、F07。

改动：runtime.ts 中延迟创建 Session/Agent；接入 createSessionPlugin；submitting 门禁、requestId、输入气泡与准入失败回填。

验收：5 次快速 Enter 只调用一次 agent.prompt；无提交退出无空会话；忙时输入只成为草稿；workspace busy 不丢任务文本。

## M2 — 看得懂执行并能做决定

### T08 — 规范消息与流式投影

- [x] 已实现并验证；具体命令、夹具与资源清理证据见 [验收记录](alphacode-p0-validation.md)。

依赖：T07。关联：F03。

改动：projection.ts；按 modelCallId 合并 delta；message.commit 取 Agent.state；区分规范文本与未提交临时文本。

验收：多段 delta + 最终全文只显示一次；多个 model calls 顺序正确；失败流式文本标注未归档，resume 不伪造它。

### T09 — Markdown 与阅读位置

- [x] 已实现并验证；具体命令、夹具与资源清理证据见 [验收记录](alphacode-p0-validation.md)。

依赖：T08。关联：F03、F10。

改动：Markdown 展示、滚动跟随、未读提示、历史窗口挂载、键盘选中消息。

验收：上翻不被新输出拉回；End 重新跟随；半个围栏仍可读；活动列表最多 200 个展示块，大历史不全量挂载。

### T10 — 读取、列表、搜索三类卡片

- [x] 已实现并验证；具体命令、夹具与资源清理证据见 [验收记录](alphacode-p0-validation.md)。

依赖：T08。关联：F04。

改动：toolCalls 建 planned 卡片；完整调用键；read_file/list_files/search 结果解析与折叠详情。

验收：行号从 startLine 起算；0 命中不显示失败；truncated 不被说成全部结果；重用 callId 不串卡。

### T11 — 编辑与创建片段

- [x] 已实现并验证；具体命令、夹具与资源清理证据见 [验收记录](alphacode-p0-validation.md)。

依赖：T10。关联：F04。

改动：policy 捕获已验证动作；替换前后/创建内容视图；16 KiB 截断；恢复时读取归档参数。

验收：不将 C1 片段当标准 unified diff；FILE_CONFLICT / FILE_EXISTS 显示未发生修改；不读取当前文件假造旧预览。

### T12 — 命令卡片与真实结果

- [x] 已实现并验证；具体命令、夹具与资源清理证据见 [验收记录](alphacode-p0-validation.md)。

依赖：T10。关联：F04。

改动：命令/目录/shell 展示，stdout/stderr 流缓冲，运行时长，规范结果解析。

验收：48 KiB 缓冲上限和截断标记有效；exitCode 非零即显示失败，execution=succeeded 不覆盖业务失败；工具结果异常只降级展示。

### T13 — 一次性命令审批

- [x] 已实现并验证；具体命令、夹具与资源清理证据见 [验收记录](alphacode-p0-validation.md)。

依赖：T12。关联：F05。

改动：ApprovalPanel、pending Promise、动作 digest/键关联、默认拒绝焦点、AbortSignal cleanup。

验收：面板出现早于 tool.start；允许前执行次数为 0；拒绝无需 tool.start 也有卡片；取消后迟到允许无效；重复 Enter 不误批准新面板。

## M3 — 停得下来，存得完整

### T14 — 运行取消与退出协调

- [x] 已实现并验证；具体命令、夹具与资源清理证据见 [验收记录](alphacode-p0-validation.md)。

依赖：T13。关联：F06。

改动：唯一关闭流程、重复 close 防护、退出意图、5 秒等待反馈、信号处理；按所有权关闭资源。

验收：审批/模型/命令阶段均可取消；派生子进程被 drain；再次 Ctrl+C 不提前释放租约；cleanup 异常也恢复终端。

### T15 — 保存状态与最近书签

- [x] 已实现并验证；具体命令、夹具与资源清理证据见 [验收记录](alphacode-p0-validation.md)。

依赖：T14。关联：F07。

改动：Session 事件投影，run.end 到 saved 的间隔状态，首条输入标题，成功保存后的每工作区书签。

验收：run.end 时不能显示已保存；保存成功后才开放下一轮；书签失败不改变归档成功事实；无额外 messages.json。

### T16 — 完整 turn 上下文选择

- [x] 已实现并验证；具体命令、夹具与资源清理证据见 [验收记录](alphacode-p0-validation.md)。

依赖：T15。关联：F07。

改动：私有完整后缀选择器，12 turns / 256 messages / 2 MiB 三重预算；过大最新 turn 的诊断。

验收：按 JSON UTF-8 字节计量；不拆 assistant/toolResult；归档不减少；最大最新 turn 不被默默跳过；状态栏正确展示选入轮数。

### T17 — 保存失败与重试

- [x] 已实现并验证；具体命令、夹具与资源清理证据见 [验收记录](alphacode-p0-validation.md)。

依赖：T15。关联：F09。

改动：unsaved 面板、单次 flush 门禁、/retry-save、CAS 冲突说明、明确退出决定。

验收：注入 store unavailable，工具执行后仅重试写库；连续点击只有一次 flush；保存成功不重复消息；失败退出保留磁盘 pending。

### T18 — 故障分类与只读隔离

- [x] 已实现并验证；具体命令、夹具与资源清理证据见 [验收记录](alphacode-p0-validation.md)。

依赖：T16、T17。关联：F09。

改动：网络/认证/业务失败/unknown/boundary 错误投影；pending/blocked 只读模式；脱敏详情。

验收：重启 pending 无 candidate 时不显示可恢复执行按钮；未知结果不能继续原会话；未确认现场不自动换 requestId；不调用私有 core 恢复接口。

## M4 — 能关闭，再回来继续

### T19 — Session picker 与历史装载

- [x] 已实现并验证；具体命令、夹具与资源清理证据见 [验收记录](alphacode-p0-validation.md)。

依赖：T18。关联：F08。

改动：每页 25 条、创建时间排序标签、已加载筛选、快照展示、旧请求 generation 丢弃。

验收：跨工作区隔离；加载更多使用正确 cursor；切换选择期间旧响应不覆盖新选择；pending/blocked 可以只读查看。

### T20 — 新建、切换与 resume

- [x] 已实现并验证；具体命令、夹具与资源清理证据见 [验收记录](alphacode-p0-validation.md)。

依赖：T19。关联：F08。

改动：resume 参数、--last 书签路径、关闭旧 Agent 后装配目标、/new 欢迎态、内存草稿保存。

验收：保存 A 后新建 B 再保存 A，--last 指向 A；无书签进入选择器不乱选；切换时只有一个租约；失败留在可退出的界面。

### T21 — 标题与七个 Slash 命令

- [x] 已实现并验证；具体命令、夹具与资源清理证据见 [验收记录](alphacode-p0-validation.md)。

依赖：T20。关联：F02、F08、F10。

改动：静态命令表、/ 前缀提示、Tab 补全、// 转义、CAS rename、help/status 面板。

验收：命令不进模型历史；所有入口遵守状态前置条件；/exit 可在运行时请求退出；重命名冲突不覆盖；帮助与代码中命令数量一致。

## M5 — 最终验收与可交付产物

### T22 — 控制字符、宽字符与缓存边界

- [x] 已实现并验证；具体命令、夹具与资源清理证据见 [验收记录](alphacode-p0-validation.md)。

依赖：T21。关联：F10。

改动：统一显示清理、列宽处理、事件合并、过载取消后重建视图；清理所有 listeners/timers。

验收：OSC/CSI 夹具不能改终端标题或剪贴板；中文/emoji 不截半；缓存边界不无限增长；observer 不同步重入 Agent。

### T23 — 确定性端到端夹具

- [x] 已实现并验证；具体命令、夹具与资源清理证据见 [验收记录](alphacode-p0-validation.md)。

依赖：T22。关联：F01–F10。

改动：临时项目、离线模型响应、真实文件与 PowerShell 命令；存储失败/冲突/中断注入。

验收：Spec 六条 Release Gate 全部有可重复证据，尤其副作用计数、进程状态和重启归档；组件截图不代替工具事实。

### T24 — Windows Terminal 手工验收

- [ ] 待人工验收；原生注入 P95 与 PTY 模式恢复已记录，不能代替真实 IME/物理键盘。

依赖：T23。关联：F02、F03、F05、F06、F10。

改动：记录实测终端、运行时版本、机器、尺寸与按键矩阵；修复焦点和布局问题。

验收：中文输入法、长粘贴、30 次/秒流输出中编辑、审批默认焦点、窗口缩放、长历史阅读、退出恢复。记录输入延迟，目标 P95 <100ms。

### T25 — 显式本地模型探针与交付说明

- [x] 已实现并验证；具体命令、夹具与资源清理证据见 [验收记录](alphacode-p0-validation.md)。

依赖：T24。关联：全部功能。

改动：通过已授权本地 /v1 服务在临时项目执行小型修复；补 README 启动、配置、会话路径、限制与排错说明。

验收：失败测试被实际修复，测试命令由用户批准，归档后重开能继续回答；help/version、构建产物与文档一致；没有新增对外 API/JSONL/server 入口。记录真实调用结果，不把本轮 HTML 模拟当验证证据。

## 完成判定

T01–T25 全部完成，Spec 的六条 Release Gate 全部通过，未解决的阻断性问题为 0。若 scope 变化，先修改 Spec 和本 TODO，再实施；不能把尚未实现的功能留在 UI 当作可用按钮。
