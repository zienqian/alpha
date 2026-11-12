# AlphaCode

OpenTUI + React 终端编程 Agent。当前提供用户输入、Markdown 流式回复、多轮对话、简短工具状态与命令确认。应用界面、状态提示、错误信息和 CLI 帮助统一使用英文；模型根据用户请求和指令选择回复语言。

## 运行

使用 Bun 1.4.4；命令自动选择系统可用的 Shell，列表与搜索需要 ripgrep。从仓库根目录执行：

```powershell
bun install --frozen-lockfile
# 首次使用且尚无 .env.local 时：
Copy-Item .env.example .env.local
bun run dev
```

`bun run dev` 直接运行应用和基础包源码，并监听 TUI 变化自动重启，无需预先 build。构建产物仍可通过 `bun run build` 后执行 `bun run start` 体验。启动器通过绝对路径读取仓库的 `.env.local` 和 TUI 配置，保持调用者当前目录。终端环境变量优先于 `.env.local`，两者都覆盖全局 YAML 默认配置。

## 本地 Server 与 Web

同一会话运行中可继续按 Enter 提交下一条消息，服务端按顺序排队，等待前一轮运行与保存完成后自动发送。TUI 显示排队数量与前三条预览，Web 可查看和逐条移除队列；两端共享队列，刷新网页或断开客户端后仍保留。Esc/Ctrl+C 只停止当前回复，队列继续；完整关闭服务端会中断未执行消息，不在重启后自动重跑。

启动 `alphacode` 会自动启动或复用同一会话数据库的本地 server，终端连接到 server 持有的会话。无需手动启动 daemon，不安装系统服务、不配置开机自启。默认仍直接进入 TUI，不启动浏览器或构建 Web。

- 在终端输入 `/web`，才构建（若缺少产物）、启用并打开 WebUI。浏览器进入**当前同一个 session**，不会另开 Agent。也可先执行根目录 `bun run build:web`。
- 多个项目只要使用同一个 `ALPHACODE_DB`，就复用同一 server。Web 左侧列出该数据库里已登记项目的当前及历史会话，右侧查看消息和工具记录。登记发生在 CLI 打开项目时。Web 支持新建、发送、停止生成及工具审批；附件上传和权限模式选择尚未接入 Web UI。
- CLI 和 Web 使用同一 SSE 全量快照同步；Web 列表和断线历史保留 15 秒兜底刷新。通过 `/web` 打开当前会话后，任一端发起的对话会同步显示在另一端。相同会话一次只执行一个请求，审批绑定 request ID 和一次性 approval ID。
- 退出终端或关闭网页只断开客户端，**不取消任务**。仍在执行、等待审批或结果未保存时 server 保持运行。没有客户端、请求或未保存状态后，空闲 60 秒自动退出。需要停止任务时在 CLI 中按 Esc/Ctrl+C。
- 默认只监听 `127.0.0.1` 随机端口。`/web` 直接打开 `/?session=<sessionId>`，无需授权码、登录 cookie 或独立 CSRF token，可刷新和重复打开。保留 Host、同源 Origin、JSON 请求校验及跨站拒绝；登记项目和启用 Web 仍需要原生 bearer token。此模式信任本机进程，不隔离同机其他用户或进程，不适用于局域网或公网开放。密钥不写入 URL、项目索引或浏览器存储。

SQLite 旁的 `.sessions.db.server/`（名称随数据库文件名变化）保存 `server.json`、进程租约、项目索引、请求去重回执和诊断日志。该目录是本用户的私有控制数据，不要共享、提交或在服务运行时删除。不同数据库互相隔离。

新会话先作为内存草稿存在，用户发送第一条有效消息时才保存 Session 并进入历史列表。只启动后退出、开发模式重启、修改草稿权限或查看 `/skills` 不会留下空会话。草稿仍可通过 `/web` 在 CLI 和 Web 间共享；server 退出后未发送消息的草稿会消失。首次发送前设置的权限会随首条消息保存。

当前范围是本用户、当前数据库、已登记的 AlphaCode 项目；不会扫描其他软件的 session，也不会接管升级前仍在运行的旧版 CLI。旧会话所在项目需要用新 CLI 打开一次才能出现在全局列表。后台每 3 秒检查应用与基础包代码、依赖和 Web 构建变化，稳定后等生成、审批和保存完成再自动切换，保留地址、会话、内存草稿和凭据；切换失败回退旧版本。Web 源码修改后仍需执行 `bun run build:web`，页面随后提示保留文字草稿并刷新。页面入口与后台版本绑定，避免新 UI 请求旧 API。协议、更新管理器自身和运行环境升级需完整重启。

连接不支持自动更新的旧后台时，只要协议兼容就允许正常进入 CLI，不要求关闭其他客户端。自动更新机制在后台下一次正常退出并重新启动后生效；旧后台缺少的新接口由对应功能页面提示。完成迁移后，普通代码更新无需反复关页面等待退出。

server 异常退出后，重新启动 CLI 可恢复已提交历史；端口变化时重新 `/web` 打开新地址，不需要授权。协议升级后关闭旧客户端，待任务完成且旧 server 空闲退出再启动，并重新构建 Web。未确认完成的请求不会自动重试，有未完成工具副作用的会话仍由 Session 层阻止继续执行。首版没有远程访问、事件日志回放、分页虚拟列表或人工恢复面板。服务现已拆为独立业务应用 `apps/alphacode-app-server`，CLI 通过公开客户端入口连接。API 与一致性约定见 [服务协议](../alphacode-app-server/src/server/README.md)，独立启动方式见 [App Server](../alphacode-app-server/README.md)。

## 全局配置目录

默认使用用户主目录的 `~/.alphacode`（Windows 为 `%USERPROFILE%\.alphacode`）：

```text
~/.alphacode/
  config.yaml    # 模型、服务端点、认证方式、默认权限和会话数据库路径
  AGENTS.md      # 所有项目共用的 Agent 指令
  sessions.db    # 默认会话数据库
```

首次启动自动创建目录、带注释的 `config.yaml` 模板和空的 `AGENTS.md`；已有文件不会被覆盖。使用 `ALPHACODE_HOME` 可切换整个全局配置目录，也会改变默认数据库位置。目录支持 `~`，相对路径基于启动目录。

`config.yaml` 示例（将模型 ID 改为服务端支持的值）：

```yaml
provider:
  adapter: openai-completions
  options:
    baseURL: https://api.openai.com/v1
    apiKey:
      env: OPENAI_API_KEY
      # 无认证服务使用 apiKey: { none: true }
model:
  id: your-model-id
permissionMode: ask # ask / auto / full
databasePath: sessions.db
```

当前支持 `openai-completions` 适配器；`apiKey` 使用环境变量名或 `{ none: true }`，不在 YAML 中填写实际密钥。`databasePath` 的相对路径基于配置目录，`ALPHACODE_DB` 的相对路径仍基于启动目录；两者都支持 `~`。空文件和注释文件表示使用默认配置。无效字段、重复键、错误类型或 YAML 格式会在启动时明确报错。

新会话配置优先级为：**环境变量 → 全局 config.yaml → 内置默认值**。恢复已有会话时，使用该会话保存的模型和权限；`/permission` 只修改当前 session，不改写全局配置。

`AGENTS.md` 使用普通 Markdown 编写全局偏好。每次启动读取一次，和项目根目录 `AGENTS.md` 一起传给模型；更具体的项目指令与当前用户请求优先。这些指令不作为聊天消息写入 session，也不会修改程序的权限策略。修改后重启生效。配置文件上限 64 KiB，全局指令上限 32 KiB，均使用 UTF-8。

复用现有模型配置：

- `ADK_MODEL`：覆盖全局 `model.id`；两者至少配置一项。
- `ADK_BASE_URL`：Chat Completions 兼容端点，默认 `https://api.openai.com/v1`。
- `ADK_AUTH=none`：显式使用无认证端点；`ADK_AUTH=api_key` 显式启用密钥认证。
- `ADK_API_KEY_ENV`：凭证环境变量名，默认 `OPENAI_API_KEY`，实际凭证也需配置。
- `ALPHACODE_HOME`：可选全局配置目录，默认 `~/.alphacode`。
- `ALPHACODE_PERMISSION`：新会话的默认权限，`ask` / `auto` / `full`，覆盖 YAML 的 `permissionMode`。
- `ALPHACODE_DB`：可选 SQLite 路径，覆盖 YAML 的 `databasePath`，默认全局配置目录下的 `sessions.db`。
- `ALPHACODE_SESSION`：可选，恢复当前工作区下的指定 session ID；未指定时创建新会话。恢复时使用会话保存的模型 ID 和权限模式，`ADK_MODEL` 作为新会话的默认模型。

根目录的 `dev` / `start` 默认以仓库根目录为工作区。指定其他工作区：

```powershell
bun run --cwd apps/alphacode start C:/path/to/project
```

直接在应用目录运行时，可传入一个工作区路径，或设置 `ALPHACODE_WORKSPACE`；未指定则使用当前目录。路径参数优先于环境变量。

输入框下方显示模型、工作区和已有会话标题。用户目录及其子目录缩写为 `~` / `~/...`，其他路径保持原样；只改变展示，不改变实际工作区。底栏不再展示权限模式，仍可通过 `/permission` 查看和修改权限。首次发送有效消息后异步生成标题；未生成、生成失败或超时时统一兜底显示“新对话”（英文界面为“New conversation”），不使用首条消息摘要。恢复会话展示已保存的标题。

## Skills

在 `<workspace>/.alphacode/skills/review/SKILL.md` 或 `<ALPHACODE_HOME>/skills/review/SKILL.md` 创建：

```markdown
---
name: review
description: 审查改动的正确性、回归风险和测试缺口。
argument-hint: "[审查范围]"
---

阅读相关实现和测试，按严重程度报告问题；未获要求不要修改代码。
```

个人原生目录默认可信；**项目目录必须在全局 `config.yaml` 中显式信任**，即使会话使用 Full access 也不会自动信任：

```yaml
skills:
  sharedDirectories: true
  claudeDirectories: false
  trustedProjects:
    - 'C:\Users\you\project'
  disabledNames: []
```

信任按真实工作目录精确匹配，不包含其子项目。搜索优先级：项目 `.alphacode/skills` → 项目 `.agents/skills` → 项目 `.claude/skills` → 个人配置目录 `skills` → `~/.agents/skills` → `~/.claude/skills`。共享目录默认开启，Claude 兼容默认关闭；均仅扫描直接子目录。

- `/skills` 本地查看目录和诊断，不调用模型；`/review 原始参数` 显式读取完整正文后交给模型。命令名之后第一个空白是分隔符，其余参数空白与内容原样保留，不执行 Shell 展开或插值。
- 普通请求由模型根据摘要选择 `readSkill({ name: "review" })`。`disable-model-invocation: true` 表示仅手动；`user-invocable: false` 表示仅模型可选。
- `/` 看板补全可手动调用的 Skill；`//` 转义普通斜线输入。未知命令本地报错，不发送模型。
- Web 侧栏「Skills 市场」可查看本地/共享目录、搜索及筛选 Skills，并通过 ZIP、公开 GitHub / skills.sh 链接或 HTTPS ZIP / SKILL.md 直链安装；默认存入个人目录，也可选择已启用的项目或共享目录。安装不覆盖同名目录，新建会话时加载，已有会话不热更新。完整使用说明见 [Web README](../alphacode-web/README.md#skills-市场)。
- 修改文件后创建新会话或重启加载；当前 Agent 读取发现 revision 改变则拒绝，不使用缓存正文，也没有 `/skills refresh`。
- 手动输入归档完整正文、版本、路径和原始参数；恢复界面显示原始命令，继续对话使用已归档内容，不重读旧文件。禁用 Skill 不会清除已经进入上下文的内容，需清空上下文时创建新会话。
- Skills 始终启用，不提供 `skills.enabled` 总开关；已有配置应移除此字段。新会话使用 `alphacode-v2` 标识；恢复旧 `alphacode-v1` 会话时保留原标识，同样加载 Skills 并提供 `readSkill`。Session 格式和模型/权限元数据不变。

Skills 不增加工具权限，模型读取不执行安装或脚本，不支持 hooks/subagent 语义。Skill 文件上限 32 KiB，手动参数 8 KiB，最终输入 48 KiB；模型读取每轮最多 8 次，成功结果累计 128 KiB。完整正文超预算会失败而非截断；Skills 本身拒绝 symlink/junction，普通文件工具的 host 访问行为不变。

## 在其他项目中使用最新开发版

在 Alpha 仓库根目录执行一次：

```powershell
bun install
bun run link:dev
```

它使用 `bun link` 将包的 `alphacode` 命令链接到本地仓库（Windows 由 Bun 创建命令启动器）。以后在任意终端、任意项目目录运行：

```powershell
cd C:\path\to\your-project
alphacode
```

也可以直接执行 `alphacode C:/path/to/your-project`。无需在目标项目中安装 AlphaCode，也不会修改目标项目的 package.json。

`alphacode` 每次启动都加载当前仓库源码，改动 TUI、ADK、Provider、Session、Coding Agent 后退出重开即可，无需重新 build 或 link。`alphacode --watch` 会在已加载的源码变化时自动重启；重启会创建新会话，因此日常体验推荐普通 `alphacode`。新增或升级依赖后，在 Alpha 仓库执行 `bun install`。

Windows 如果当前终端尚未刷新 PATH，可以重新打开终端，或执行：

```powershell
$env:Path = "$HOME\.bun\bin;$env:Path"
alphacode
```

`alphacode --help` 查看用法，`alphacode --version` 查看版本。取消本地链接：`bun unlink --cwd apps/alphacode`（在仓库根目录执行）。仓库移动后重新运行 `bun run link:dev`。

开发启动器使用 `--conditions=alpha-source` 选择基础包的源码导出；正常构建、测试和消费者继续使用 dist 导出。源码更新在下一次启动生效，不会在正在进行的任务中途替换模块。

## 交互

- 输入框始终固定在终端底部，默认一行，随自动折行或手动换行向上增高；最多显示六行，且不超过终端高度的四分之一，超出后在输入区内滚动。下面显示 `模型名 · 工作目录 · 当前权限`，权限随 `/permission` 切换更新；窄窗口截断长内容，权限简写为 `Ask` / `Auto` / `Full`。对话在上方独立滚动。
- `Enter` 发送；`Ctrl+J` 或终端支持的 `Shift+Enter` 换行；支持粘贴多行。
- 回复增量显示 Markdown，包括列表、代码块和表格；滚动区跟随底部，可用鼠标回看。
- 工具记录按调用顺序平铺，直接显示命令或路径、目的描述、执行状态和有界输出预览，不折叠任务。退出码非零、业务失败、拒绝与结果未确认分别显示。工具记录随对话跨轮保留，恢复会话时按原始顺序恢复所有轮次的调用与结果；CLI 和 Web 的会话快照包含同样的完整步骤。完整工具历史仍保存在 Session 中，继续参与模型上下文。
- 输入框正上方靠左显示圆圈与无限符号的变形动画、活动状态和 `(耗时 · esc to interrupt)`，窄窗口保留耗时、隐藏快捷键提示。图标使用相同的贝塞尔路径按 `circle → ∞ → reversed circle → ∞ → circle` 五秒循环，支持 Kitty / Sixel 图形协议时绘制抗锯齿曲线，否则用单行 Braille 点阵近似。状态文字每两秒扫光一次；等待审批时静止，完成后移除。`ALPHACODE_REDUCED_MOTION=1` 或 `TERM=dumb` 关闭动画，`NO_COLOR` 关闭文字扫光、图标使用无颜色点阵动画。
- VS Code 集成终端需要开启 `terminal.integrated.enableImages`，并使用 GPU 渲染（`terminal.integrated.gpuAcceleration` 不为 `off`），重建终端后生效。应用针对 VS Code 修正 Kitty 图片图层，避免曲线被文字背景盖住；其他终端保持原生输出。
- 用户消息使用整行浅色背景，回复下方显示 `Worked for 11s · 19:47`；取消或失败使用相应状态。只展示最新一轮耗时，下一轮开始时清除。执行时长仍随每轮历史保存，恢复会话仅显示最新一轮的耗时，旧记录缺少耗时则不补造。
- 界面提示和命令描述兜底使用英文，新生成的命令描述也要求英文。运行中、工具记录和完成提示共用耗时格式：`11s`、`1m 5s`、`1h 2m`、`2d 3h`；跨单位后保留相邻两级单位。
- `run_command` 可携带模型与命令同时生成的 `description`，完整调用提交后、执行前即可显示；缺失时按工具名和参数生成说明，不额外调用模型。当前展示最终返回的输出，运行中不实时滚动 stdout。
- 一次执行一个任务；生成期间可编辑下一条输入，结束后发送。
- `Esc` 停止当前执行。运行时 `Ctrl+C` 也会停止，空闲时 `Ctrl+C` 保存并退出。
- 命令执行前显示 shell、目录与命令，按 `y` 允许本次执行，`n` 拒绝。读取、搜索、编辑和创建沿用 Coding Agent 默认策略。
- 输入 `/` 打开命令看板，`/permission` 选择 Ask for approval、Approve for me 或 Full access。权限按会话保存，保存成功后才生效；任务执行和设置保存期间不能切换。当前 Approve for me 只自动批准内置规则识别的完整常规命令，其余询问用户；独立模型审查尚未接入。
- 开发模式关闭界面后若 Bun 仍在监听，再按一次 `Ctrl+C` 结束监听。

流中断或取消后保留未完成的预览；实际对话历史由 ADK 管理。每轮等待 Session 保存后才允许发送下一条。保存失败和执行状态不明会显示错误；退出时会补写保存，保存仍失败则保留界面供再次退出重试。

AlphaCode 不设置整轮执行期限、模型/工具调用次数上限、命令执行超时或内存历史消息的条数/字节上限。命令中的 `timeoutMs` 参数不触发定时终止；仍可用 `Esc` / `Ctrl+C` 取消。模型服务的上下文容量、Session 归档容量及单次工具结果大小仍由对应模块约束。

文件工具支持绝对路径、相对路径、`../` 和符号链接，按当前进程权限访问文件；`list_files` / `search` 可用 `path` 指定搜索目录，并跟随链接。读取结果使用真实绝对路径，使通过不同路径访问同一个文件时仍能进行版本校验。

默认每次启动创建新会话，已完成轮次归档到 SQLite。模型 ID 和权限模式保存在同一条会话记录的 `metadata.alphacode` 中，包含配置版本；权限切换立即写入，即使还没有发送消息也会保存。不同会话互不影响。端点和认证方式由全局配置及环境变量提供，实际密钥仍从环境读取。

通过 `ALPHACODE_SESSION` 恢复时，对话、模型和权限一起恢复；历史会话未保存配置时，从原有 `agentKey` 恢复模型，权限默认为 Ask for approval，并补写配置。损坏或不支持的配置会阻止恢复。本版尚无历史会话选择界面或会话内模型切换命令。文件和命令权限沿用当前用户。

## 结构与验证

- `src/index.tsx` / `src/application.ts`：启动入口和依赖组装，将具体运行时注入对话控制器，再交给终端界面。
- `src/config.ts`：合并全局默认值、环境配置和工作目录；`src/global-config.ts`：初始化配置目录，读取并验证 YAML 和全局指令；`src/errors.ts`：配置错误与可展示的错误代码。
- `src/chat/contracts.ts`：Chat、消息、审批以及 ChatRuntime 接口，不依赖 UI、Provider、Agent 或 SQLite。
- `src/chat/controller.ts`：发送、取消、关闭和保存状态；`messages.ts`：纯函数更新消息；`approval.ts`：单次审批与取消。
- `src/runtime/`：组装 Provider、Coding Agent 和 Session SQLite，将 ADK 事件转为对话事件，管理保存与关闭顺序。
- `src/ui/app.tsx`：订阅 Chat 状态并组合布局；`components/`：欢迎页、输入框、消息列表、审批面板；`theme.ts`：配色与 Markdown 样式。
- `src/ui/keyboard.ts` / `src/ui/terminal.tsx`：快捷键、终端生命周期和进程信号。
- `scripts/build.ts`：使用 Bun 原生 automatic JSX 转换和 `@opentui/react` 构建；产物需 Bun 与已安装依赖。
- `bin/alphacode.ts`：跨目录的开发版命令入口，指定源码条件、仓库配置和 React JSX tsconfig，保持 cwd 并等待 TUI 退出；源码和构建产物均无需额外 preload。

依赖关系：`UI → Chat 接口`，`对话控制器 → ChatRuntime 接口`，`具体运行时实现 ChatRuntime`。只有 `application.ts` 负责把实现连接起来。UI 通过 React `useSyncExternalStore` 订阅 Chat 快照，不读取 Agent 或数据库；对话模块不创建运行时，也不依赖 React/OpenTUI。ESLint 检查这些边界。扩展界面组件、调整对话策略或更换运行时，可以在各自模块内完成。

```powershell
bun run build
bun run typecheck
bun run lint
bun run test
```

AlphaCode 测试使用离线 SSE 夹具驱动真实 Provider、ADK、Coding Agent 和临时 SQLite，并用 OpenTUI 测试渲染器检查输入与增量显示；普通测试不会请求真实模型。

工程使用 OpenTUI Core/React 0.8.1 和 React 19.3.1，组件通过 `@opentui/react` 的 `createRoot` 挂载。Markdown 行为参考 [OpenTUI 文档](https://opentui.com/docs/components/markdown/)。


## 界面语言

CLI/TUI 支持简体中文与英文，默认跟随系统：`alphacode --lang zh-CN` 或 `alphacode --lang en`。也可设置 `ALPHACODE_LANG`，或在 `~/.alphacode/config.yaml` 设置 `language: system` / `en` / `zh-CN`。命令行优先于环境变量，环境变量优先于配置；`system` 使用系统语言。`alphacode --help --lang zh-CN` 可在未配置模型时查看帮助。

Web 在侧栏底部选择界面语言，保存在当前浏览器。CLI 与 Web 可为同一会话选择不同语言，模型回复和消息正文保持原文。实现与词典维护流程见 [国际化设计](../../docs/alphacode-i18n-technical-design.md)。
