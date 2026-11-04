# Alpha

Agent 开发框架的 monorepo。Provider 提供模型配置与协议适配；ADK 提供内置 Loop、工具、插件和运行控制，示例默认使用离线 HTTP 夹具。

## 目录

- `packages/adk`：Agent 开发框架。
- `packages/adk-session`：可选的会话管理与 Memory / SQLite 归档扩展。
- `packages/coding-agent`：编程能力插件、六工具和 Windows 本地工作区适配器。
- `packages/provider`：模型提供商配置和适配。
- `apps/example-agent`：组装 Provider 与 ADK 的示例，默认离线运行。
- `docs`：调研与技术方案。

依赖方向：应用组装 Coding、Session、ADK 和 Provider；Coding 复用 core 工厂与插件，Session 仅引用 core 公开类型，两者不互相依赖。ADK 仅通过公开类型单向依赖 Provider，内核不反向依赖扩展。使用 Nx 标签、ESLint 与产物测试检查跨包和运行时边界。ADK 的唯一业务入口是 `@alpha/adk/core`。

## 本地开发

需要 Node.js 20.19+（20.x）、22.13+（22.x）或 24 及以上版本，以及 pnpm 9.15.1。Nx 22 LTS 用于兼容当前 Node.js 20 环境；Node 升级后应评估 Nx 升级。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm graph
```

`pnpm graph` 打开 Nx 项目依赖图。Provider 使用方法见 [Provider README](packages/provider/README.md)。包名为内部占位名称，目前均为 private；尚未配置发布或 CI。

构建和类型检查使用 Rust 实现的 `tsrs`（当前为 TypeScript 7.1 beta 对应的实验版本），版本固定在锁文件中。根依赖中的 TypeScript 6.0 供 ESLint TypeScript 工具使用，与 tsrs 使用的编译器版本不同；应留意两者兼容性。遇到 tsrs 编译问题时，可先用 `pnpm exec tsc -p packages/adk/tsconfig.json --noEmit` 等命令辅助排查，但两者诊断不保证一致。

## ADK

[ADK 使用说明](packages/adk/README.md) · [P0 Spec](docs/adk-p0-spec.md) · [P0 TODO](docs/adk-p0-todo.md) · [验收记录](docs/adk-p0-validation.md)

构建后执行 `pnpm --filter @alpha/example-agent start` 可离线演示 Provider → Agent → 工具 → 最终回答。真实端点联调需单独配置并显式运行，结果见验收记录。

本机后续真实联调使用 `http://127.0.0.1:3425/v1` 与 `codex/gpt-6.1-sol`，配置见 [.env.example](.env.example)；本地副本 `.env.local` 已忽略提交。从仓库根目录执行 `node --env-file=.env.local packages/adk/integration/live.js` 可运行受控工具闭环探针，默认自动化测试仍使用离线夹具。

## Session

[使用说明](packages/adk-session/README.md) · [S2 Spec](docs/adk-session-s2-spec.md) · [S2 示例](docs/adk-session-example-s2.ts) · [验收记录](docs/adk-session-s2-validation.md)

构建后执行 `pnpm --filter @alpha/adk-session example` 或追加 `--sqlite`，演示会话创建、关闭、重开、历史恢复与重复请求。Session S2 通过 `createSessionPlugin({ session })` 接入 core 的通用运行边界；执行始终使用 `agent.prompt()`，Session 不再代理执行或创建 Agent。S1 归档格式保持兼容。

显式真实模型验证：`node --env-file=.env.local apps/example-agent/integration/session-live.js`，检查工具调用、SQLite 重开和重复请求零执行。

## Coding Agent

[使用说明](packages/coding-agent/README.md) · [交互文档](docs/coding-agent-design-c1.html) · [API 类型](docs/coding-agent-api-c1.d.ts) · [组合用例](docs/coding-agent-example-c1.ts) · [实现规格](docs/coding-agent-c1-spec.md) · [验收记录](docs/coding-agent-c1-validation.md)

C1 已实现独立 `@alpha/coding-agent` 能力包，复用 core 与 Provider；Session 由应用通过插件组合，执行统一为 `agent.prompt()`。本地适配器当前支持 Windows + PowerShell 7 + ripgrep，提供三个读取工具、精确编辑、只创建文件、命令执行及 AGENTS.md 指令。HTML 可直接离线打开。

显式真实修复验证：`node --env-file=.env.local packages/coding-agent/integration/live.js`。探针在临时项目验证失败测试、最小源码修复、测试通过和 Session 重放零副作用。
