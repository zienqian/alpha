# Alpha

Agent 开发框架的 monorepo。Provider 提供模型配置与协议适配；ADK 提供内置 Loop、工具、插件和运行控制，示例默认使用离线 HTTP 夹具。

## 本地体验 AlphaCode

```powershell
bun install
bun run dev
```

开发模式直接运行最新源码，无需先 build。想在其他项目目录使用，先在本仓库执行一次 `bun run link:dev`，再打开终端进入目标项目，执行 `alphacode`。此命令链接到当前仓库；更新代码后退出重开即可，`alphacode --watch` 可自动重启。模型配置沿用仓库 `.env.local`，首次使用可参考 `.env.example`。[完整开发命令](apps/alphacode/README.md)

## 桌面应用 AlphaCode

`bun run dev:app` 启动 AlphaCode Electron 桌面客户端，直接复用现有 React Web 界面；保存前端代码自动热更新，修改桌面主进程自动重启。`bun run dev:web` 启动带真实 API 代理的浏览器开发服务。`bun run build:app` 构建页面与桌面入口；`bun run package:app` 生成包含 Electron、Bun、App Server 和 ripgrep 的独立应用目录，Windows 入口为 `apps/alphacode-app/dist/AlphaCode-win32-x64/AlphaCode.exe`。开发使用 Bun。会话与 Agent 能力继续复用同一个 App Server。[运行方式、测试及打包边界](apps/alphacode-app/README.md)。

## 目录

- `packages/adk`：Agent 开发框架。
- `packages/adk-session`：可选的会话管理与 Memory / SQLite 归档扩展。
- `packages/coding-agent`：六个独立静态工具、cwd 上下文和跨平台 Shell 执行。
- `packages/provider`：模型提供商配置和适配。
- `apps/alphacode-app-server`：独立本地应用服务，负责会话、Agent 执行、审批和 HTTP/SSE；[独立启动与接口](apps/alphacode-app-server/README.md)。
- `apps/alphacode-web`：React Web 客户端，与 CLI 共享服务和会话。
- `apps/alphacode-app`：Electron 桌面外壳，加载 `alphacode-web` 构建产物并连接 Bun App Server。
- `apps/example-agent`：组装 Provider 与 ADK 的示例，默认离线运行。
- `apps/alphacode`：OpenTUI + React 终端客户端，通过 App Server 提供用户输入与 Markdown 流式回复。
- `docs`：调研与技术方案。

依赖方向：AlphaCode App Server 在应用层组装 Coding、Session、ADK 和 Provider；CLI 通过服务的客户端接口接入，Web 使用 HTTP/SSE。基础包不反向依赖 AlphaCode 业务。Coding 复用 core 工厂与插件，Session 仅引用 core 公开类型，两者不互相依赖。ADK 仅通过公开类型单向依赖 Provider，内核不反向依赖扩展。使用 Nx 标签、ESLint 与产物测试检查跨包和运行时边界。ADK 的唯一业务入口是 `@alpha/adk/core`。

## 本地开发

全仓库开发使用 Bun 1.4.4（`.bun-version`），安装和任务执行统一使用 Bun。根目录 `workspaces` 管理应用与库包，`bun.lock` 固定依赖；Nx 继续负责任务依赖与缓存，ESLint 检查包边界，tsrs 负责库包构建与全仓类型检查。终端与 Web 统一使用 React：AlphaCode 通过 Bun 原生 JSX 转换和 `@opentui/react` 构建，Web 使用 React DOM、Vite 和 `@vitejs/plugin-react`，不再需要额外的 JSX preload。

相对模块的 `import` / `export` 统一省略代码扩展名（例如 `./config`、`../contracts`），类型导入和动态 `import()` 也遵循此约定，由 ESLint 检查。跨包使用公开入口（例如 `@alpha/adk/core`）；JSON 等资源导入、`package.json` 入口和文件系统路径保留实际扩展名。源码与构建产物均由 Bun 解析模块。

```sh
bun install --frozen-lockfile
bun run build
bun run typecheck
bun run lint
bun run test
bun run graph
```

`bun run graph` 打开 Nx 项目依赖图。Provider 使用方法见 [Provider README](packages/provider/README.md)。包名为内部占位名称，目前均为 private；尚未配置自动发布。

使用 `bun run test` 执行 Nx 的完整测试任务（先构建依赖）。终端和库包测试使用 `bun:test`，Web 使用 Vitest、jsdom 和 React Testing Library；任务由 Bun 执行。真实模型测试通过各包的 `test:live` 或显式脚本运行，不在普通测试中自动请求模型。

桌面源码工程名为 `alphacode-app`，对外产品名为 AlphaCode。Nx 任务构建 Electron 主进程并检查 TypeScript；`bun run test:app` 验证桌面协议、服务连接和 SSE。

Session 使用 Bun 内置的 `bun:sqlite`，无需第三方 SQLite 驱动或原生模块安装。`@alpha/coding-agent` 直接接收 cwd，进程通过 `cross-spawn` 启动，按 OpenCode 路线选择 Shell 和处理取消。`node:fs`、`node:path` 等是 Bun 支持的标准库 API。

数据库表结构与归档 `formatVersion=1` 保持不变；迁移前 Node / better-sqlite3 和 Bun 内置 SQLite 生成的数据库作为测试夹具验证历史恢复、请求重放及续写。`docs` 中原有验收文档记录当时的运行环境，当前开发命令以这里和各包 README 为准。

构建和类型检查使用 Rust 实现的 `tsrs`（当前为 TypeScript 7.1 beta 对应的实验版本），版本固定在锁文件中。根依赖中的 TypeScript 6.0 供 ESLint TypeScript 工具使用，与 tsrs 使用的编译器版本不同；应留意两者兼容性。遇到 tsrs 编译问题时，可先用 `bun --bun run tsc -p packages/adk/tsconfig.json --noEmit` 等命令辅助排查，但两者诊断不保证一致。

## GitHub CI

[CI 工作流](.github/workflows/ci.yml) 在推送到 `main`、提交或更新 PR 时自动运行，也可以在 GitHub Actions 中手动运行。使用 `.bun-version` 指定的 Bun 和锁定依赖，在 Linux x64、Windows x64、macOS Intel x64 与 Apple Silicon arm64 上分别构建 CLI 和桌面 App。

每个平台先通过 Nx 构建 CLI 及其依赖，并运行构建产物的 `--help` / `--version` 冒烟检查；随后打包 App（包含完整 CLI），执行桌面、随包 Bun 后端和 CLI 的离线集成测试。CLI 测试覆盖无全局 Bun、包目录移动和用户独立 CLI 优先。CI 无需模型 API 密钥，不启动 Electron 图形窗口。

构建成功后，在对应 Actions 运行的 **Artifacts** 中下载产物，保留 14 天：

- `alphacode-cli-<platform>-<arch>`：CLI、App Server 和库包的 `dist` 构建产物。需要检出同一提交、执行 `bun install --frozen-lockfile`，再把压缩包解压到仓库根目录；通过 `bun --no-env-file apps/alphacode/dist/index.js` 运行。此产物仍需 Bun、项目依赖及供搜索使用的 ripgrep。
- `alphacode-app-<platform>-<arch>`：包含 Electron、Bun、CLI、App Server、Web 和 ripgrep 的独立应用目录。解压 `.tar.gz` 后运行目录内的 `AlphaCode.exe`、`AlphaCode.app` 或 `AlphaCode`，并完整保留目录内容。在 App 的 **工具 → 安装 alphacode 终端命令…** 中启用终端命令；用户已有或后来安装的 CLI 优先使用，详见 [App CLI 说明](apps/alphacode-app/README.md#随-app-提供的-cli)。使用 tar 保存可执行权限、符号链接及隐藏运行时文件，参见 [GitHub artifact 文档](https://github.com/actions/upload-artifact#permission-loss)。

平台标识使用 `linux`、`win32`、`darwin`。App 产物尚未签名或公证；CI 验证构建与后台集成，桌面图形界面仍需在目标系统上验收。工作流仅上传 Actions 产物，不创建 Release。

## ADK

[ADK 使用说明](packages/adk/README.md) · [P0 Spec](docs/adk-p0-spec.md) · [P0 TODO](docs/adk-p0-todo.md) · [验收记录](docs/adk-p0-validation.md)

构建后执行 `bun run --filter @alpha/example-agent start` 可离线演示 Provider → Agent → 工具 → 最终回答。真实端点联调需单独配置并显式运行，结果见验收记录。

本机后续真实联调使用 `http://127.0.0.1:3425/v1` 与 `codex/gpt-6.1-sol`，配置见 [.env.example](.env.example)；本地副本 `.env.local` 已忽略提交。从仓库根目录执行 `bun --env-file=.env.local packages/adk/integration/live.js` 可运行受控工具闭环探针，默认自动化测试仍使用离线夹具。

## Session

[使用说明](packages/adk-session/README.md) · [S2 Spec](docs/adk-session-s2-spec.md) · [S2 示例](docs/adk-session-example-s2.ts) · [验收记录](docs/adk-session-s2-validation.md)

构建后执行 `bun run --filter @alpha/adk-session example` 或追加 `--sqlite`，演示会话创建、关闭、重开、历史恢复与重复请求。Session S2 通过 `createSessionPlugin({ session })` 接入 core 的通用运行边界；执行始终使用 `agent.prompt()`，Session 不再代理执行或创建 Agent。S1 归档格式保持兼容。

显式真实模型验证：`bun --env-file=.env.local apps/example-agent/integration/session-live.js`，检查工具调用、SQLite 重开和重复请求零执行。

## Coding Agent

[使用说明](packages/coding-agent/README.md) · [R3 重构评审](docs/coding-agent-refactor-review.html) · [API 类型](docs/coding-agent-api-c1.d.ts) · [组合用例](docs/coding-agent-example-c1.ts) · [实现规格](docs/coding-agent-c1-spec.md) · [验收记录](docs/coding-agent-c1-validation.md)

C1 已实现独立 `@alpha/coding-agent` 能力包，复用 core 与 Provider；Session 由应用通过插件组合，执行统一为 `agent.prompt()`。工具独立于目录上下文，提供三个读取工具、精确编辑、只创建文件、跨平台 Shell 命令执行及 AGENTS.md 指令；列表与搜索运行时需要 ripgrep。HTML 可直接离线打开。

显式真实修复验证：`bun --env-file=.env.local packages/coding-agent/integration/live.js`。探针在临时项目验证失败测试、最小源码修复、测试通过和 Session 重放零副作用。

## AlphaCode

[使用说明](apps/alphacode/README.md)。已接入 Provider、ADK、Coding Agent、本地工作区及 Session SQLite，支持输入、Markdown 流式回复、多轮上下文与命令确认。复用根目录 `.env.local` 中的 `ADK_*` 配置；`bun run dev` 构建后启动开发模式，`bun run build` 后可用 `bun run start` 运行构建产物。工作区默认为仓库根目录，每次启动新会话并归档到用户目录 `.alphacode/sessions.db`。

## AlphaCode 历史资料

AlphaCode 旧实现已移除，以下文档保留为重做时的历史参考，其中的实现状态和启动命令不再代表当前仓库。

[交互文档](docs/alphacode-design-a1.html) · [P0 规格](docs/alphacode-p0-spec.md) · [实施 TODO](docs/alphacode-p0-todo.md) · [验收记录](docs/alphacode-p0-validation.md)
