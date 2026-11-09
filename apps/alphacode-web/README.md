# AlphaCode Web

React + TypeScript + Vite 的前端基础工程，已接入 shadcn/ui、Tailwind CSS v4 和 TanStack Query v5。当前页面仍不渲染业务内容，也不连接后端。

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

## 基础设施

- Tailwind CSS 通过 `@tailwindcss/vite` 接入，入口为 `src/styles.css`；只扫描本应用的 `src/` 与 `index.html`，不需要额外的 PostCSS 或 Tailwind JS 配置。
- shadcn/ui 使用 New York / Neutral、CSS variables 和 Lucide 图标，配置位于 `components.json`。已提供 `Button`，其他组件按需添加，不预装整套组件。
- `@/*` 映射到本包 `src/*`，TypeScript、Vite 和 Vitest 共用该别名；不要用它引用 CLI 或服务端内部实现。
- `@/lib/utils` 导出 `cn`，使用 shadcn 的 `cn` 包合并条件类名并解决 Tailwind 类名冲突。
- `AppProviders` 为每次应用挂载创建独立的 `QueryClient`，重渲染保留缓存，沿用 TanStack Query 默认策略。后续组件可直接使用 `useQuery` / `useMutation`，请求函数按业务显式提供。
- 全局样式包含浅色与 `.dark` 主题变量；给 `<html>` 添加 `dark` 类即可切换。当前不包含主题切换 UI 或持久化逻辑。

从仓库根目录添加组件（使用本包固定版本的 shadcn CLI）：

```powershell
bun run --cwd apps/alphacode-web ui:add input card dialog
```

组件从 `@/components/ui/button` 等路径导入，可通过 `className` 覆盖样式。新增依赖继续记录在本包 `package.json` 和根目录唯一的 `bun.lock`，不要另建锁文件。项目统一用 Bun 执行工具；若使用 Node，要求 Node >=22.12.0。

## 目录结构

- `index.html`：HTML 容器。
- `src/index.tsx`：React DOM 挂载入口，引入全局样式与 `AppProviders`。
- `src/app.tsx`：返回 `null` 的空应用，后续从此处重新实现。
- `src/components/providers.tsx`：全局 Query Provider。
- `src/components/ui/`：项目内维护的 shadcn/ui 组件源码。
- `src/lib/utils.ts`：公共 `cn` 工具入口。
- `src/styles.css`：Tailwind、动画和 shadcn 主题。
- `components.json`：shadcn CLI 的组件、工具与样式路径配置。
- `vite.config.ts`、`tsconfig*.json`、`package.json`：开发、构建和检查配置。
- `test/`：空应用冒烟、组件行为、类名合并与 Query Provider 测试。

本包保持 React / React DOM 19.3.1，使用 `@vitejs/plugin-react` 构建、React Testing Library 测试。CLI/TUI、本地 server 和历史设计文档保留；独立客户端包已移除，CLI 需要的通信实现位于 `apps/alphacode/src/server`。历史方案不代表当前前端已实现的功能。
