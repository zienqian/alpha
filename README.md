# Alpha

Agent 开发框架的 monorepo。Provider 提供模型配置与协议适配；ADK 提供内置 Loop、工具、插件和运行控制，示例默认使用离线 HTTP 夹具。

## 本地体验 AlphaCode

```powershell
bun install
bun run dev
```

开发模式直接运行最新源码，无需先 build。想在其他项目目录使用，先在本仓库执行一次 `bun run link:dev`，再打开终端进入目标项目，执行 `alphacode`。此命令链接到当前仓库；更新代码后退出重开即可，`alphacode --watch` 可自动重启。模型配置沿用仓库 `.env.local`，首次使用可参考 `.env.example`。[完整开发命令](apps/alphacode/README.md)

## 目录

- `packages/adk`：Agent 开发框架。
- `packages/adk-session`：可选的会话管理与 Memory / SQLite 归档扩展。
- `packages/coding-agent`：六个独立静态工具、cwd 上下文和跨平台 Shell 执行。
- `packages/provider`：模型提供商配置和适配。
- `apps/example-agent`：组装 Provider 与 ADK 的示例，默认离线运行。
- `apps/alphacode`：OpenTUI + React 终端编程 Agent，提供用户输入与 Markdown 流式回复。
- `docs`：调研与技术方案。

依赖方向：应用组装 Coding、Session、ADK 和 Provider；Coding 复用 core 工厂与插件，Session 仅引用 core 公开类型，两者不互相依赖。ADK 仅通过公开类型单向依赖 Provider，内核不反向依赖扩展。使用 Nx 标签、ESLint 与产物测试检查跨包和运行时边界。ADK 的唯一业务入口是 `@alpha/adk/core`。

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

`bun run graph` 打开 Nx 项目依赖图。Provider 使用方法见 [Provider README](packages/provider/README.md)。包名为内部占位名称，目前均为 private；尚未配置发布或 CI。

使用 `bun run test` 执行 Nx 的完整测试任务（先构建依赖）。终端和库包测试使用 `bun:test`，Web 使用 Vitest、jsdom 和 React Testing Library；任务由 Bun 执行。真实模型测试通过各包的 `test:live` 或显式脚本运行，不在普通测试中自动请求模型。

Session 使用 Bun 内置的 `bun:sqlite`，无需第三方 SQLite 驱动或原生模块安装。`@alpha/coding-agent` 直接接收 cwd，进程通过 `cross-spawn` 启动，按 OpenCode 路线选择 Shell 和处理取消。`node:fs`、`node:path` 等是 Bun 支持的标准库 API。

数据库表结构与归档 `formatVersion=1` 保持不变；迁移前 Node / better-sqlite3 和 Bun 内置 SQLite 生成的数据库作为测试夹具验证历史恢复、请求重放及续写。`docs` 中原有验收文档记录当时的运行环境，当前开发命令以这里和各包 README 为准。

构建和类型检查使用 Rust 实现的 `tsrs`（当前为 TypeScript 7.1 beta 对应的实验版本），版本固定在锁文件中。根依赖中的 TypeScript 6.0 供 ESLint TypeScript 工具使用，与 tsrs 使用的编译器版本不同；应留意两者兼容性。遇到 tsrs 编译问题时，可先用 `bun --bun run tsc -p packages/adk/tsconfig.json --noEmit` 等命令辅助排查，但两者诊断不保证一致。

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
