# AlphaCode Web

React + TypeScript + Vite 的会话工作区，使用 shadcn/ui（New York / Neutral）、官方 AI Elements 组合模式、Tailwind CSS v4 和 TanStack Query v5。

## 功能与边界

- 侧栏“项目”为普通分组标题，旁边的“＋”打开创建项目表单；新会话输入框上方的项目名支持切换工作目录。桌面端可使用系统文件夹选择器，浏览器端输入运行 AlphaCode 的计算机上的完整目录路径；名称和目录登记在服务端，空项目也会显示，刷新和重启后保留，相同目录不会重复登记。创建项目不创建远端会话，首次发送时才创建；未发送的本地草稿可带着文字切换项目，已有会话始终保留原目录。新项目沿用当前项目的模型设置，没有已登记项目时使用全局模型配置。

- 侧栏会话右侧的“…”菜单支持重命名和删除。重命名在原行编辑，Enter 保存、Esc 取消，支持 1–200 个字符；保存后同步标题、搜索和服务端历史，手动标题不会被自动生成覆盖。本地草稿标题在首次发送时一并应用。删除前确认，成功后移除消息记录及本页草稿；删除当前会话会进入同项目的新会话，删除其他会话保留当前输入。运行、排队或保存中的会话需等待结束或先停止并清空队列；请求失败保留编辑内容并支持重试。

- 排队消息采用与输入框衔接的紧凑面板：左侧拖动柄和排队图标，右侧“引导”、删除与“…”菜单；菜单只提供“编辑消息”。支持鼠标/触屏拖动和聚焦拖动柄后按上下方向键排序。编辑在原行保存，不覆盖输入框草稿；并发编辑冲突或消息已经执行时保留尚未保存的文字。引导会中断模型生成并在同一轮任务中续跑，已显示文字保留并标记“已按新指令调整”。正在执行的工具先完成，同批未开始的工具和待审批操作跳过；不自动重跑已执行工具。生效前显示“引导中…”，并暂停对此消息的其他操作。

- 当前回复期间可继续按 Enter 或点击“加入队列”提交消息，多条消息按顺序在前一轮运行与保存完成后自动发送。输入框上方展示待发送列表，可逐条移除；停止生成只停止当前回复，后续队列继续。队列由服务端持有，与 CLI 同步，切换会话、刷新网页或断开客户端后仍保留；完整重启服务端会中断未执行消息。会话保存失败或执行状态不明时暂停后续消息，保留队列供查看和移除。

- 首次发送有效消息后异步生成会话标题，复用当前模型、每个新会话至多请求一次，不影响正文回复。侧栏在生成期间显示单行骨架屏，8 秒超时或失败后统一显示“新对话”；未发送草稿和空标题也使用“新对话”。生成标题经 SSE 同步并保存，恢复历史保持原有标题。

- 左侧展示 AlphaCode 品牌、会话搜索、可折叠文件夹与当前会话高亮；支持按会话标题、文件夹名及路径搜索。
- 采用冷银／石墨工作台：常规侧栏总宽 264px（248px 磨砂表面），收起为 72px（56px 图标轨）；外壳间距 8px、圆角 14px，正文和输入区保持实色。窗口 header 横跨侧栏和内容区，高 36px，左上角提供会话、Skills 市场和设置共用的后退／前进按钮；桌面端保留标题栏拖拽区域并避开系统窗口按钮。内容区工具栏高 44px，显示当前页面标题；输入区最大 680px。小于 768px 的浏览器使用 44px 窗口 header、288px 抽屉和 52px 内容区工具栏。新对话输入框上方展示当前文件夹与“此计算机”，开始对话后隐藏；侧栏底部为设置入口。输入框下方不显示文件夹、保存提示或“继续会话”列表，已有对话从侧栏或会话搜索打开；会话右上角保留列表式摘要按钮，面板默认收起，展开后展示路径、消息数量与草稿附件。
- 从 CLI `/web` 打开时按 `?session=<id>` 选中当前会话；切换会话同步更新 URL，支持刷新和浏览器前进/后退。没有 session 参数或 CLI 尚未开始对话时进入新会话首页，不保存空会话，也不在侧栏放置空白占位；CLI 草稿继续共享同一 runtime。品牌栏不显示新建按钮，项目分组的加号打开本地输入页；输入文字或添加附件后才显示“新对话”草稿，清空后隐藏，首次发送有效消息时保存会话。空白草稿会复用，已编辑的草稿保留在原项目下，发送后不留下空占位。发送并创建真实会话后使用服务端标题。Ctrl/⌘ + K 打开搜索。
- 使用官方 AI Elements 的 Chat / Message / Prompt Input 模式：Message Scroller 独立滚动、用户 Bubble 右对齐、助手回复平铺。每轮 AI 回复结束后，仅最后一个非空正文块提供复制按钮，中间过程不显示；用户消息和代码保留独立复制。
- 回复过程沿用官方 AI Elements Chain of Thought / Trace：发送即显示等待状态，思考、流式回复、保存与停止共用消息列表末尾的状态区，始终位于正文下方；连续工具步骤在运行中自动展开，结束后收起，并尊重手动展开选择。状态来自实际会话快照，支持停止、审批和断线提示。
- 加载图标与 TUI 使用相同的圆环 / ∞ 变形路径和五秒循环；断线或减少动态效果模式下保持静止。工具记录跨轮保留，历史恢复包含所有轮次的工具调用与结果；已保存的数据不需要迁移。
- 点击“搜索会话”或按 Ctrl/⌘ + K 打开独立搜索弹窗，搜索所有已登记项目的会话标题、路径及完整消息正文，包含未打开的历史会话。使用 [cmdk](https://github.com/dip/cmdk) 的 Command、Input、List、Group、Item、Empty 和 Loading，配合 Radix Dialog 管理弹窗焦点；设置 `shouldFilter={false}` 保留服务端全文匹配结果。视觉样式适配 [cmdk 官方 Vercel 示例](https://github.com/dip/cmdk/blob/main/website/styles/cmdk/vercel.scss)，在 `session-search.css` 保留来源与 MIT 声明：640px 最大宽度、分组标题、最近会话项目标签和选中项 Enter 键帽，列表按内容收缩并在 330px 后滚动；移动端随视口收缩，沿用现有浅色/深色主题。全文结果行展开显示路径和高亮命中片段，不保留旧说明页脚；每个会话最多预览三条匹配消息，同时显示匹配消息总数。支持上下方向键选择、Enter 打开、Esc 关闭、加载/无结果/失败重试；输入时防抖并取消过期请求，不再筛选侧栏导航。
- Markdown 使用 `react-markdown` 与 `remark-gfm` 随实时快照增量渲染，保留默认 URL 安全处理并跳过原始 HTML。Code Block 使用 Shiki 按需加载高亮引擎及语言，未知语言或加载失败显示原文；表格和代码块局部横向滚动。
- 桌面侧栏支持按钮与 Ctrl/⌘ + B 折叠为图标轨，保留新建、搜索、Skills、项目和设置入口；项目图标展开侧栏后恢复键盘焦点。桌面宽度使用 220ms CSS 过渡，移动 Sheet 抽屉与搜索使用 Motion；选中会话后关闭抽屉，支持中途反向操作与系统减少动态效果偏好。Motion 功能异步加载，相关参数集中在 `src/lib/motion.ts`。
- **已接入真实服务端对话**：通过同源 GET 读取项目与会话历史，订阅全局 `/api/events` 更新列表、订阅当前 `/api/sessions/:id/events` 实时更新回复与工具状态。Web 与 CLI 打开同一会话时使用同一个 runtime，任一端发送、取消或审批都会同步到另一端。切换会话释放旧订阅，各会话缓存独立；旧 GET 或 SSE 快照不能覆盖同一 server 的较新 sequence。
- SSE 断线会自动退避重连并读取全量快照，重连期间保留内容与草稿、禁用发送。45 秒无数据重建连接；401/403/404 停止自动重试。列表事件合并刷新，15 秒轮询作为列表及断线历史的兜底。页面不显示手动刷新按钮，加载失败时仍可重试。
- 用户和助手消息沿用 Markdown 渲染，不重复显示说话人名称；复制入口位于正文下方，助手靠左、用户靠右。空正文的工具调用消息不占位。连续工具记录合并成活动组，历史默认折叠，实时执行自动展开；摘要保留数量及失败、待审批等状态，展开后按原顺序查看各条记录的命令、路径、退出码、输出和错误。工具记录左侧按操作类型显示图标，区分文件读取、创建、编辑、目录浏览、搜索、Skill 和命令执行；实际执行中显示加载动画，右侧文字显示执行状态。工具失败和结果未知使用普通中性色展示，仍保留状态文字、退出码和错误详情。会话快照刷新保留手动展开状态。加载、空列表、空历史、会话不存在、请求失败均有独立状态和重试入口；刷新失败时保留旧数据并提示。
- 从侧栏项目分组新建草稿，首次发送时通过 `POST /api/sessions` 在该项目创建真实会话，然后提交消息。Enter 发送、Shift+Enter 换行，输入法确认不触发提交；运行中可编辑下一条草稿、停止生成或处理工具审批。发送结果不明时保留原请求 ID 与原文，点击“重试发送”由服务端去重；收到 admission 回执不代表执行成功，结果以会话状态为准。待重试请求与未发送草稿仅保留在当前页面，刷新后会丢失。附件仍仅作为本页草稿保留，存在附件时提示移除后发送文字，不会静默丢弃附件。示例数据仅用于测试。
- 输入框暂不显示添加附件按钮和 Enter / Shift+Enter 提示；键盘发送与换行行为保持不变。侧栏列表对称预留滚动条空间，选中会话背景的左右留白一致。
- 输入框左下角可切换“请求批准 / 帮我批准 / 完全访问”，权限仅保存到当前会话，并与 CLI 实时同步；新草稿默认请求批准，首次发送前应用选择。断线、运行、关闭或保存期间禁用切换，保存失败保留草稿且不发送。输入区移除重复的“正在运行…”提示，消息区保留实际进度，停止按钮及连接、停止状态仍可用。
- 从侧栏底部「设置」进入独立的 `/settings` 页面，保留工作区侧栏的内容、宽度与折叠状态；设置入口显示当前页高亮。右侧内容区提供设置搜索与常规分组，搜索匹配中英标签、说明和选项名称，支持清空、Esc 恢复及无结果提示。通用页以紧凑行展示偏好设置：正文最大宽 640px，标题 18px，设置行最小高 56px，桌面选择控件高 28px。主题支持浅色、深色和跟随系统，语言支持中文、English 和跟随系统；两项偏好均保存在浏览器。切换到设置或 Skills 市场时，会话页面卸载，父级工作区布局继续保存当前会话、未发送草稿和 SSE 订阅，返回后恢复会话内容。

## 运行与检查

未选择项目的新对话显示“默认工作区”，首次发送通过 `POST /api/sessions` 省略 `projectId`，由服务端使用全局 `defaultWorkspace`（默认 `~/.alphacode/workspace`）并自动创建缺失目录。首页不再隐式选择列表中的第一个项目；用户仍可通过项目选择器指定目录或切回默认工作区。未发送的默认草稿在侧栏的“默认工作区”分组中保留，发送失败也保留草稿。显式项目会话和 CLI `/web` 指定的会话保持其原目录。

在仓库根目录执行，沿用工作区的 Bun 和唯一的 `bun.lock`：

```powershell
bun install --frozen-lockfile
bun run dev:web
bun run build:web
bun run --cwd apps/alphacode-web typecheck
bun run --cwd apps/alphacode-web lint
bun run --cwd apps/alphacode-web test
```

开发服务监听 `http://127.0.0.1:5173`，自动发现或启动共享 App Server，并在 Vite 进程中代理同源 API/SSE，前端不会获得原生 token。可传 `--database <path>` 或 `--port <port>`，端口被占用时不会悄悄切换。保存 React / CSS 后由 Vite HMR 和 React Fast Refresh 自动更新，不显示任何更新横幅或操作；兼容的组件修改保留 React 状态和输入草稿。Vite 需要整页刷新时，会在没有未确认操作且无附件的情况下将文字草稿暂存于当前标签页，恢复后删除（5 分钟有效）。整页刷新和桌面主进程重启不能保证保留所有页面状态。编译错误输出到终端，关闭页面错误浮层。

构建产物位于本包 `dist/`。CLI `/web` 和 Vite preview 使用构建产物，不属于源码 HMR 服务；需要实时开发时使用 `dev:web`（浏览器）或 `dev:app`（Electron）。`/web` 仅在缺少产物时自动构建，后台更新沿用地址、SSE 自动重连；静态入口继续使用版本快照。Vite preview 不代理后端 API。

`/settings` 和 `/skills` 支持直接打开与刷新，也支持带末尾斜杠的路径。App Server 和 Electron 为这些页面返回 `index.html`；缺失静态资源和 API 错误仍按原有规则响应。

浏览器请求不携带原生 token 或 cookie，拒绝重定向，使用 server 现有的同源访问规则。列表覆盖当前数据库中通过页面或 CLI 登记的项目；server 重启导致端口变化时重新运行 `/web`。

## 基础设施

- Tailwind CSS 通过 `@tailwindcss/vite` 接入，入口为 `src/styles.css`；只扫描本应用的 `src/` 与 `index.html`，不需要额外的 PostCSS 或 Tailwind JS 配置。
- shadcn/ui 使用 New York / Neutral、CSS variables 和 Lucide 图标，配置位于 `components.json`。通过固定版本 CLI 按需引入组件，保留项目内源码。AI Elements 当前官方入口已迁入 [shadcn/ui](https://ui.shadcn.com/docs/ai-elements)，不是额外安装一个 `ai-elements` npm 包；来源与局部适配见 `DESIGN.md`。
- `@/*` 映射到本包 `src/*`，TypeScript、Vite 和 Vitest 共用该别名；不要用它引用 CLI 或服务端内部实现。
- `@/lib/utils` 导出 `cn`，使用 shadcn 的 `cn` 包合并条件类名并解决 Tailwind 类名冲突。
- React Router 8.5.1 通过 `BrowserRouter`、嵌套 `Route` 和 `Outlet` 管理会话首页 `/`、设置 `/settings` 和 Skills 市场 `/skills`；页面切换及后退／前进均由 React Router 管理，保留 CLI 的 `?session=<id>` 会话链接。
- `AppProviders` 为每次应用挂载创建独立的 `QueryClient`，重渲染保留缓存。会话查询显式提供请求函数、AbortSignal 和刷新策略；网络/服务端失败自动重试一次，4xx 不自动重试。
- `ThemeProvider` 按官方 Vite 模式控制 `<html>` 的主题和 `color-scheme`，监听系统变化；localStorage 不可用时仍可在当前页面切换。

从仓库根目录添加组件（使用本包固定版本的 shadcn CLI）：

```powershell
bun run --cwd apps/alphacode-web ui:add input card dialog
```

组件从 `@/components/ui/button` 等路径导入，可通过 `className` 覆盖样式。新增依赖继续记录在本包 `package.json` 和根目录唯一的 `bun.lock`，不要另建锁文件。项目统一用 Bun 执行工具；若使用 Node，要求 Node >=22.12.0。

## Skills 市场

从侧栏「Skills 市场」进入独立的 `/skills` 页面。页面按当前项目列出个人和项目的 `.alphacode/skills`、`.agents/skills` 共享目录，以及已配置的 Claude 兼容目录；支持来源筛选、名称/描述/路径搜索、目录查看与刷新。未信任、禁用和被更高优先级同名 Skill 覆盖的条目会保留显示并注明状态。

点击「添加 Skill」可上传 ZIP，或粘贴公开 GitHub 仓库/Skill 文件夹/`SKILL.md` 页面、`skills.sh/<owner>/<repo>/<skill>`、HTTPS ZIP 或 `SKILL.md` 直链。默认安装到个人 AlphaCode 目录，也可选择已启用的项目或共享目录。ZIP 可包含单个 Skill 或多个 Skill 文件夹；目录名按 frontmatter 的 `name` 规范化，保留所属资源文件。直链 `SKILL.md` 仅导入该文件。

安装不会执行脚本或覆盖已有目录。ZIP 最大 10 MB，解压后最多 40 MB、2,048 个条目及 32 个 Skills；拒绝路径穿越、符号链接、重复路径、加密压缩包和保留命令名。链接需为公开 HTTPS 地址，下载和重定向禁止访问本地网络；外部下载遵循服务端的 `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY` 配置，并固定已校验的目标 IP。新 Skills 在创建新会话时加载；已有会话不热更新。项目 Skills 仍需配置 `skills.trustedProjects`，修改配置后需从 CLI 重新连接。

## 目录结构

- `index.html`：HTML 容器。
- `src/index.tsx`：React DOM 挂载入口，引入全局样式与 `AppProviders`。
- `src/app.tsx`：React Router 路由定义、持久工作区布局与共享顶栏，通过 `Outlet` 渲染会话／Skills／设置页面。
- `src/components/desktop-titlebar.tsx`：窗口级 header，承载全局历史导航，并同步桌面系统标题栏配色。
- `src/features/settings/settings-page.tsx`：通用设置中的主题与语言选择。
- `src/components/history-navigation.tsx`：通过 `useNavigate` 返回的 `navigate(-1)` / `navigate(1)` 后退／前进，仅跟踪按钮的可用状态。
- `src/features/sessions/`：浏览器 API 投影、查询、工作区分组、侧栏、历史消息及工具记录视图。
- `src/features/sessions/session-page.tsx`：会话路由页面，从父布局读取工作区状态，展示首页、历史消息、队列、审批与输入区。历史消息视图按需加载，首页不加载 Markdown 和代码高亮引擎。
- `src/features/sessions/use-session-workspace.ts`：由父级工作区布局持有服务端查询与订阅、URL 会话选择、按项目新建本地草稿、独立文本与附件，跨页面切换保留状态。
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

本包保持 React / React DOM 19.3.1，使用 `@vitejs/plugin-react` 构建、React Testing Library 测试。CLI/TUI 与独立本地 App Server 共存；服务和原生客户端通信实现位于 `apps/alphacode-app-server`，Web 继续使用同源 HTTP/SSE。历史方案不代表当前前端已实现的功能。
