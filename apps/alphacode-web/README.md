# AlphaCode Web

React + TypeScript + Vite 的会话工作区，使用 shadcn/ui（New York / Neutral）、官方 AI Elements 组合模式、Tailwind CSS v4 和 TanStack Query v5。

## 功能与边界

- 左侧展示 AlphaCode 品牌、会话搜索、可折叠文件夹与当前会话高亮；支持按会话标题、文件夹名及路径搜索。
- 采用紧凑工作台布局：240px 侧栏、44px 顶栏、680px 输入区。项目选择与输入框就近排列，首页可继续当前项目的已有会话；右上角上下文面板展示路径、消息数量与草稿附件。
- 默认进入新会话首页。品牌栏的新建按钮创建本地草稿，项目分组的加号可直接在该项目创建；空白草稿会复用，已编辑的草稿保留在原项目下，并用首行内容命名。Ctrl/⌘ + K 打开搜索。
- 使用官方 AI Elements 的 Chat / Message / Prompt Input 模式：Message Scroller 独立滚动、用户 Bubble 右对齐、助手回复平铺、消息和代码可复制。
- Markdown 使用 `react-markdown` 与 `remark-gfm`，保留默认 URL 安全处理并跳过原始 HTML。Code Block 使用 Shiki 按需加载高亮引擎及语言，未知语言或加载失败显示原文；表格和代码块局部横向滚动。当前不包含流式 Markdown。
- 桌面侧栏支持按钮与 Ctrl/⌘ + B 折叠；移动端使用 Sheet 抽屉，选中会话后关闭。
- **当前为本地示例预览**：历史来自 `src/features/sessions/demo-data.ts`，不请求后端、不调用模型。支持新建草稿、更换草稿所属工作区、选择和移除本地附件；发送按钮禁用。草稿文本和附件不持久化、不上传，刷新后回到新会话首页。
- 支持浅色、深色和跟随系统，只有主题偏好保存在浏览器。

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

开发服务监听 `http://127.0.0.1:5173`，构建产物位于本包 `dist/`。CLI 的 `/web` 入口仍保留；当前页面展示示例会话，不代表已连接 CLI 的真实 Session。

## 基础设施

- Tailwind CSS 通过 `@tailwindcss/vite` 接入，入口为 `src/styles.css`；只扫描本应用的 `src/` 与 `index.html`，不需要额外的 PostCSS 或 Tailwind JS 配置。
- shadcn/ui 使用 New York / Neutral、CSS variables 和 Lucide 图标，配置位于 `components.json`。通过固定版本 CLI 按需引入组件，保留项目内源码。AI Elements 当前官方入口已迁入 [shadcn/ui](https://ui.shadcn.com/docs/ai-elements)，不是额外安装一个 `ai-elements` npm 包；来源与局部适配见 `DESIGN.md`。
- `@/*` 映射到本包 `src/*`，TypeScript、Vite 和 Vitest 共用该别名；不要用它引用 CLI 或服务端内部实现。
- `@/lib/utils` 导出 `cn`，使用 shadcn 的 `cn` 包合并条件类名并解决 Tailwind 类名冲突。
- `AppProviders` 为每次应用挂载创建独立的 `QueryClient`，重渲染保留缓存，沿用 TanStack Query 默认策略。后续组件可直接使用 `useQuery` / `useMutation`，请求函数按业务显式提供。
- `ThemeProvider` 按官方 Vite 模式控制 `<html>` 的主题和 `color-scheme`，监听系统变化；localStorage 不可用时仍可在当前页面切换。

从仓库根目录添加组件（使用本包固定版本的 shadcn CLI）：

```powershell
bun run --cwd apps/alphacode-web ui:add input card dialog
```

组件从 `@/components/ui/button` 等路径导入，可通过 `className` 覆盖样式。新增依赖继续记录在本包 `package.json` 和根目录唯一的 `bun.lock`，不要另建锁文件。项目统一用 Bun 执行工具；若使用 Node，要求 Node >=22.12.0。

## 目录结构

- `index.html`：HTML 容器。
- `src/index.tsx`：React DOM 挂载入口，引入全局样式与 `AppProviders`。
- `src/app.tsx`：工作区布局与当前会话选择状态。
- `src/features/sessions/`：会话类型、示例数据、侧栏与消息列表视图。
- `src/features/sessions/use-session-workspace.ts`：本地会话、项目选择、独立文本与附件草稿。历史消息视图按需加载，首页不加载 Markdown 和代码高亮引擎。
- `src/components/markdown.tsx`：Markdown 渲染入口，排版使用全局主题变量。
- `src/components/ai-elements/`：官方 AI Elements 模式的业务组合（消息和只读草稿输入）。
- `src/components/providers.tsx`：全局 Query 与 Theme Provider。
- `src/lib/highlighter.tsx`：按需加载 Shiki 引擎、主题和语言。
- `src/components/ui/`：项目内维护的 shadcn/ui 组件源码。
- `src/lib/utils.ts`：公共 `cn` 工具入口。
- `src/styles.css`：Tailwind、动画和 shadcn 主题。
- `components.json`：shadcn CLI 的组件、工具与样式路径配置。
- `vite.config.ts`、`tsconfig*.json`、`package.json`：开发、构建和检查配置。
- `test/`：首页、新建/复用草稿、项目切换、附件添加/移除、会话搜索与切换、移动端、草稿隔离、复制成功/失败、主题、Markdown 渲染与安全性，以及基础组件和 Query Provider 测试。

本包保持 React / React DOM 19.3.1，使用 `@vitejs/plugin-react` 构建、React Testing Library 测试。CLI/TUI、本地 server 和历史设计文档保留；独立客户端包已移除，CLI 需要的通信实现位于 `apps/alphacode/src/server`。历史方案不代表当前前端已实现的功能。
