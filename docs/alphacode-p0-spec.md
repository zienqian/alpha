# alphacode P0：功能与实现规格

状态：P0 功能已编码并完成自动化与本地模型联调；Windows Terminal 输入法手工验收待完成。更新：2026-11-04。本规格替代上一版 A1 的功能范围与 API 规划。见 [验收记录](alphacode-p0-validation.md)，不把代码完成等同于所有发布门槛通过。

[交互评审页](alphacode-design-a1.html) · [P0 实施 TODO](alphacode-p0-todo.md)

## 0. P0 到底交付什么

交付一个可以在真实项目目录使用的 **Windows 终端 coding agent**：用户输入修复任务，看见模型回答和六个工具的实际结果，确认命令，随时取消，关闭后可以恢复对话继续工作。

P0 是 `apps/alphacode` 中的独立 CLI 应用，使用 OpenTUI + SolidJS。**不提供 alphacode SDK，不导出应用工厂，不发布事件/JSONL 协议，不实现 HTTP、RPC 或 app server。** 文中的状态结构、事件映射和模块函数均为可随实现调整的应用内部设计。未来 alphacode app server 的 API、协议与客户端边界由后续规划决定，不以本版 UI 数据结构作为兼容承诺。

下面是 P0 的功能清单。每一项都有后续对应的实现细节和验收条件，全部完成才算 P0 完成。

| 编号 | 功能 | 用户实际获得的能力 | 复用 / 新增 |
| --- | --- | --- | --- |
| F01 | 启动与工作区 | 从指定目录启动；固定读取 ~/.alphacode/config.yaml；失败时得到可操作的诊断 | 复用 Provider / Workspace；新增 YAML 配置与启动流程 |
| F02 | 任务输入 | 中文、多行、粘贴、草稿、输入历史；防止重复提交 | 新增 Composer 与按键路由 |
| F03 | 对话展示 | 流式回答、基础 Markdown、历史滚动、跟随最新消息 | 新增 UI 投影；读取既有 Agent / Session 数据 |
| F04 | 六工具工作过程 | 看见读什么、改什么、执行什么，以及真实结果与错误 | 工具已存在；新增工具卡片、片段预览、输出展示 |
| F05 | 命令审批 | 看清命令/目录/shell；允许本次或拒绝；取消后不执行 | 复用 CodingPolicy / CodingApproval；新增审批界面 |
| F06 | 取消与退出 | 中断任务，等待命令子进程退出，恢复终端 | 复用 abort / drain；新增退出协调 |
| F07 | 自动保存 | 每轮自动归档；区分执行完成与保存完成；重启仍可读 | 复用 Session S2 / SQLite；新增 UI 状态与最近书签 |
| F08 | 会话管理 | 新建、选择、恢复、重命名、继续上次保存的会话 | 复用 SessionManager；新增选择器与切换流程 |
| F09 | 故障处理 | 分清命令失败、文件冲突、保存失败、未知结果；执行正确恢复动作 | 复用既有错误事实；新增错误文案与动作限制 |
| F10 | 终端可用性 | 窄窗口、中文宽字符、焦点、长输出、帮助与终端清理 | 新增 OpenTUI / Solid 适配与真实终端验证 |

### 不计入 P0

非交互 `run`、JSONL、公开 JS API、app server、远程控制；模型热切换、多模型路由 UI；运行中 steering/输入队列；`@文件` 自动补全与图片附件；MCP/Skills 自动发现、subagent；会话分支、自动摘要、Git checkpoint/回滚；主题市场、插件市场、跨平台 Workspace、单文件可执行发布。

用户仍可在普通任务文本中写相对文件路径，由现有工具读取。P0 固定一个启动时选定的模型；更改模型配置后重新启动。工具权限固定采用 C1 默认行为：读取、搜索、编辑、创建允许，命令询问，自定义动作拒绝。多权限模式和持久化 allowlist 后续再做。

## 1. 交付场景与界面

核心验收任务使用临时项目中的一个确定失败测试：用户启动 alphacode，提交“修复分页边界并运行测试”，看见读取与替换片段，批准测试命令，看到测试退出码与回答，保存后退出，再恢复该会话询问“刚才修改了哪里”。整个过程不能靠脚本预先代替 Agent 修改文件。

正常布局以 100 列 × 32 行为参考：

```text
alphacode  C:\work\demo                  codex/gpt-6.1-sol
会话：修复分页边界                         已加载当前项目指令
────────────────────────────────────────────────────────
你  修复分页边界并运行相关测试。

alphacode  我先查看实现和测试。
▸ read_file  src/pagination.ts:1        已读取 · 部分内容
▾ edit_file  src/pagination.ts          已修改
  替换前：items.slice(start, start + size - 1)
  替换后：items.slice(start, start + size)
▸ run_command  pnpm test                运行中 · 2.1s
  stdout  ...
────────────────────────────────────────────────────────
› 继续输入草稿；当前任务结束后再提交
────────────────────────────────────────────────────────
运行中 · 2.3s   本轮未保存   Ctrl+C 取消   F1 帮助
```

固定区域：Header 2 行；Status 1–2 行；Composer 3–8 行；其余空间给 Transcript。审批在底部独占焦点，并保留原草稿。Session picker、帮助、工具详情均为当前 renderer 内的面板，不打开第二个 renderer。

宽度 ≥100 列显示完整 cwd/模型/会话；60–99 列折叠路径并压缩 Header；不足 60 列或 18 行时显示“窗口过小，请放大”，保留取消/退出能力，不能继续盲批命令。

## 2. F01 — 启动、配置与工作区

### 用户操作

```sh
# 拟定命令，目前尚未实现
alphacode
alphacode --cwd C:/work/demo
alphacode resume
alphacode resume <session-id>
alphacode resume --last
alphacode --help
alphacode --version
```

`--cwd` 只选择工作区，相对路径以启动时的原始 cwd 解析。默认 cwd 是调用目录，不是包目录。配置路径固定，不提供配置路径参数；传入 `--config` 或 `--env-file` 按未知参数报错。仓库开发命令拟定 `pnpm alphacode ...`，根脚本直接启动应用 bin，不能通过改变 cwd 的 filter 启动方式误操作仓库。

P0 交互入口要求 stdin/stdout 都是 TTY。不满足时在 stderr 输出“P0 仅支持交互终端”，退出 2；不读取管道输入，也不悄悄转成 headless。`--help/--version` 不要求 TTY，不加载模型、数据库或原生 renderer。

### 唯一配置约定：~/.alphacode/config.yaml

用户目录由 `os.homedir()` 解析，固定读取该目录下 `.alphacode/config.yaml`。在当前电脑上是 `C:\Users\ziyang\.alphacode\config.yaml`。切换工作区不会切换配置；不提供任何配置路径覆盖入口。

以下为用户本地服务的 YAML 配置示例：

```yaml
# ~/.alphacode/config.yaml
provider:
  adapter: openai-completions
  options:
    baseURL: http://127.0.0.1:3425/v1
    apiKey:
      none: true
model:
  id: codex/gpt-6.1-sol
```

配置只有这一份 YAML，没有配置来源优先级合并。alphacode 不读取 dotenv，不使用 ADK_* 等环境变量提供或覆盖配置，不支持 `{env: ...}` 凭证引用，也不展开 `${...}`。环境变量的存在不应改变已解析的 YAML。命令执行的子进程环境属于 Workspace 能力，不参与应用配置读取。

`provider.adapter`、`provider.options.baseURL`、`provider.options.apiKey` 和 `model.id` 必填；模型 ID 是完整字符串，不拆斜杠。无鉴权使用 `apiKey: {none: true}`；需要密钥时使用 `apiKey: {value: "实际密钥"}`，二者互斥。密钥来自此配置文件，不能通过环境变量补齐缺失值。

现有 Provider 的凭证类型只支持 env/none，尚不支持 value。T04 实施时需补充直接使用已解析密钥值的最小能力并验证鉴权请求，不能把 YAML 的密钥写进 process.env 作为绕行方案；这一兼容缺口不是已完成能力，也不增加 alphacode 对外 API。

解析采用 UTF-8 YAML 数据模式，只接受单个 mapping 文档；重复键、未知应用字段、非法类型和可执行自定义 tag 均报错。错误显示配置文件绝对路径、行列号或字段路径及修正提示，不回显密钥。启动成功后使用本次配置快照；修改文件后重新启动生效，P0 不热加载。

### 首次启动与配置错误

- 配置不存在：创建 `~/.alphacode/`，以只创建、不覆盖方式写入带注释的 `config.yaml` 模板。模板的端点和模型留空，提示用户填写固定文件后重新运行 `alphacode`，本次退出 2；不创建会话、不请求模型。上面的本地端点是本文示例，不硬编码成所有用户的默认值。
- 配置已存在：只读取，不在普通启动时重写或迁移内容；空字段、语法错误或无效凭证给出明确诊断后退出 2。
- 目录/文件不可访问：报告实际路径和文件系统错误，不改读项目配置，也不回退其他目录。
- `--help`、`--version` 不读取或创建配置文件。初始化模板限制为当前用户可访问；密钥不出现在日志、状态面板或诊断导出中。

### 启动顺序

1. 捕获原始 cwd，解析参数；优先处理 help/version。
2. 检查 TTY、Node/原生依赖与配置；canonicalize 工作区，验证目录存在。
3. 创建 Local Workspace，验证 Windows、PowerShell 7、rg；不发送模型请求。
4. 配置有效后打开 `~/.alphacode/sessions.sqlite`。配置、会话与最近书签统一存放在用户 home 的 `.alphacode` 下，不再使用其他平台数据目录。SQLite 打不开就报错，不退化为临时内存会话。
5. 创建 SessionManager，namespace 来源于规范 workspace.id 的摘要；装载最近会话书签。
6. 挂载一个 OpenTUI renderer 与 Solid 根组件，显示欢迎页，焦点进入 Composer。
7. 新会话**延迟到第一条有效任务提交**时创建 Session + Agent，避免每次打开终端留下空会话；resume 先读归档，只在用户决定继续有效会话时创建 Agent。

Agent 初始化时 C1 才申请独占 workspace 租约，并读取 root AGENTS.md。若工作区已被另一 Agent 占用，保留任务草稿并显示“工作区正在使用”；不轮询自动抢占。应用不启动第二条 Loop。

### 验收

- 从仓库外目录启动，读取/写入均落在用户选择的工作区。
- `~/.alphacode/config.yaml` 指向用户提供的本地模型服务，启动时模型调用次数为 0；工作区中的同名文件或 `.env` 不影响它。
- 无配置时仅创建一次模板；已有 YAML 不被覆盖；设置相互冲突的 ADK_* 环境变量也不改变配置结果；配置路径参数被拒绝。
- 启动后不提交就退出，数据库没有新增会话。
- 目录不存在、配置缺失、rg 不存在、数据库不可写，各自给出具体错误；终端回到正常模式。

## 3. F02 — 输入、草稿与提交

### 输入行为

- Composer 使用 OpenTUI Textarea，保留光标、多行与选择行为；不自己按字符重写编辑器。
- Enter 提交；Ctrl+J 插入换行。Shift+Enter 只有在实际终端协议验证支持后启用；不能作为唯一换行方式。
- bracketed paste 一次插入文本，粘贴内的换行不触发提交；输入法选字 Enter 不能提交未完成的中文组合。
- 将 CRLF 统一为 LF；仅用 trim 判断是否为空，不删除任务的有效前后空白。输入上限 64 KiB UTF-8；超过时保留原草稿并提示缩短，不静默截断提交。
- Alt+Up/Alt+Down 浏览当前会话最近 50 条用户输入；修改历史项只影响草稿，不修改已保存消息。切换历史前暂存正在编辑的草稿。
- 运行时继续允许编辑下一条草稿；Enter 显示“当前任务尚未结束”，既不调用 prompt，也不排队。P0 没有 steering。

### 提交流程（内部流程，不是新 API）

```text
按 Enter
  先识别 Slash 命令，按该命令自己的前置条件处理
  检查输入 / 运行 / 保存 / 历史状态
  同步设置 submitting=true，锁住重复 Enter
  捕获本次 input；生成 requestId；新会话必要时创建 Session 和 Agent
  订阅已就绪后，调用 agent.prompt(input, { requestId })
  收到 user message.commit：将暂存输入气泡替换成规范消息，清空已提交草稿
  后续输入成为独立草稿，不覆盖本次 input
  等待 prompt 返回与 Session 状态处理，最后解除 submitting
```

提交期间 UI 显示“准备中”。如果准入前出现可确认失败，恢复本次输入为草稿，并标记未执行；若用户已开始编辑新草稿，则保留两份，在提示中提供“恢复上次输入”动作，不覆盖新内容。无法确认是否已经写入 pending 时先进入 F09 待核查，不自动生成新 requestId 再试。

### 验收

- 连续快速按 5 次 Enter，只产生一个 requestId、一个 prompt 和一条用户消息。
- 粘贴含 20 个换行的中文代码说明，不产生请求，直到显式提交。
- 流式回答时键入第二条任务，第一条任务输入不变化；第二条不被自动发送。
- 模型未启动前遇到 workspace busy，原任务仍能完整恢复到编辑区。

## 4. F03 — 消息、Markdown 与滚动

### 要显示的内容

用户消息、assistant 回答、工具卡片、运行结果条、保存提示。assistant 支持段落、列表、标题、行内代码、围栏代码、引用；表格至少可读、可横向查看，不要求完整 GitHub 样式。链接只展示地址，P0 不自动打开浏览器。不展示供应商没有返回的 reasoning，也不伪造“思考过程”。

### 流式投影

`model.delta` 按 runId + modelCallId 累积到一个临时回答块，每 33ms 最多刷新一次。`message.commit` 到来后，以 messageId 从 `agent.state.messages` 取已提交对象替换临时块，不能把最终全文再追加一次。

一次 run 可能包含多个 model calls；每段 assistant 文本保留独立块，工具卡片插入对应 assistant 的 toolCalls 后。只对当前流式块更新；已完成消息不随每个 token 全量重建。

若输出中断且没有提交规范消息，灰色展示“中断输出，未归档”，可留到本次退出，但不能在恢复会话时伪造持久消息。流式 Markdown 的半个代码围栏必须保持可读，结束后重新完成块布局。

### 阅读行为

- 用户在底部时自动跟随新增内容；向上滚动后暂停跟随，显示“有新内容 ↓”。点击提示或 End 返回底部再恢复跟随。
- Tab 在 Composer 与 Transcript 间切换；Transcript 聚焦时 Up/Down 选择消息/工具卡片，Enter 展开/折叠，PageUp/PageDown 翻页。
- 一个工具默认折叠为 1–2 行；正在运行的命令展示最后 6 行输出，失败摘要保持可见。详情区允许滚动，不撑破整个终端。
- 恢复会话从 Session snapshot 建立列表。初始挂载最近 200 个展示块，向上操作时加载更早窗口；保留完整归档对象引用，避免再深拷贝一份内容。现有 getSnapshot 是整份读取，P0 不宣称数据库已有按 turn 分页接口。

### 验收

- 同一回答先产生多段 delta、再提交全文，屏幕只有一个完整回答。
- 用户上翻查看旧消息时，新增输出不把阅读位置拉回底部。
- 模型一次返回 3 个工具调用，即使其中一个被拒绝，也显示 3 张独立卡片。
- 恢复后的消息与规范归档一致，不能只恢复 RunResult.text。

## 5. F04 — 六个工具怎样展示

六个工具由 Coding Agent C1 提供，P0 新增的是可解释的展示和交互，不重新实现工具。

| 工具 | 折叠标题 | 展开内容 | 完成/错误判断 |
| --- | --- | --- | --- |
| read_file | 相对路径、startLine、已读取/截断 | data.content；以 data.startLine 为起点显示行号；只展示实际返回范围 | ok=true 为已读取；data.truncated 显示“部分内容”；不存在等显示 code |
| list_files | glob 或“工作区”、返回条数 | data.paths，每行一个路径；truncated 明示更多结果未返回 | 不把返回条数说成全项目文件总数 |
| search | 字面 query、glob、命中数 | data.matches 中 path:line:text；截断提示 | 0 命中是正常结果，区别于读取失败 |
| edit_file | path、待执行/已修改/冲突 | 替换前 oldText、替换后 newText 的片段；每侧文字可查看 | ok=false/code=FILE_CONFLICT 等为业务失败；不能显示绿色“已修改” |
| create_file | path、待创建/已创建 | 新内容预览；目标父目录；不覆盖已有文件 | FILE_EXISTS 为未创建；只认规范工具结果与版本事实 |
| run_command | 完整命令摘要、运行时长、exitCode | shell、解析后的 cwd、stdout/stderr 分区、截断提示 | exitCode=0 为命令成功；非零为失败；Agent completed 不覆盖命令失败 |

### 数据来源与状态机

工具卡片状态：`planned → awaiting-approval（命令）→ running → succeeded / business-failed / denied / not-executed / unknown`。这些是 UI 私有状态，不是新的 core 枚举。

- `assistant message.commit` 中的 toolCalls 创建 planned 卡片，关联键为 **agentId + runId + assistantId + callId**。
- C1 authorizeTool 先准备计划、再调用 policy / approve，**批准之后 core 才发送 tool.start**。因此审批界面不能等 tool.start 再创建卡片；拒绝的调用可能从来没有 tool.start。
- policy 的固定 CodingAction 提供已经验证的参数与 preview。批准前的片段、命令、目录从这里取得，按完整键关联。
- `tool.start` 才切换为运行中；`command.output` 用当前活动调用将 runId + callId 绑定到完整键；C1 当前串行执行工具。
- `message.commit(role=toolResult)` 提供规范 content 和 execution。`tool.end` 没有 name，也不能单独证明业务成功。
- execution=succeeded 时仍需解析 C1 的 `{ok,data}` / `{ok:false,code,detail}`；非法/未知内容退化为转义文本并显示“无法解析结果”，不崩溃、不重新执行。

### 编辑预览的真实含义

C1 的 preview.diff 是受限的替换片段，不是带 hunk 的标准 unified diff，不能直接假定 OpenTUI Diff 组件能解析。P0 使用两块着色文本显示“替换前 / 替换后”，来源为本次验证后的 oldText/newText；总显示预算 16 KiB，超过时标记截断。create_file 展示前 16 KiB 内容。

重开会话时从归档 assistant.toolCalls 的参数恢复片段，作为只读数据处理；不读取今天的文件去假造当时的 diff。P0 不提供整个 Git 工作区变更面板，也不承诺撤销按钮。

### 验收

- 文件外部变化导致 FILE_CONFLICT：卡片明确“未修改”，实际文件不变。
- shell 命令返回非零：即使 core execution=succeeded，卡片显示失败并展示退出码。
- 两个 assistant 使用相同 callId，界面不会把结果写到另一张卡片。
- 拒绝的命令显示已拒绝，即使没有 tool.start；命令执行次数为 0。

## 6. F05 — 命令审批

P0 固定默认权限：read/search/edit/create 允许，command 询问，custom 拒绝。每次 run_command 都确认一次，无“以后都允许”、无权限规则 DSL。

审批面板展示：完整命令文本（含换行）、规范工作区 root、相对 cwd 及其解析结果、shell 名称、单次命令时间上限。命令较长时滚动查看，不只展示省略号摘要。终端控制字符以可见转义表示，不能执行 ANSI/OSC。

交互：左右键/Tab 选择“拒绝 / 允许本次”，默认焦点为拒绝；Enter 确认选择，Escape 拒绝此命令，Ctrl+C 取消整个 run。忽略上一焦点层遗留的按键重复，必须由本次面板内的新操作确认。普通输入字母不会直接触发允许。拒绝后 Agent 可以读取反馈并回答，UI 不替模型自动再请求相同命令。

内部审批桥接保存唯一 pending approval：完整调用键、action.digest、resolve、signal cleanup。创建 Promise 后立即监听 AbortSignal；决议只允许 settle 一次；取消/卸载时返回 deny 并清理监听。迟到的鼠标/键盘事件找不到活动审批后直接忽略，不能重新授权。

P0 将 CodingAgent 的运行总期限设为 **15 分钟**，覆盖模型、工具与人等待审批；工具单次仍受 Workspace **60 秒**上限约束。超时走现有 limited/取消路径，不默认为允许。UI 显示运行已用时间；等待审批时提示总期限仍在计时。

验收：批准前没有子进程；拒绝后没有子进程；审批中 Ctrl+C 后再按“允许”仍没有子进程；实际执行的 command/cwd 与批准的计划一致。读取、编辑不会错误地弹出命令审批面板。

## 7. F06 — 取消与退出

### 按键含义

| 当前现场 | Ctrl+C | /exit |
| --- | --- | --- |
| 空闲，有草稿 | 清空草稿；通过普通撤销可恢复 | 请求退出 |
| 空闲，草稿为空 | 请求退出 | 请求退出 |
| 模型/工具运行中 | agent.abort；切换“正在停止”，仍可阅读 | 先取消，再完成 drain 后退出 |
| 等待审批 | 拒绝 pending approval 并取消整个 run | 同左，之后退出 |
| cancelling | 设置退出意图，不强杀自己的工作区桥接进程 | 同左 |
| saving | 标记退出意图，等保存结果 | 同左 |
| unsaved | 打开保存处理面板 | 打开保存处理面板 |

普通关闭序列：禁止新提交 → settle 审批 → abort/await idle → 处理保存 → Agent.close → Session.close → Manager.close → Workspace.close → Store.close → renderer.destroy。每一步按持有资源执行；初始化失败按反向顺序清理已成功创建的对象。cleanup 异常不能跳过终端恢复。

不能以短暂超时为理由在工具仍运行时直接释放租约或 process.exit。停止超过 5 秒时显示“仍在等待命令退出”，5 秒只是反馈阈值。用户从 OS 强杀进程无法保证归档完成；下次按 persisted pending 处理。

保存失败的退出面板有三个动作：重试保存、返回会话、明确退出。默认“返回会话”。明确退出前说明“磁盘保留待核查标记，内存中的待保存结果将丢失”；仍先关闭 Agent/drain。P0 不删除 pending，不提供伪装成恢复的清空按钮。

若 Agent.close 已执行后才发现保存/清理错误，原 Agent 可能已经 closed，此时不能用“返回会话”让它继续执行；保留 Session 供 flush，保存成功后重新装配 Agent，失败则只读。取消任务本身不退出 CLI；正常退出返回 0，参数/启动失败返回 2，未保存或清理失败退出返回 1。这些是进程结束状态，不另建自动化结果协议。

验收：创建一个会派生子进程的测试命令，取消后父/子进程都结束，租约才释放，终端可以正常输入和显示光标。退出期间 Ctrl+C 连按不会触发重复 close 或绕过保存处理。

## 8. F07 — 自动保存与历史上下文

### 保存触发

第一条有效输入创建会话，标题取输入第一条非空行前 40 个可见字符，不请求模型生成标题。每轮使用新的 requestId；Session plugin 负责 pending CAS 与完整 turn commit。应用不另写一份 messages.json，也不把事件流当数据库。

Footer 分别显示运行与保存状态：运行中/执行结束/取消中，以及本轮未保存/正在保存/已保存/保存失败。**run.end 先于保存完成**。只有 session.saved 或检查到保存成功后，输入才允许提交下一轮。

SQLite 固定为 `~/.alphacode/sessions.sqlite`；每工作区书签位于 `~/.alphacode/workspaces/<workspace-hash>.json`。书签记录最后成功保存的 sessionId，以临时文件 + 替换写入。书签写失败只提示“最近会话记录未更新”，不能改写已保存 turn，也不能将工具执行判为失败。

### 上下文选择

完整归档保留在 Session；提供给下一轮模型的历史由 SessionManager.selectContext 选择完整连续后缀：最多 12 turns、最多 256 messages、`UTF8(JSON.stringify(messages))` 不超过 2 MiB，三者取先到者。为当前输入和输出留下 core 总预算的余量；一次 run 仍可能达到 core limits，应正常显示 limited。

从最新 turn 向前累计；不能拆开 assistant 与 toolResult，也不能跳过过大的最新 turn 后悄悄选更老的历史。最新完整 turn 单独超预算时，在下一轮准入前显示“最近一轮超出上下文窗口，请新建会话”，原归档可继续查看。超过窗口的历史在界面仍可看，Footer 明示“本轮使用最近 N 轮”，不伪装成自动摘要。

agentKey 绑定 coding preset/工具版本、固定系统指令、模型 adapter/endpoint/id；不含密钥。AGENTS.md 是可变项目上下文，由 C1 每次 Agent 初始化读取一次，恢复时提示已加载当前项目指令，不声称环境逐字复现。

### 验收

- 完成一轮后进程关闭再重开，用户、assistant、toolResult 与 RunResult 全部存在。
- 保存失败时显示原执行结果，但不接受下一轮输入。
- 超过 12 轮后只选完整后缀；归档轮数不减少，工具消息始终配对。
- 最新大 turn 不被静默丢弃；用户可读历史并手动新建会话。

## 9. F08 — 会话选择、恢复与重命名

### 会话选择器

`alphacode resume` 和 `/resume` 打开当前工作区的列表。每页 25 条，显示标题、短 ID、创建时间、更新时间、ready/pending/blocked。明确标注 **按创建时间排序**；现有 listSessions 不是按更新时间排序。

Up/Down 选择，Enter 打开，Escape 返回，加载更多按钮取下一页。搜索只过滤当前已加载条目的标题/ID，标签写“筛选已加载会话”，不把它说成全库搜索。归档读取期间显示加载状态，较旧请求返回时不覆盖用户后来选中的会话。

`resume --last` 读取本工作区最后保存书签。书签丢失或指向不存在会话时说明原因并进入选择器，不偷偷打开另一条。显式 ID 不存在则给出错误和返回列表动作。

### 切换规则

空闲且已保存时切换；运行中选择会话仅提示“先停止当前任务”，不暗中取消。unsaved 时禁止切换并提供重试保存。

切换顺序：保存当前内存草稿 → 关闭旧 Agent 释放 workspace 租约 → 关闭旧 Session handle → 读取目标 snapshot → 显示历史 → 对可继续且兼容的目标创建新 Agent。目标初始化失败保留只读历史及选择器，不让两个 Agent 同时占用工作区。

pending / blocked / agentKey 不兼容的会话可以只读打开，不创建 Agent。提供“返回列表 / 新建空会话”，但绝不复制待核查任务自动执行。用户主动新建是新的任务决策，不是修复旧记录。

`/new` 清空当前展示并进入未创建 Session 的欢迎态；直到下一条任务提交才落库。退出再打开普通 `alphacode` 默认新会话，只有 resume 才恢复旧会话。

### 重命名

`/rename <title>` 只在空闲且已保存时运行；标题 1–80 个可见字符。读当前 revision，调用既有 updateSession 的 expectedRevision。CAS 冲突时刷新当前标题并保留用户想改的名称让其再次确认，不盲目覆盖。命令本身不进入模型历史。

### 验收

- 两个工作区的列表互不混合；同一个目录的不同路径表示规范化到同一 namespace。
- 新建 B 后继续并保存 A，--last 恢复 A，尽管 B 创建得更晚。
- 切换前后最多一个活跃 Agent 租约；失败后仍能选其他会话或退出。
- pending 会话可读，但没有提交按钮或自动重试入口。

## 10. F09 — 故障是功能的一部分

| 故障 | 用户看见什么 | 可执行动作 | 不能做什么 |
| --- | --- | --- | --- |
| 模型网络/认证失败 | 区分认证、网络或运行失败；保留已提交历史与任务输入 | 查看配置说明；若 history ready 且已保存，可手动发新任务 | 宿主不自动重试整轮，不推测“没有副作用” |
| 文件业务冲突 | 工具卡片“未修改 · FILE_CONFLICT” | 模型可依现有 Loop 重新读取再提出修改 | UI 不进行 fuzzy replace 或绕过版本校验 |
| 命令非零退出 | 红色退出码、stderr/输出、截断标记 | 模型可判断失败原因继续；用户可取消 | 不因为 Agent completed 把失败测试标成通过 |
| STORE_UNAVAILABLE + unsaved candidate | 执行结果保留；“保存失败”；禁止下一轮 | `/retry-save` 调 session.flush | 不再 prompt、不增加模型/工具调用 |
| COMMIT_CONFLICT | 保存存在并发冲突，需要核查 | 保留内存候选；可检查会话，flush 仍遵守 CAS | 不删除 pending 或强制覆盖数据库 |
| 重启后 pending | “上次任务状态待核查”与 requestId/startedAt | 只读历史，人工核对实际文件/命令；退出或手动新建 | 没有 candidate，不能把 flush 当恢复执行 |
| outcome_unknown / history blocked | “操作结果未知，已停止继续” | 查看已知结果与相关路径/命令 | 不自动重跑，不隐藏 blocked |
| 边界/观察异常 | “界面或保存协调失败”，保留规范结果 | 停止新输入、请求取消并 drain，输出诊断 | 不在 observer 中同步重入 prompt/close |

存储重试按钮同一时刻只能有一个 flush；失败仍保留按钮和原因。重试成功后回到正常空闲，不再次绘制一份重复对话。

只对确定已提交的同 requestId、同 input 请求使用 S2 幂等重放；本版没有用户手填 requestId 的命令。恢复既有记录不需要重新 prompt。如果内部恢复流程遇到重放，显示原 snapshot，因为该路径没有新的模型/工具事件，也不保证 Agent.state 自动包含原消息。

异常文案优先说明现场与下一步，技术 code 放在可展开详情；不把堆栈、密钥或整个环境输出到 transcript。P0 不新增遥测上传。

验收：注入保存失败后多次 flush，模型与工具计数都不变；持久 pending 重启后输入禁止；未知写入结果不能通过新 requestId 在原会话继续。

## 11. F10 — 终端、焦点和资源预算

### 组件落点

```text
App
  Header                         项目 / 模型 / 会话
  Transcript (ScrollBox)
    UserMessage
    AssistantMessage (Markdown)
    ToolCard → Text / Code / 片段视图
    RunSummary / SaveNotice
  Composer (Textarea)
  StatusBar
  Overlay                        只允许一个独占输入层
    ApprovalPanel / SessionPicker / Help / ExitDecision
```

焦点优先级：退出决定 > 审批 > 选择器/帮助 > Transcript/Composer。打开面板记录原焦点和草稿，关闭后恢复；面板不会吞掉 Ctrl+C。`Tab` 的行为取决于当前焦点层，不把按键同时广播给两个组件。

P0 快捷键：Enter 提交/确认；Ctrl+J 换行；Tab 切换焦点；Alt+Up/Down 输入历史；Transcript 的 PageUp/PageDown 翻页、End 回到底部、Enter 展开；Escape 关闭普通面板或拒绝审批；Ctrl+C 按 F06；F1 帮助。代码/长命令横向阅读由详情区处理，不能截掉实际审批内容。

### 资源预算（实施验收目标，尚未测量）

| 对象 | P0 约束 |
| --- | --- |
| 输入 | 64 KiB UTF-8；不截断提交 |
| 流式回答 | 每 33ms 合并一次；单模型输出受 core 默认 1 MiB 约束 |
| 工具输出 | 复用 C1 受限结果；每个命令 UI 临时缓冲最多 48 KiB，保留尾部并标记截断 |
| 展示列表 | 初始/活动窗口最多 200 个消息块；折叠工具内容不挂载大型文本组件 |
| UI 事件缓存 | 可替换的 delta 合并；总量上限 1 MiB；提交/终态不能静默丢弃 |
| 长历史 | Session getSnapshot 仍整份读取；按窗口挂载，不把全归档深拷贝进响应式 store |
| 运行预算 | 24 次模型 / 64 次工具 / 15 分钟；命令单次最多 60 秒 |

UI 缓冲异常时将处理安排到事件回调之后：停止新提交、请求 abort、drain、从公开规范消息重新建立视图并显示故障。恢复不了时进入可退出的错误界面，不能继续显示虚假的运行成功。

模型、文件和命令输出经统一文本清理：允许正常换行/制表符，其他终端控制序列转义；不能执行 OSC 设置标题、剪贴板或 hyperlink 控制。中文、emoji、组合字符按终端显示列处理，不按 string.length 截列。

### 实测验收

Windows Terminal 中覆盖 120×40、80×24、60×18 与更小窗口；中文输入法、emoji、多行粘贴、边输入边输出、上下滚动、审批焦点、取消和退出。采用 30 次/秒 delta 的离线夹具，输入反馈 P95 目标 <100ms，记录机器和测量方法；不能用浏览器原型证明终端性能。

OpenTUI 官方提供 Textarea、ScrollBox 和 Markdown 组件，本项目据其能力落地上述交互；具体属性与版本在启动验证任务中锁定。[Textarea](https://opentui.com/docs/components/textarea/)、[ScrollBox](https://opentui.com/docs/components/scrollbox/)、[Markdown](https://opentui.com/docs/components/markdown/)

## 12. Slash 命令的确切范围

| 命令 | 行为 | 前置条件 |
| --- | --- | --- |
| /help | 显示按键、七个命令、六工具说明 | 随时；不覆盖正在等待的审批焦点 |
| /new | 关闭当前已保存会话，回到新会话欢迎态 | idle + saved；草稿按当前会话保留在内存 |
| /resume | 打开当前工作区会话选择器 | idle + saved；readonly 会话也允许 |
| /rename 名称 | CAS 更新标题 | 当前有 Session，idle + saved |
| /status | 展示 cwd、模型、session ID、运行/保存/历史状态、上下文轮数、isolation:none | 随时只读 |
| /retry-save | 只重试当前内存 candidate 的保存 | unsaved；无 candidate 时解释原因 |
| /exit | 执行退出协调 | 所有状态；按 F06 处理 |

输入以 `/` 开头时显示匹配命令提示，Tab 补全命令名；提交精确命令由宿主消费，不发送给模型。未知命令提示可用命令并保留输入。以 `//` 开头时去掉一个 `/` 后作为普通任务文本发送，使用户可以表达以斜杠开头的内容。命令检查遵循状态，不因为从命令行输入就绕过按钮的禁用规则。

## 13. 内部工程分工：不作为 API 暴露

```text
apps/alphacode/
  src/bin.ts                  参数、原始 cwd、help/version、启动入口
  src/config.ts               固定 home 路径、YAML 模板/解析/校验、Provider 选择
  src/runtime.ts              资源 owner、Agent/Session、切换/退出、静态 commands 与前置条件
  src/approval.ts             一次性审批 Promise 与取消清理
  src/session-state.ts        标题、上下文选择、书签、选择器数据
  src/projection.ts           规范消息 → UI；delta/工具/保存状态关联
  src/text.ts                 控制字符处理、可见宽度与片段截断
  src/app.tsx                 Solid 界面、单面板焦点、输入与阅读窗口
  src/main.tsx                原生 renderer 装配、信号与退出清理
  test/                      离线夹具、宿主流程、组件、子进程验收
```

这不是要求每个文件导出一个服务类。局部函数按职责组织，有状态创建函数沿用 createX 命名；静态命令/策略保持普通对象。**package 不设置用于消费的 exports，只有 bin；不提供应用工厂的 SDK 声明。**

内部唯一执行点仍是现有 `agent.prompt`。runtime 创建 Session 并通过 `createSessionPlugin({session})` 注入现有 createCodingAgent；Provider 的 LanguageModel 直接传入。UI 不直接写数据库、不直接启动 PowerShell、不维护第二份业务历史。Coding 和 Session 不互相依赖。

UI store 只保留 active IDs、草稿、焦点、临时流文本、工具展示索引、视图窗口、审批与退出意图；Agent.state / Session snapshot 才是运行与归档事实。所有跨回调的对象都按 run/session generation 验证，已切换会话的迟到回调不得更新当前屏幕。

未来 app server 规划时，复用现有 ADK/Coding/Session 能力，并根据服务端需求重新定义请求、事件和生命周期；不提前把 TUI store 或私有 runtime 序列化为外部协议。

## 14. 状态与动作判定

| UI 状态 | 提交任务 | 编辑草稿 | /new /resume | /retry-save | 取消/退出 |
| --- | --- | --- | --- | --- | --- |
| welcome / idle saved | 允许 | 允许 | 允许 | 无需 | 允许 |
| submitting / running | 禁止 | 允许 | 提示先停止 | 禁止 | 取消/drain |
| awaiting approval | 禁止 | 草稿保留，焦点独占 | 禁止 | 禁止 | 拒绝或取消 |
| cancelling | 禁止 | 允许 | 禁止 | 禁止 | 设置退出意图 |
| saving | 禁止 | 允许 | 禁止 | 等保存返回 | 设置退出意图 |
| unsaved | 禁止 | 允许 | 禁止 | 允许一次 | 保存处理面板 |
| readonly pending/blocked/mismatch | 禁止 | 仅可准备新会话草稿 | 允许手动新建/返回列表 | 无 candidate 不允许 | 允许 |
| closing / fatal | 禁止 | 不接受新编辑 | 禁止 | 按退出分支 | 等清理/错误退出 |

这些是由底层事实推导的界面状态。优先级：closing/fatal > readonly异常 > unsaved > saving > cancelling > approval > running/submitting > idle。UI 不因一次 run.end 把所有状态重置成 idle。

不能仅凭 Session.historyStatus=pending 判定“需要恢复”：当前进程正在执行、拥有本次 request 的 pending 属于正常忙碌；本进程有 candidate 的 unsaved 可以 flush；重启后没有活动 owner/candidate 的持久 pending 才进入只读待核查。投影时必须同时检查当前 invocation、Session.status 与加载来源。

## 15. 实施顺序与完成标准

### G0：运行时验证，只解决能不能组合

用户已确定 OpenTUI + SolidJS。已验证 Windows x64 单进程组合：Node 26.13.0、OpenTUI Core/Solid 0.8.2、SolidJS 1.9.18、better-sqlite3 13.0.3；ESM + FFI + Solid universal transform。SQLite 使用包内 N-API 预编译文件；pnpm 9 针对该包禁用冗余原生编译。原生渲染、SQLite CAS/重开、Workspace 进程树取消和 PTY raw mode 恢复已实测，真实输入法选字仍待人工验收。[运行时要求](https://opentui.com/docs/getting-started/runtime-support/)、[Solid 编译](https://opentui.com/docs/bindings/solid/)

G0 产物必须是本机可运行的最小终端程序及验证记录：输入一行中文 → 渲染 → SQLite 写入重开 → 启动/取消一个子进程树 → 销毁 renderer。精确锁定实际已发布的依赖版本。通过后再做业务 UI；失败先修订运行时方案，不默认引入 app server 或双进程 RPC 来绕开。

### 主线顺序

G0 → F01 启动 → F02/F03 可输入对话 → F04/F05 可执行工具 → F06 可安全停止 → F07/F08 可保存恢复 → F09 故障闭环 → F10 终端验收。具体任务见 TODO；不把“搭骨架”当作用户功能完成。

### P0 Release Gate

1. 临时项目真实闭环：失败测试 → Agent 阅读 → 精确编辑 → 用户批准命令 → 测试结果 → 完整归档 → 退出 → resume → 有历史的下一轮。
2. 取消闭环：命令产生子进程后取消，确认无遗留进程、无提前释放租约、终端可继续使用。
3. 保存故障闭环：执行计数固定，存储失败、flush 重试、恢复成功不增加任何模型/工具调用。
4. 重启 pending / blocked：只能查看，不自动重放副作用。
5. 输入与阅读：中文/粘贴不误提交，重复 Enter 不重复执行，阅读旧消息不被流式输出强拉。
6. 产物运行：从项目外路径启动仍尊重 cwd；私有包仅 bin；没有对外 SDK、JSONL 或服务器入口。

离线夹具覆盖上述异常与确定性流程。真实模型只在用户已授权的 `http://127.0.0.1:3425/v1`、`codex/gpt-6.1-sol` 上显式执行小型临时项目探针，不用真实 API 代替日常测试。

## 16. 借鉴如何落到 P0 功能

| 来源 | 本次保留的具体借鉴 | 落点 |
| --- | --- | --- |
| Codex 的 harness / 界面分工 | UI 使用已有执行能力，公开服务协议单独规划 | F01、F06、内部工程边界 |
| Claude Code 的动作审批与工具反馈 | 审批时展示实际命令和目录；命令结果与模型回答分开 | F04、F05、F09 |
| Pi 的 transcript/editor/footer 与单 renderer | 少数固定区域、工具详情折叠、所有面板共享焦点 | F02、F03、F08、F10 |

事实来源：[Codex harness](https://developers.openai.com/blog/codex-as-a-platform)、[Claude Code permissions](https://code.claude.com/docs/en/permissions)、[Pi terminal](https://pi.dev/docs/latest/usage)、[Pi UI](https://pi.dev/docs/latest/tui)。以上是公开资料与本项目取舍；本规格没有声称复制其全部功能或掌握 Claude Code 私有实现。

## 17. 当前交付与证据

`apps/alphacode` 已包含私有 CLI、Solid 界面、配置、投影、审批与资源 owner。现有 core、Session 与 Coding 执行语义不变；Provider 增加 `{value}` 直接凭证，未经过环境变量中转。根脚本为 `pnpm alphacode`，启动参数通过 Node `--` 分隔，防止 `--env-file` 被运行时提前消费。

应用自动化测试覆盖真实 Windows 文件与命令、进程树取消、SQLite、保存故障、只读恢复、分页与书签、原生组件和 30 Hz 输入反馈；真实本地模型已完成修复与关闭重开。命令与原始结果见 [验收记录](alphacode-p0-validation.md)。

HTML 仍为离线交互评审文档，流程演练中的计数是模拟，不连接模型、数据库或终端。代码实施状态由 TODO 记录；T01、T06 中涉及真实终端人工操作的部分与 T24 尚未全部验收，P0 发布门槛保持未全通过。不得将浏览器或原生注入测试描述为 Windows 输入法的实测结果。
