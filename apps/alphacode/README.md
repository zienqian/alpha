# AlphaCode

OpenTUI + SolidJS 终端编程 Agent。当前提供用户输入、Markdown 流式回复、多轮对话、简短工具状态与命令确认。应用界面、状态提示、错误信息和 CLI 帮助统一使用英文；模型根据用户请求和指令选择回复语言。

## 运行

使用 Bun 1.4.4；命令自动选择系统可用的 Shell，列表与搜索需要 ripgrep。从仓库根目录执行：

```powershell
bun install --frozen-lockfile
# 首次使用且尚无 .env.local 时：
Copy-Item .env.example .env.local
bun run dev
```

`bun run dev` 直接运行应用和基础包源码，并监听变化自动重启，无需预先 build。构建产物仍可通过 `bun run build` 后执行 `bun run start` 体验。启动器通过绝对路径读取仓库的 `.env.local` 和 TUI 配置，保持调用者当前目录。终端环境变量优先于 `.env.local`，两者都覆盖全局 YAML 默认配置。

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

直接在应用目录运行时，可传入一个工作区路径，或设置 `ALPHACODE_WORKSPACE`；未指定则使用当前目录。路径参数优先于环境变量，输入框下方显示实际工作区。

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

- 输入框始终固定在终端底部，默认一行，随自动折行或手动换行向上增高；最多显示六行，且不超过终端高度的四分之一，超出后在输入区内滚动。下面仅显示 `模型名 · 工作目录`，窄窗口截断长内容；对话在上方独立滚动。
- `Enter` 发送；`Ctrl+J` 或终端支持的 `Shift+Enter` 换行；支持粘贴多行。
- 回复增量显示 Markdown，包括列表、代码块和表格；滚动区跟随底部，可用鼠标回看。
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
- `scripts/build.ts`：使用 OpenTUI Solid 的 Bun 插件构建；产物需 Bun 与已安装依赖。
- `bin/alphacode.ts`：跨目录的开发版命令入口，指定源码条件、仓库配置和 Solid 转换，保持 cwd 并等待 TUI 退出。
- `scripts/preload.ts`：为源码和构建产物加载 Solid 转换。

依赖关系：`UI → Chat 接口`，`对话控制器 → ChatRuntime 接口`，`具体运行时实现 ChatRuntime`。只有 `application.ts` 负责把实现连接起来。UI 不读取 Agent 或数据库；对话模块不创建运行时，也不依赖 Solid/OpenTUI。ESLint 检查这些边界。扩展界面组件、调整对话策略或更换运行时，可以在各自模块内完成。

```powershell
bun run build
bun run typecheck
bun run lint
bun run test
```

AlphaCode 测试使用离线 SSE 夹具驱动真实 Provider、ADK、Coding Agent 和临时 SQLite，并用 OpenTUI 测试渲染器检查输入与增量显示；普通测试不会请求真实模型。

工程基于 [create-tui Solid 模板](https://github.com/msmps/create-tui/tree/main/packages/templates/solid)，使用 OpenTUI 0.8.1 和 SolidJS 1.9.18。Markdown 行为参考 [OpenTUI 文档](https://opentui.com/docs/components/markdown/)。
