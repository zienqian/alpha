# Alpha

Agent 开发框架的 monorepo。Provider 配置层已提供模型实例创建；ADK 和示例应用仍是骨架。

## 目录

- `packages/adk`：Agent 开发框架。
- `packages/provider`：模型提供商配置和适配。
- `apps/example-agent`：未来组装两个包的示例应用。
- `docs`：调研与技术方案。

依赖方向：应用可依赖 ADK 和 provider；ADK 与 provider 互不依赖。使用 Nx 标签与 ESLint 检查跨包源码引用。

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
