# AlphaCode

基于 OpenTUI + SolidJS 的终端 Agent 应用骨架，使用仓库统一的 Bun 1.4.4。目前保留模板欢迎页，标题为 AlphaCode，尚未接入 Agent 功能。

从仓库根目录安装依赖并启动开发模式：

```bash
bun install --frozen-lockfile
bun run dev
```

单独构建、检查和运行 AlphaCode：

```bash
bun run --filter @alpha/alphacode typecheck
bun run --filter @alpha/alphacode lint
bun run --filter @alpha/alphacode build
bun run --cwd apps/alphacode start
```

在交互式终端运行，按 `Ctrl+C` 关闭界面。开发模式监听源码变化并重启应用；如果关闭界面后 Bun 仍在监听，再按一次 `Ctrl+C` 结束监听。也可以进入 `apps/alphacode` 后运行 `bun run dev`。

- `src/index.tsx`：SolidJS 入口与模板欢迎页。
- `bunfig.toml`：加载 OpenTUI Solid 的 JSX 转换插件。
- `tsconfig.json`：保留模板的 Solid JSX 与 Bundler 配置，继承仓库的基础配置。
- `scripts/build.ts`：使用官方 Solid Bun 插件构建到 `dist/index.js`；产物仍需 Bun 与已安装的依赖。

模板来源：[create-tui 的 Solid 模板](https://github.com/msmps/create-tui/tree/main/packages/templates/solid)，适配了仓库的 Bun workspace、Nx 和 tsrs。依赖固定为模板版本：OpenTUI 0.8.1、SolidJS 1.9.18。

构建方式参考 [OpenTUI Solid 官方说明](https://github.com/anomalyco/opentui/tree/main/packages/solid)。仓库根目录的 `build`、`typecheck` 和 `lint` 会通过 Nx 自动包含此应用。
