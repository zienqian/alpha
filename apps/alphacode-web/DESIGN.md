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
  accent: "#e6ebf2"
  border: "#dce1e9"
  input: "#d1d9e4"
  ring: "#4b7dc4"
  sidebar: "#edf1f6"
  sidebar-foreground: "#343d4b"
  sidebar-accent: "#dce6f4"
  sidebar-accent-foreground: "#28538d"
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
  sidebar-accent-dark: "#304360"
  sidebar-accent-foreground-dark: "#c6ddff"
  sidebar-border-dark: "#394454"
  shell-dark: "#171b22"
  glass-surface-dark: "rgb(38 45 56 / 72%)"
  glass-edge-dark: "rgb(204 222 255 / 9%)"
  destructive-dark: "oklch(0.704 0.191 22.216)"
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
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  2xl: "18px"
  overlay: "12px"
  search: "16px"
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
  skill-status:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.foreground}"
    padding: "2px 6px"
  composer:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.2xl}"
    width: "680px"
---

# Design System: AlphaCode Web

## Overview

**Creative North Star:「安静的开发工作台」**

面向持续阅读、切换项目和操作开发任务的 Operate 工作区。白色内容画布、极浅冷色外壳、石墨深色和少量蓝色建立层级；窄图标轨、轻薄磨砂导航与实色内容画布构成统一外壳。背景层级参考用户提供的 Codex 截图：正文以白色为主，微弱色彩仅留在外框和导航背后。VS Code Modern UI 与 iOS 27 是用户此前提出的视觉参考，不代表复制其产品规范。

本文件按当前实现更新（2026-11-13）。`src/styles.css` 是运行时主题的来源；前言记录复用的实际值，`-dark` 表示 `.dark` 下同名 CSS 变量。阴影、材质、动效、断点与组件预览位于 `.impeccable/design.json`。浏览器与 Electron 共用本包的组件、翻译和主题。

**Key Characteristics:** 紧凑尺度；白色阅读区；外壳微弱渐变；玻璃限于导航和浮层；蓝色强调主要操作、选中与焦点；保留现有功能、文案和 i18n。

## Colors

### Primary

克制的蓝色用于发送、主要操作、链接和键盘焦点；当前项目/会话以 `sidebar-accent` 为底，搭配 `sidebar-accent-foreground`。不以高饱和大色块占据工作区。

### Neutral

`shell` 承托外壳，`background` 是内容画布，`card` 用于输入区，`popover` 用于浮层。正文、次要说明和细边框分别使用 `foreground`、`muted-foreground`、`border`，浅深主题保持同一语义关系。选中文字、光标及原生滚动条跟随主题。错误提示使用 `destructive`；工具失败和未知结果仍以中性文字、图标及真实退出码表达。权限模式等现有业务状态色保持组件语义。

浅色外壳使用自上而下的微弱 `shell-gradient`（`#f1f4f9 → #f5f8fb → #edf5fc`），标题栏使用同色起点以自然衔接；渐变只透过侧栏和外围留白显现。会话、设置、技能页面的内容画布与输入框使用白色实底，移动端正文同样保持白色，不铺设整页蓝色渐变。深色主题将 `shell-gradient` 置为 `none`，沿用石墨底色。

内容顶栏直接使用 `background`，不再单独混入外壳颜色。原生窗口按钮与窗口标题栏共用 `shell` 底色，挂载、切换主题及开发样式热更新后均同步，避免最小化、最大化和关闭按钮形成异色块。

## Typography

使用系统无衬线字体栈，中文跟随苹方或微软雅黑，路径和代码使用等宽字体。标题保持中等字重，不引入营销型大字或额外展示字体。

页面标题使用 `headline`，会话正文和桌面编辑器使用 `body`，导航及顶栏使用 `navigation`，按钮说明使用 `label`，项目标签与工具状态使用 `metadata`。品牌为半粗体（14px）；搜索输入桌面（17px）、窄屏（16px）。触屏编辑器与普通输入控件保留 `input-mobile`，避免浏览器自动放大。

## Layout

- 桌面侧栏占位（264px），内含磨砂导航（248px）与两侧间距（各 8px）；收起后占位（72px），内含图标轨（56px）。折叠按钮位于侧栏品牌栏右侧，收起后位于图标轨顶部；收起保留新对话、搜索、Skills、项目、语言与主题入口。移动端在内容顶栏保留抽屉入口。
- 画布距顶部、右侧、底部各留（8px），与侧栏内表面间距同为（8px）。品牌栏与会话/Skills 顶栏为（44px）；顶栏只显示页面标题与必要操作。
- 新对话和历史正文共用内容宽度（680px）。历史外层最大（744px），桌面左右留白（32px），窄屏左右留白（20px）。历史独立滚动，输入区固定在下方；新对话入口在弹性网格中略高于垂直中心。Skills 内容容器最大（896px）。
- 桌面项目标题行（28px）、会话行（32px）；窄屏分别为（32px）和（36px）。长项目名和会话标题单行截断，尾部操作预留空间，悬停不挤动文本。
- 小于（768px）使用抽屉导航（288px）；画布取消外边距、外圆角及投影，顶栏增至（52px），顶栏和导航底部按钮至少（36px）。搜索在小于（640px）时调整输入和结果留白。
- 纵向滚动工具类与原生 textarea 保留稳定滚动条空间；历史、提示及输入区共用对齐线。展开侧栏列表对称预留 gutter，图标轨隐藏滚动条但仍可滚动。长代码与表格局部横向滚动。

## Elevation & Depth

**局部玻璃规则。** 正文画布、代码、表单控件和输入框保持实色。磨砂仅用于侧栏、移动抽屉、菜单、摘要和搜索弹层，以文字对比度和边界清晰为先。

导航使用 `glass-surface`，模糊与饱和度（24px / 135%），无外描边，以带 1px 柔化的顶部内高光建立材质，避免转角出现硬亮线。菜单与摘要使用接近实色的 popover 混色（92%）、模糊（20px / 130%）；搜索使用（94%）与（24px / 130%）。微弱渐变仅用于浅色外壳，不添加装饰性光斑。

阴影分为导航 `glass-shadow`、画布 `surface-shadow`、输入区 `composer-shadow`、浮层 `overlay-shadow`，精确值见 sidecar。缺少 backdrop-filter 或请求减少透明度时，导航回退至实色 `sidebar`。

桌面宽度使用 CSS（220ms，`cubic-bezier(0.2, 0.8, 0.2, 1)`），默认展开不播放首屏动画。Motion 的 LazyMotion / domAnimation 负责移动抽屉和搜索：抽屉使用高阻尼弹簧并以（180ms）退场；搜索入场（180ms）、退场（120ms），轻微缩放与至多（4px）位移。分组/工具折叠沿用 CSS 高度动画（展开 160ms、收起 120ms）。消息正文和流式增量不播放入场动画。

`MotionConfig reducedMotion="user"` 与 CSS reduced-motion 共同尊重系统偏好。Radix 保留焦点、Escape 及遮罩行为；桌面收起导航时将必要焦点交还侧栏顶部按钮，关闭移动抽屉时交还内容顶栏入口。圆环 → ∞ → 反向圆环的加载图标保持（5s）循环，断线及减少动态效果时静止。

## Shapes

基础圆角由 CSS `--radius`（10px）派生。普通控件使用 `md`，导航图标按钮使用 `lg`；导航、画布和用户消息使用 `xl`；输入区使用 `2xl`。菜单/摘要使用 `overlay`，搜索使用 `search`。移动抽屉仅右侧圆角（18px）；发送按钮为圆形。减少无意义分割线，以表面色阶、对齐和留白组织内容。

实色区域的有限半径圆角共用 `--corner-shape: superellipse(1.3)`，让直边更平缓地过渡到弧线，并由浏览器统一绘制背景、边框、阴影和裁切。不支持 `corner-shape` 的浏览器保留普通圆角。当前 Electron 渲染器将非圆弧曲线与 `backdrop-filter` 叠用时会丢失背景模糊，因此导航、抽屉、菜单、摘要和搜索等磨砂表面显式使用 `corner-shape: round`。圆形与胶囊使用 `rounded-full`（纯 CSS 组件显式设置 `corner-shape: round`），避免变成圆角方块；桌面窗口最外侧四角仍由系统绘制。

## Components

- **品牌图标：** 使用 ALFI 的二维专注微笑形象，保留白色头部、蓝围巾和下划线光标。侧栏品牌栏显示 28px 图标，与 AlphaCode 名称并排，深浅主题保持同一配色；图标是装饰内容，不重复朗读品牌名称。浏览器 favicon、移动书签和 Electron 图标使用同一图稿的各尺寸导出，资源位于 `public/icons`。
- **按钮与焦点：** 工具栏 `icon-sm`（28px / 14px 图标），文字 `sm`（28px / 12px 字号）；复制 `icon-xs`（24px / 12px 图标）；图标轨操作（36px / 16px 图标）。复用 Button 的主要、次要、描边和幽灵变体，不逐处覆盖尺度。键盘焦点环（2px），禁用状态降低透明度并阻止操作。
- **导航：** 搜索独占一行，品牌栏不重复新建操作。项目整行可折叠，无树状连线或展开箭头；新建按钮在悬停或焦点进入时出现。选中会话使用浅蓝底，不叠加内描边；键盘焦点保留独立焦点环。图标轨有 tooltip 和可访问名称，点击项目会展开对应分组并将焦点移至其标题，不更换当前会话。底部只保留语言和主题。Ctrl/⌘ K 搜索，Ctrl/⌘ B 切换侧栏。
- **搜索：** cmdk 弹层最大（640px）、不超过（80dvh），内部留白（8px）；列表随内容收缩，通常上限（330px）。最近会话行至少（48px），全文结果按内容增高，保留项目、路径及命中片段。次要文字混合 muted-foreground 与 foreground（94% / 6%），此处理仅限搜索。没有说明页脚。
- **输入区：** 独立实色表面与柔和阴影，编辑区高（80–192px）。新对话上方显示当前文件夹和“此计算机”，路径在悬停时显示；开始对话后隐藏。输入区下方不重复路径、保存提示或历史列表。所见即所得 Markdown 与历史共用排版，发送内容仍为 Markdown；Enter 发送、Shift+Enter 编辑换行，保留输入法确认。暂不展示附件添加按钮及键盘提示；已有附件仍可移除，并提示移除后发送文字。
- **消息与工具：** 用户消息靠右，助手 Markdown 平铺，不重复说话人名称。复制仅在悬停或键盘聚焦时出现且不改变布局；每轮助手只在最后一个非空正文块显示，生成中及中间步骤不显示。工具用官方 Trace 的紧凑摘要，执行时展开、正文回复或结束后收起，保留用户手动选择；历史可重新展开。只呈现真实工具、数量、状态及输出。
- **状态与上下文：** 思考、回复、停止、保存及断线复用消息尾部状态区；工具执行不重复显示 loading。标题生成期间使用单行固定高度骨架，保留选中、点击与可访问名称；失败或（8s）超时回退“新对话”。摘要默认关闭，显示真实路径、消息数量、类型及附件，提供路径复制。队列、权限、审批、重试和 Skills 筛选保留原有功能与翻译。

组件来源保持项目内 shadcn/ui New York / Neutral 基础及官方 AI Elements 组合：
[Chat](https://ui.shadcn.com/docs/ai-elements/radix/chat)、[Message](https://ui.shadcn.com/docs/ai-elements/radix/message)、[Prompt Input](https://ui.shadcn.com/docs/ai-elements/radix/prompt-input)、[Chain of Thought](https://ui.shadcn.com/docs/ai-elements/radix/chain-of-thought)、[Trace](https://ui.shadcn.com/docs/components/radix/trace)、[Sidebar](https://ui.shadcn.com/docs/components/radix/sidebar)、[Vite 深色主题](https://ui.shadcn.com/docs/dark-mode/vite)。Neutral 是 registry 来源，当前颜色以本包主题为准。`ui/message`、`message-scroller`、`bubble`、`input-group`、`empty`、`dropdown-menu` 由固定版本 CLI 引入；代码块与高亮 hook 来自官方 Radix Rhea registry，适配 import、Lucide 和主题。搜索保留 [cmdk Vercel 示例](https://github.com/dip/cmdk/blob/main/website/styles/cmdk/vercel.scss)的来源与 MIT 声明。早期 T3 Code、OpenCode、Lobe UI 仅为交互研究来源，视觉决策以本文件为准。

## Do's and Don'ts

- **Do** 在 Web 包维护共享视觉，复用语义变量、Button 尺度、i18n 及数据流；更新后核对浅深主题、展开、图标轨、移动抽屉和搜索。
- **Do** 保留键盘入口、焦点返回、长文本截断、稳定滚动空间与 reduced-motion；检查草稿、队列、历史、上下文和 Skills 交互。
- **Don't** 把收起侧栏变成完全消失的导航，或把玻璃扩展到正文、代码和输入区。
- **Don't** 为视觉效果伪造模型、分支、执行状态或工具结果；真实服务端/SSE、独立草稿、附件限制及自动标题行为以实现和 README 为准。
- **Don't** 沿用旧版固定 240px 侧栏、纯黑白主操作、无外壳圆角或桌面弹簧宽度动画规则。
