# AlphaCode Web

React + TypeScript + Vite 的空白前端工程。旧界面、组件、样式、会话状态与 HTTP/SSE 接入代码已清空；当前页面不渲染内容，也不连接后端。

## 运行与检查

在仓库根目录执行，沿用工作区的 Bun 和唯一的 `bun.lock`：

```powershell
bun install --frozen-lockfile
bun run dev:web
bun run build:web
bun run --cwd apps/alphacode-web typecheck
bun run --cwd apps/alphacode-web lint
bun run --cwd apps/alphacode-web test
```

开发服务监听 `http://127.0.0.1:5173`，构建产物位于本包 `dist/`。CLI 的 `/web` 入口仍保留，但现在打开的是空白应用，不提供会话交互。

## 保留的结构

- `index.html`：HTML 容器。
- `src/index.tsx`：React DOM `createRoot` 挂载入口。
- `src/app.tsx`：返回 `null` 的空应用，后续从此处重新实现。
- `vite.config.ts`、`tsconfig*.json`、`package.json`：开发、构建和检查配置。
- `test/`：测试初始化与空应用冒烟测试，不包含旧业务测试。

本包运行时依赖为 `react` 和 `react-dom`（19.3.1），使用 `@vitejs/plugin-react` 构建、React Testing Library 测试，不预设 UI 组件库或视觉风格。CLI/TUI、本地 server 和历史设计文档保留；独立客户端包已移除，CLI 需要的通信实现位于 `apps/alphacode/src/server`。历史方案不代表当前前端已实现的功能。
