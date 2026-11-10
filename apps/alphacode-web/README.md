# AlphaCode Web

React + TypeScript + Vite 的会话工作区，使用 shadcn/ui（New York / Neutral）、官方 AI Elements 组合模式、Tailwind CSS v4 和 TanStack Query v5。

## 功能与边界

- 首次发送有效消息后异步生成会话标题，复用当前模型、每个新会话至多请求一次，不影响正文回复。侧栏在生成期间显示单行骨架屏，8 秒超时或失败后显示首条消息摘要；未发送草稿仍显示“新会话”。生成标题经 SSE 同步并保存，恢复历史保持原有标题。

- 左侧展示 AlphaCode 品牌、会话搜索、可折叠文件夹与当前会话高亮；支持按会话标题、文件夹名及路径搜索。
- 采用紧凑工作台布局：240px 侧栏、44px 顶栏、680px 输入区。输入框下方不再显示文件夹与保存提示，首页可继续当前项目的已有会话；右上角仅保留列表式摘要按钮，面板默认收起，展开后展示路径、消息数量与草稿附件。
- 从 CLI `/web` 打开时按 `?session=<id>` 选中当前会话；切换会话同步更新 URL，支持刷新和浏览器前进/后退。没有 session 参数时进入新会话首页。品牌栏的新建按钮创建本地草稿，项目分组的加号可直接在该项目创建；空白草稿会复用，已编辑的草稿保留在原项目下。输入草稿时标题保持“新会话”，发送并创建真实会话后使用服务端标题。Ctrl/⌘ + K 打开搜索。
- 使用官方 AI Elements 的 Chat / Message / Prompt Input 模式：Message Scroller 独立滚动、用户 Bubble 右对齐、助手回复平铺。每轮 AI 回复结束后，仅最后一个非空正文块提供复制按钮，中间过程不显示；用户消息和代码保留独立复制。
- 回复过程沿用官方 AI Elements Chain of Thought / Trace：发送即显示等待状态，思考、流式回复、保存与停止共用消息列表末尾的状态区，始终位于正文下方；连续工具步骤在运行中自动展开，结束后收起，并尊重手动展开选择。状态来自实际会话快照，支持停止、审批和断线提示。
- 加载图标与 TUI 使用相同的圆环 / ∞ 变形路径和五秒循环；断线或减少动态效果模式下保持静止。工具记录跨轮保留，历史恢复包含所有轮次的工具调用与结果；已保存的数据不需要迁移。
- 点击“搜索会话”或按 Ctrl/⌘ + K 打开独立搜索弹窗，搜索所有已登记项目的会话标题、路径及完整消息正文，包含未打开的历史会话。使用 [cmdk](https://github.com/dip/cmdk) 的 Command、Input、List、Group、Item、Empty 和 Loading，配合 Radix Dialog 管理弹窗焦点；设置 `shouldFilter={false}` 保留服务端全文匹配结果。视觉样式适配 [cmdk 官方 Vercel 示例](https://github.com/dip/cmdk/blob/main/website/styles/cmdk/vercel.scss)，在 `session-search.css` 保留来源与 MIT 声明：640px 最大宽度、分组标题、最近会话项目标签和选中项 Enter 键帽，列表按内容收缩并在 330px 后滚动；移动端随视口收缩，沿用现有浅色/深色主题。全文结果行展开显示路径和高亮命中片段，不保留旧说明页脚；每个会话最多预览三条匹配消息，同时显示匹配消息总数。支持上下方向键选择、Enter 打开、Esc 关闭、加载/无结果/失败重试；输入时防抖并取消过期请求，不再筛选侧栏导航。
- Markdown 使用 `react-markdown` 与 `remark-gfm` 随实时快照增量渲染，保留默认 URL 安全处理并跳过原始 HTML。Code Block 使用 Shiki 按需加载高亮引擎及语言，未知语言或加载失败显示原文；表格和代码块局部横向滚动。
- 桌面侧栏支持按钮与 Ctrl/⌘ + B 折叠；移动端使用 Sheet 抽屉，选中会话后关闭。侧栏、抽屉和搜索使用 Motion 过渡，支持中途反向操作与系统减少动态效果偏好；动画功能异步加载，常用时长和缓动集中在 `src/lib/motion.ts`。
- **已接入真实服务端对话**：通过同源 GET 读取项目与会话历史，订阅全局 `/api/events` 更新列表、订阅当前 `/api/sessions/:id/events` 实时更新回复与工具状态。Web 与 CLI 打开同一会话时使用同一个 runtime，任一端发送、取消或审批都会同步到另一端。切换会话释放旧订阅，各会话缓存独立；旧 GET 或 SSE 快照不能覆盖同一 server 的较新 sequence。
- SSE 断线会自动退避重连并读取全量快照，重连期间保留内容与草稿、禁用发送。45 秒无数据重建连接；401/403/404 停止自动重试。列表事件合并刷新，15 秒轮询作为列表及断线历史的兜底。页面不显示手动刷新按钮，加载失败时仍可重试。
- 用户和助手消息沿用 Markdown 渲染，不重复显示说话人名称；复制入口位于正文下方，助手靠左、用户靠右。空正文的工具调用消息不占位。连续工具记录合并成活动组，历史默认折叠，实时执行自动展开；摘要保留数量及失败、待审批等状态，展开后按原顺序查看各条记录的命令、路径、退出码、输出和错误。会话快照刷新保留手动展开状态。加载、空列表、空历史、会话不存在、请求失败均有独立状态和重试入口；刷新失败时保留旧数据并提示。
- 从侧栏项目分组新建草稿，首次发送时通过 `POST /api/sessions` 在该项目创建真实会话，然后提交消息。Enter 发送、Shift+Enter 换行，输入法确认不触发提交；运行中可编辑下一条草稿、停止生成或处理工具审批。发送结果不明时保留原请求 ID 与原文，点击“重试发送”由服务端去重；收到 admission 回执不代表执行成功，结果以会话状态为准。待重试请求与未发送草稿仅保留在当前页面，刷新后会丢失。附件仍仅作为本页草稿保留，存在附件时提示移除后发送文字，不会静默丢弃附件。示例数据仅用于测试。
- 输入框暂不显示添加附件按钮和 Enter / Shift+Enter 提示；键盘发送与换行行为保持不变。侧栏列表对称预留滚动条空间，选中会话背景的左右留白一致。
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

开发服务监听 `http://127.0.0.1:5173`，构建产物位于本包 `dist/`。真实数据联调使用 `bun run build:web` 后在 CLI 输入 `/web`：本地 server 在同一端口提供静态页面和 API。Web 修改后需要重新构建并刷新页面；`/web` 仅在缺少构建产物时自动构建。单独的 `dev:web` / Vite preview 不提供后端 API，会显示连接失败提示，不会退回示例数据。

浏览器请求不携带原生 token 或 cookie，拒绝重定向，使用 server 现有的同源访问规则。列表覆盖当前数据库中已通过 CLI 登记的项目；server 重启导致端口变化时重新运行 `/web`。

## 基础设施

- Tailwind CSS 通过 `@tailwindcss/vite` 接入，入口为 `src/styles.css`；只扫描本应用的 `src/` 与 `index.html`，不需要额外的 PostCSS 或 Tailwind JS 配置。
- shadcn/ui 使用 New York / Neutral、CSS variables 和 Lucide 图标，配置位于 `components.json`。通过固定版本 CLI 按需引入组件，保留项目内源码。AI Elements 当前官方入口已迁入 [shadcn/ui](https://ui.shadcn.com/docs/ai-elements)，不是额外安装一个 `ai-elements` npm 包；来源与局部适配见 `DESIGN.md`。
- `@/*` 映射到本包 `src/*`，TypeScript、Vite 和 Vitest 共用该别名；不要用它引用 CLI 或服务端内部实现。
- `@/lib/utils` 导出 `cn`，使用 shadcn 的 `cn` 包合并条件类名并解决 Tailwind 类名冲突。
- `AppProviders` 为每次应用挂载创建独立的 `QueryClient`，重渲染保留缓存。会话查询显式提供请求函数、AbortSignal 和刷新策略；网络/服务端失败自动重试一次，4xx 不自动重试。
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
- `src/features/sessions/`：浏览器 API 投影、查询、工作区分组、侧栏、历史消息及工具记录视图。
- `src/features/sessions/use-session-workspace.ts`：服务端查询、URL 会话选择、按项目新建本地草稿、独立文本与附件。历史消息视图按需加载，首页不加载 Markdown 和代码高亮引擎。
- `src/components/markdown.tsx`：Markdown 渲染入口，排版使用全局主题变量。
- `src/features/sessions/stream.ts`、`use-session-actions.ts`：浏览器 SSE 重连、请求去重重试、取消及审批。
- `src/components/ai-elements/`：官方 AI Elements 模式的消息与对话输入组合。
- `src/components/providers.tsx`：全局 Query 与 Theme Provider。
- `src/lib/highlighter.tsx`：按需加载 Shiki 引擎、主题和语言。
- `src/components/ui/`：项目内维护的 shadcn/ui 组件源码。
- `src/lib/utils.ts`：公共 `cn` 工具入口。
- `src/styles.css`：Tailwind、动画和 shadcn 主题。
- `components.json`：shadcn CLI 的组件、工具与样式路径配置。
- `vite.config.ts`、`tsconfig*.json`、`package.json`：开发、构建和检查配置。
- `test/`：接口夹具、URL 定位、按需查询、取消与切换竞态、错误与重试、刷新、空历史、工具输出、首页与草稿、移动端、主题、Markdown 安全性及基础组件测试。

本包保持 React / React DOM 19.3.1，使用 `@vitejs/plugin-react` 构建、React Testing Library 测试。CLI/TUI、本地 server 和历史设计文档保留；独立客户端包已移除，CLI 需要的通信实现位于 `apps/alphacode/src/server`。历史方案不代表当前前端已实现的功能。
