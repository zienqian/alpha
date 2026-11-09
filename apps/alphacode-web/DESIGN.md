# AlphaCode Web 设计约定

## 当前方向

紧凑、安静的开发工作台，使用 shadcn/ui New York / Neutral 与官方 AI Elements。用户指出仅缩小尺寸仍不够精致，要求研究开源项目设计。本轮实看 T3 Code、OpenCode 的官方界面图和 Lobe UI 的输入组件，重点改进任务导航、上下文归属及操作层级。当前工作区属于 Operate 模式。

## 开源参考与取舍（2026-11-09）

- [T3 Code](https://t3.codes/)：主参考。任务导航有清楚的文字主次，消息流安静，工作上下文集中在独立面板。AlphaCode 使用紧凑项目分组、按需显现的操作和非模态上下文面板。只显示现有真实数据，不模拟执行状态、分支或工具结果。
- [OpenCode Desktop](https://dev.opencode.ai/desktop)：输入区的模型操作与项目/环境上下文分层。AlphaCode 把工作区选择移到输入框下沿，历史会话就近展示项目路径。
- [Lobe UI ChatInputArea](https://ui.lobehub.com/components/chat/chat-input-area)：参考文字输入、工具操作与辅助信息的分组。保留 shadcn/ui 技术体系，不引入另一套组件库。

对照后的问题：此前标题、说明与通用提示词让首页像组件示例；项目选择远离输入区；常驻复制按钮和分割线缺少主次；上下文只能分散地寻找。本次用已有会话提供任务连续性，以真实路径、消息数量和附件承载上下文。

## 布局与尺度

- 左侧 240px 固定项目导航，右侧完整会话画布。官方 Sidebar 标准边框分区，不使用 inset 大圆角外壳。
- 品牌栏与会话顶栏统一 44px。品牌 14px，图标 18px；顶栏用项目 / 会话的单行路径明确当前位置，右侧上下文入口打开可收起的非模态面板。
- 全局新建入口收进品牌栏，搜索独占一行；项目分组内可直接创建该项目的草稿。文件夹行 28px / 12px，会话行 32px / 13px，工作区标签 11px。取消树状连线，选中会话使用细边框与背景层差。分组新建与消息复制在桌面悬停/键盘聚焦时显示，触屏常驻。
- 新任务入口左对齐，内容最大 680px；标题 22px，无营销副标题，输入框默认约 124px 高、14px 圆角。当前项目最多三条有消息的会话列于下方，显示真实消息数量并可直接打开。
- 输入文字桌面 14px，触屏 16px 以避免移动浏览器自动放大。附件和发送操作 28px，模型状态 12px。草稿保存限制就近说明。
- 输入框下沿显示项目选择与本地保存提示。上下文面板显示真实路径、消息数量、会话类型、附件和文件大小，提供路径复制；当前未接入的模型和执行功能不伪造。
- 历史消息与输入框共用 680px 内容对齐线；外层含左右 32px 留白，最大 744px。消息独立滚动，输入区留在底部。
- 移动端使用 Sheet 导航和更宽的触控空间，标题保持 22px；隐藏冗余路径，容器随视口收缩。长代码与表格局部滚动。

## 视觉语言

官方中性黑白色阶，浅灰侧栏、白色主画布；深色模式延续同一套语义变量。普通控件 6–8px 圆角，消息气泡 12px，输入区 14px。减少横向分割线，使用表面色阶、字重、对齐和局部留白建立层级；浮层保留原生边框与投影。键盘焦点、滚动条、选中文字与输入光标均跟随主题。动画仅用于状态转换，并尊重 reduced motion。

## 交互与产品事实

默认本地新会话；历史示例按需打开。搜索、文件夹折叠、新建草稿、项目选择、附件添加/移除和主题切换均可操作。Ctrl/⌘ K 搜索，Ctrl/⌘ B 折叠导航。每个会话保有独立的文本和附件，刷新后丢失。没有服务端或模型连接，发送明确禁用，不模拟回复、执行结果或账户信息。

保留官方 AI Elements 的 Message、Bubble、Message Scroller 和 Prompt Input 组合；历史渲染器、Markdown 和语法高亮按需加载。支持安全 Markdown、代码复制及复制失败反馈。

## 官方来源

2026-11-09 核对：AI Elements 已迁入 shadcn/ui，组件以官方组合模式使用。

- https://ui.shadcn.com/docs/ai-elements
- https://ui.shadcn.com/docs/ai-elements/radix/chat
- https://ui.shadcn.com/docs/ai-elements/radix/message
- https://ui.shadcn.com/docs/ai-elements/radix/prompt-input
- https://ui.shadcn.com/docs/components/radix/sidebar
- https://ui.shadcn.com/docs/dark-mode/vite

`ui/message`、`message-scroller`、`bubble`、`input-group`、`empty`、`dropdown-menu` 由固定版本 shadcn CLI 安装。New York registry 尚无 Code Block 及高亮 hook，使用官方 Radix Rhea registry 源码，适配 import、Lucide 图标与项目主题。

## 验证

实现后批量检查桌面、移动端、历史会话和深色主题；修改一批发现的问题后至多再确认一次。功能检查覆盖导航、搜索、独立草稿、附件、项目切换、继续会话、上下文面板及键盘操作。
