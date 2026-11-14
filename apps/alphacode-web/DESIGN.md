---
name: AlphaCode Web
description: 克制的开发工作台，白色内容画布、极浅冷色外壳与石墨深色，局部磨砂导航。
colors:
  primary: "#3269be"
  primary-foreground: "#ffffff"
  background: "#ffffff"
  foreground: "#252a34"
  card: "#ffffff"
  popover: "#f9fafc"
  secondary: "#e9edf3"
  muted: "#eef1f5"
  muted-foreground: "#616c7b"
  accent: "#e6e6e6"
  border: "#dce1e9"
  input: "#d1d9e4"
  ring: "#4b7dc4"
  sidebar: "#edf1f6"
  sidebar-foreground: "#343d4b"
  sidebar-accent: "#e6e6e6"
  sidebar-accent-foreground: "#252a34"
  sidebar-border: "#d8e0eb"
  shell: "#f1f4f9"
  glass-surface: "rgb(255 255 255 / 72%)"
  glass-edge: "rgb(255 255 255 / 80%)"
  destructive: "oklch(0.577 0.245 27.325)"
  primary-dark: "#8bb7f4"
  primary-foreground-dark: "#18263b"
  background-dark: "#202329"
  foreground-dark: "#e7ebf1"
  card-dark: "#282d35"
  popover-dark: "#292e37"
  secondary-dark: "#303743"
  muted-dark: "#2b3039"
  muted-foreground-dark: "#a3adbc"
  accent-dark: "#343d4b"
  border-dark: "#363e4a"
  input-dark: "#465161"
  ring-dark: "#8bb7f4"
  sidebar-dark: "#222730"
  sidebar-foreground-dark: "#d7dfeb"
  sidebar-accent-dark: "#343d4b"
  sidebar-accent-foreground-dark: "#e7ebf1"
  sidebar-border-dark: "#394454"
  shell-dark: "#171b22"
  glass-surface-dark: "rgb(38 45 56 / 72%)"
  glass-edge-dark: "rgb(204 222 255 / 9%)"
  destructive-dark: "oklch(0.704 0.191 22.216)"
  search-surface: "#f4f4f4"
  search-text: "#666666"
  search-secondary: "#858585"
  search-selected: "#e6e6e6"
  search-key: "#e5e5e5"
typography:
  headline:
    fontSize: "22px"
    fontWeight: 500
    lineHeight: "32px"
    letterSpacing: "-0.025em"
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "14px"
    lineHeight: "24px"
  navigation:
    fontSize: "13px"
  label:
    fontSize: "12px"
  metadata:
    fontSize: "11px"
  input-mobile:
    fontSize: "16px"
    lineHeight: "24px"
  search-input:
    fontSize: "15px"
    lineHeight: "24px"
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  2xl: "18px"
  overlay: "12px"
  search: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    height: "28px"
    padding: "0 10px"
    typography: "{typography.label}"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    rounded: "{rounded.md}"
    height: "28px"
    padding: "0 10px"
    typography: "{typography.label}"
  button-ghost:
    rounded: "{rounded.md}"
    height: "28px"
    padding: "0 10px"
    typography: "{typography.label}"
  button-outline:
    backgroundColor: "{colors.background}"
    rounded: "{rounded.md}"
    height: "28px"
    padding: "0 10px"
    typography: "{typography.label}"
  input:
    rounded: "{rounded.md}"
    height: "36px"
    padding: "4px 12px"
  navigation-active:
    backgroundColor: "{colors.sidebar-accent}"
    textColor: "{colors.sidebar-accent-foreground}"
    rounded: "{rounded.md}"
    height: "32px"
    typography: "{typography.navigation}"
  skill-entry:
    textColor: "{colors.foreground}"
    rounded: "{rounded.2xl}"
    padding: "8px"
  skill-icon:
    rounded: "{rounded.xl}"
    size: "40px"
  skill-add:
    backgroundColor: "{colors.foreground}"
    textColor: "{colors.background}"
    rounded: "9999px"
    height: "32px"
    padding: "0 12px"
    typography: "{typography.label}"
  composer:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.2xl}"
    width: "680px"
  search-dialog:
    backgroundColor: "{colors.search-surface}"
    textColor: "{colors.search-text}"
    rounded: "{rounded.search}"
    width: "min(760px, calc(100% - 2rem))"
  search-input-row:
    height: "52px"
    padding: "8px 12px"
    typography: "{typography.search-input}"
  search-item:
    textColor: "{colors.search-text}"
    rounded: "{rounded.sm}"
    height: "35px"
    padding: "6px 10px"
---

# Design System: AlphaCode Web

## Overview

**Creative North Star:「安静的开发工作台」**

面向持续阅读、切换项目和操作开发任务的 Operate 工作区。白色内容画布、极浅冷色外壳、石墨深色和少量蓝色建立层级；窄图标轨、轻薄磨砂导航与实色内容画布构成统一外壳。背景层级参考用户提供的 Codex 截图：正文以白色为主，微弱色彩仅留在外框和导航背后。VS Code Modern UI 与 iOS 27 是用户此前提出的视觉参考，不代表复制其产品规范。

本文件按当前实现更新（2026-11-13）。`src/styles.css` 是运行时主题的来源；前言记录复用的实际值，`-dark` 表示 `.dark` 下同名 CSS 变量。阴影、材质、动效、断点与组件预览位于 `.impeccable/design.json`。浏览器与 Electron 共用本包的组件、翻译和主题。

**Key Characteristics:** 紧凑尺度；白色阅读区；外壳微弱渐变；玻璃限于导航和浮层；蓝色强调主要操作、选中与焦点；保留现有功能、文案和 i18n。

## Colors

### Primary

克制的蓝色用于发送、主要操作、链接和键盘焦点。搜索弹窗、侧栏会话、设置和 Skills 入口的选中态共用 `accent`：浅色为中性灰（#e6e6e6），深色为石墨色（#343d4b），选中文字使用 `foreground`；`sidebar-accent` 和 `search-selected` 引用同一变量。

### Neutral

`shell` 承托外壳，`background` 是内容画布，`card` 用于输入区，`popover` 用于浮层。正文、次要说明和细边框分别使用 `foreground`、`muted-foreground`、`border`，浅深主题保持同一语义关系。选中文字、光标及原生滚动条跟随主题。错误提示使用 `destructive`；工具失败和未知结果仍以中性文字、图标及真实退出码表达。权限模式等现有业务状态色保持组件语义。

浅色外壳使用自上而下的微弱 `shell-gradient`（`#f1f4f9 → #f5f8fb → #edf5fc`），标题栏使用同色起点以自然衔接；渐变只透过侧栏和外围留白显现。会话、设置、技能页面的内容画布与输入框使用白色实底，移动端正文同样保持白色，不铺设整页蓝色渐变。深色主题将 `shell-gradient` 置为 `none`，沿用石墨底色。

内容顶栏直接使用 `background`，不再单独混入外壳颜色。原生窗口按钮与窗口标题栏共用 `shell` 底色，挂载、切换主题及开发样式热更新后均同步，避免最小化、最大化和关闭按钮形成异色块。

搜索弹层在浅色主题使用局部中性灰：`search-surface` 承托面板，`search-text` 用于行文字、输入提示、命中数量、路径、片段与状态，`search-secondary` 用于分组、项目名和装饰图标，`search-selected` 引用全局 `accent` 表示选中行，`search-key` 承托快捷键。深色主题分别复用 `popover`、`popover-foreground`、`muted-foreground`、`accent` 和 `muted`。

## Typography

使用系统无衬线字体栈，中文跟随苹方或微软雅黑，路径和代码使用等宽字体。标题保持中等字重，不引入营销型大字或额外展示字体。

页面标题使用 `headline`，会话正文和桌面编辑器使用 `body`，导航及顶栏使用 `navigation`，按钮说明使用 `label`，项目标签与工具状态使用 `metadata`。品牌为半粗体（14px）；搜索输入桌面使用 `search-input`，窄屏使用 `input-mobile`。触屏编辑器与普通输入控件保留 `input-mobile`，避免浏览器自动放大。

## Layout

- 桌面侧栏占位（264px），内含磨砂导航（248px）与两侧间距（各 8px）；收起后占位（72px），内含图标轨（56px）。折叠按钮位于侧栏品牌栏右侧，收起后位于图标轨顶部；收起保留新对话、搜索、Skills、项目、语言与主题入口。小窗口保留侧栏，沿用顶部按钮手动折叠。
- 展开侧栏的品牌、导航、项目/会话和底部区域共用 `--sidebar-inset`（12px）左右留白；品牌文字、导航文字、项目名和会话标题共用距内表面（48px）的文字对齐线。导航行内边距（12px）、16px 图标与（8px）间距组成同一文字列；会话行左内边距（36px）。窄侧栏沿用相同对齐规则，长标题截断。
- 画布距顶部、右侧、底部各留（8px），与侧栏内表面间距同为（8px）。品牌栏与会话/Skills 顶栏为（44px）；顶栏只显示页面标题与必要操作。
- 新对话和历史正文共用内容宽度（680px）。历史外层最大（744px），桌面左右留白（32px），窄屏左右留白（20px）。历史独立滚动，输入区固定在下方；新对话入口在弹性网格中略高于垂直中心。
- Skills 外层最大（964px），桌面左右留白（32px），形成最大（900px）内容宽度；窄屏左右留白（20px）。列表按内容容器宽度切换：达到（640px）时双列，否则单列，列间距（24px）、行间距（12px）。标题与工具栏在内容容器达到（740px）时并排，较窄时上下排列。
- 桌面项目标题行（28px）、会话行（32px）；窄屏分别为（32px）和（36px）。长项目名和会话标题单行截断，尾部操作预留空间，悬停不挤动文本。
- 小于（768px）保留常驻导航，宽度为 clamp(160px, 32vw, 264px)，不自动折叠；画布保留（8px）外边距和应用圆角，分屏超出最低尺寸时内部滚动。顶栏增至（52px），顶栏按钮至少（36px）。搜索在小于（640px）时将输入字号调至（16px）、结果行最小高度增至（40px），右侧项目名最大宽度从（120px）缩至（80px）。
- 纵向滚动工具类与原生 textarea 保留稳定滚动条空间；历史、提示及输入区共用对齐线。展开侧栏列表使用 Radix ScrollArea 的覆盖式滚动条，避免额外 gutter 挤窄会话区域；图标轨隐藏滚动条但仍可滚动。长代码与表格局部横向滚动。

## Elevation & Depth

**局部玻璃规则。** 正文画布、代码、表单控件和输入框保持实色。磨砂仅用于侧栏、移动抽屉、菜单和摘要，以文字对比度和边界清晰为先。搜索弹层使用实色中性表面。

导航使用 `glass-surface`，模糊与饱和度（24px / 135%），无外描边，以带 1px 柔化的顶部内高光建立材质，避免转角出现硬亮线。菜单与摘要使用接近实色的 popover 混色（92%）、模糊（20px / 130%）；搜索保留细边框与 `overlay-shadow`，不使用背景模糊。微弱渐变仅用于浅色外壳，不添加装饰性光斑。

阴影分为导航 `glass-shadow`、画布 `surface-shadow`、输入区 `composer-shadow`、浮层 `overlay-shadow`，精确值见 sidecar。缺少 backdrop-filter 或请求减少透明度时，导航回退至实色 `sidebar`。

桌面宽度使用 CSS（220ms，`cubic-bezier(0.2, 0.8, 0.2, 1)`），默认展开不播放首屏动画。Motion 的 LazyMotion / domAnimation 负责搜索：搜索入场（180ms）、退场（120ms），轻微缩放与至多（4px）位移。分组/工具折叠沿用 CSS 高度动画（展开 160ms、收起 120ms）。消息正文和流式增量不播放入场动画。

`MotionConfig reducedMotion="user"` 与 CSS reduced-motion 共同尊重系统偏好。Radix 保留焦点、Escape 及遮罩行为；手动收起导航时将必要焦点交还侧栏顶部按钮；窗口缩放不切换导航挂载结构。圆环 → ∞ → 反向圆环的加载图标保持（5s）循环，断线及减少动态效果时静止。

## Shapes

基础圆角由 CSS `--radius`（10px）派生。普通控件使用 `md`，导航图标按钮使用 `lg`；导航、画布和用户消息使用 `xl`；输入区使用 `2xl`。菜单/摘要使用 `overlay`，搜索使用 `search`。移动抽屉仅右侧圆角（18px）；发送按钮为圆形。减少无意义分割线，以表面色阶、对齐和留白组织内容。

实色区域的有限半径圆角共用 `--corner-shape: superellipse(1.3)`，让直边更平缓地过渡到弧线，并由浏览器统一绘制背景、边框、阴影和裁切。不支持 `corner-shape` 的浏览器保留普通圆角。当前 Electron 渲染器将非圆弧曲线与 `backdrop-filter` 叠用时会丢失背景模糊，因此导航、抽屉、菜单和摘要等磨砂表面显式使用 `corner-shape: round`；搜索弹层也保留圆弧轮廓。圆形与胶囊使用 `rounded-full`（纯 CSS 组件显式设置 `corner-shape: round`），避免变成圆角方块；桌面窗口最外侧四角仍由系统绘制。

## Components

- **项目选择：** 侧栏“项目”为普通分组标题，旁边的“＋”提供创建入口。新会话输入框上方的项目标签使用下拉选择器，菜单显示名称、完整路径和当前项勾选，末尾提供创建入口；表单沿用实色浮层、语义颜色和控件尺寸，先输入名称，再选择源文件夹。桌面使用原生目录选择器并允许编辑路径；浏览器提供完整路径输入。空项目保留在侧栏，目录错误在表单内提示并保留输入。已有会话的目录不随项目选择改变。
- **工作区操作：** 每个项目标题行右侧保留新建会话“＋”，紧邻三点菜单收纳“删除工作区”；桌面悬停或键盘聚焦时显示，触屏常显，菜单展开时保持可见。删除前确认会关闭该工作区的对话并清除未发送草稿；本地文件和已保存会话保留，重新添加同一目录可恢复历史。运行、排队或保存中保留工作区并显示可重试提示；删除成功后清理相关画布面板，当前会话回到新的默认草稿。

- **品牌图标：** 使用 ALFI 的二维专注微笑形象，保留白色头部、蓝围巾和下划线光标。侧栏品牌栏显示 28px 图标，与 AlphaCode 名称并排，深浅主题保持同一配色；图标是装饰内容，不重复朗读品牌名称。浏览器 favicon、移动书签和 Electron 图标使用同一图稿的各尺寸导出，资源位于 `public/icons`。
- **按钮与焦点：** 常用操作、导航、标题、菜单和输入区图标统一使用 `--spacing-icon`（16px）及 `size-icon`，Button 的 xs/sm 只改变点击区域和文字，不再缩小图标。工具栏 `icon-sm`（28px / 16px 图标）、复制 `icon-xs`（24px / 16px 图标）、图标轨操作（36px / 16px 图标）；文字 `sm` 保持 12px 字号。四向 Chevron 在共享样式中将路径放大 1.5 倍并补偿线宽，保持 16px 外框与文字对齐，可见主轴约 12px；画布不再单独放大 SVG。技能封面 24px、上传示意和单选状态点保留各自语义尺度。复用 Button 的主要、次要、描边和幽灵变体，不逐处覆盖尺度。键盘焦点环（2px），禁用状态降低透明度并阻止操作。
- **导航：** 搜索独占一行，品牌栏不重复新建操作。项目整行可折叠，无树状连线或展开箭头；新建按钮在悬停或焦点进入时出现。选中会话使用与搜索弹窗一致的中性灰底，不叠加内描边；键盘焦点保留独立焦点环。图标轨有 tooltip 和可访问名称，点击项目会展开对应分组并将焦点移至其标题，不更换当前会话。底部只保留语言和主题。Ctrl/⌘ K 搜索，Ctrl/⌘ B 切换侧栏。
- **搜索：** cmdk 弹层最大（760px）、不超过（70dvh），输入行高（52px）。列表高度取内容实测高度加底部留白（8px）与（440px）中的较小值，并受剩余视口高度限制；分组间隔（5px）。快捷操作包含“新聊天”和“打开文件夹”，Ctrl/⌘ N、Ctrl/⌘ O 只在搜索弹层内触发。聊天分组使用紧凑行（最小 35px）、线性图标（16px），项目名以右侧次要文字呈现。输入查询后保留全文命中数量、完整路径提示和命中片段，结果按内容增高；保留现有加载、错误、重试、键盘选择与焦点返回。没有尾部 Enter 图标、说明页脚或未实现的资源分组。
- **Skills 列表：** 沿用现有浅深主题与圆角，按用户提供的 Codex 参考收紧条目。`skill-entry` 行最小高度（64px），悬停使用（70%）`muted`、展开使用（50%）`muted`；`skill-icon` 内为（24px）线性图标。名称使用（13px / 20px）中等字重，说明使用（12px / 20px）次要文字，两者默认单行截断；展开后保留完整说明、来源、路径、可调用方式及异常原因。可用状态使用带可访问名称的勾选图标，异常状态保留图标与文字。
- **Skills 工具栏：** 右上方放置胶囊搜索、刷新、设置与 `skill-add` 添加入口，高度均为（32px）。添加入口使用 `foreground` / `background`，仅为此表面的局部样式；安装表单继续使用共享主要按钮。设置默认收起，展开内联区域后显示项目、来源筛选、目录与诊断；非默认来源筛选保留可见清除入口。共享与 Claude 分组使用轻色胶囊标题，本地分组保留屏幕阅读器标题；搜索、刷新、ZIP / 链接安装、状态与错误提示沿用现有数据流和翻译。
- **输入区：** 独立实色表面与柔和阴影，编辑区高（56–192px），随内容自动增高，顶部内边距（12px）。新对话上方显示当前文件夹和“此计算机”，路径在悬停时显示；开始对话后隐藏。输入区下方不重复路径、保存提示或历史列表。所见即所得 Markdown 与历史共用排版，发送内容仍为 Markdown；Enter 发送、Shift+Enter 编辑换行，保留输入法确认。暂不展示附件添加按钮及键盘提示；已有附件仍可移除，并提示移除后发送文字。
- **消息与工具：** 用户消息靠右，助手 Markdown 平铺，不重复说话人名称。复制仅在悬停或键盘聚焦时出现且不改变布局；每轮助手只在最后一个非空正文块显示，生成中及中间步骤不显示。工具用官方 Trace 的紧凑摘要，执行时展开、正文回复或结束后收起，保留用户手动选择；历史可重新展开。只呈现真实工具、数量、状态及输出。
- **状态与上下文：** 思考、回复、停止、保存及断线复用消息尾部状态区；工具执行不重复显示 loading。标题生成期间使用单行固定高度骨架，保留选中、点击与可访问名称；失败或（8s）超时回退“新对话”。摘要默认关闭，显示真实路径、消息数量、类型及附件，提供路径复制。队列、权限、审批、重试和 Skills 筛选保留原有功能与翻译。

组件来源保持项目内 shadcn/ui New York / Neutral 基础及官方 AI Elements 组合：
[Chat](https://ui.shadcn.com/docs/ai-elements/radix/chat)、[Message](https://ui.shadcn.com/docs/ai-elements/radix/message)、[Prompt Input](https://ui.shadcn.com/docs/ai-elements/radix/prompt-input)、[Chain of Thought](https://ui.shadcn.com/docs/ai-elements/radix/chain-of-thought)、[Trace](https://ui.shadcn.com/docs/components/radix/trace)、[Sidebar](https://ui.shadcn.com/docs/components/radix/sidebar)、[Vite 深色主题](https://ui.shadcn.com/docs/dark-mode/vite)。Neutral 是 registry 来源，当前颜色以本包主题为准。`ui/message`、`message-scroller`、`bubble`、`input-group`、`empty`、`dropdown-menu` 由固定版本 CLI 引入；代码块与高亮 hook 来自官方 Radix Rhea registry，适配 import、Lucide 和主题。搜索保留 [cmdk Vercel 示例](https://github.com/dip/cmdk/blob/main/website/styles/cmdk/vercel.scss)的来源与 MIT 声明。早期 T3 Code、OpenCode、Lobe UI 仅为交互研究来源，视觉决策以本文件为准。

## Do's and Don'ts

- **Do** 在 Web 包维护共享视觉，复用语义变量、Button 尺度、i18n 及数据流；更新后核对浅深主题、展开、图标轨、窄侧栏和搜索。
- **Do** 保留键盘入口、焦点返回、长文本截断、稳定滚动空间与 reduced-motion；检查草稿、队列、历史、上下文和 Skills 交互。
- **Don't** 把收起侧栏变成完全消失的导航，或把玻璃扩展到正文、代码和输入区。
- **Don't** 为视觉效果伪造模型、分支、执行状态或工具结果；真实服务端/SSE、独立草稿、附件限制及自动标题行为以实现和 README 为准。
- **Don't** 沿用旧版固定 240px 侧栏、纯黑白主操作、无外壳圆角或桌面弹簧宽度动画规则。
