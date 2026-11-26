---
name: AlphaCode Web
description: 统一的 shadcn/ui Neutral + AI Elements 开发工作台：纯中性 OKLCH 色阶、克制发丝边框与色阶分层、AI Elements 原生组合（Message / Bubble / PromptInput / Attachment / Trace / CodeBlock / Item / Context / Empty）、Inter + Geist Mono 字体排版与物理微动效。
colors:
  shell: "oklch(0.978 0 0)"
  background: "oklch(1 0 0)"
  foreground: "oklch(0.145 0 0)"
  card: "oklch(1 0 0)"
  popover: "oklch(1 0 0)"
  primary: "oklch(0.205 0 0)"
  primary-hover: "oklch(0.29 0 0)"
  primary-foreground: "oklch(0.985 0 0)"
  secondary: "oklch(0.962 0 0)"
  muted: "oklch(0.962 0 0)"
  muted-foreground: "oklch(0.5 0 0)"
  accent: "oklch(0.938 0 0)"
  border: "oklch(0.915 0 0)"
  separator: "oklch(0.925 0 0)"
  input: "oklch(0.865 0 0)"
  ring: "oklch(0.68 0 0)"
  destructive: "oklch(0.53 0.195 24)"
  status-warning: "oklch(0.465 0.098 62)"
  status-success: "oklch(0.455 0.112 154)"
  shell-dark: "oklch(0.145 0 0)"
  background-dark: "oklch(0.175 0 0)"
  foreground-dark: "oklch(0.965 0 0)"
  card-dark: "oklch(0.205 0 0)"
  popover-dark: "oklch(0.215 0 0)"
  primary-dark: "oklch(0.922 0 0)"
  primary-foreground-dark: "oklch(0.175 0 0)"
  muted-dark: "oklch(0.242 0 0)"
  muted-foreground-dark: "oklch(0.768 0 0)"
  accent-dark: "oklch(0.268 0 0)"
  border-dark: "oklch(1 0 0 / 10%)"
  destructive-dark: "oklch(0.577 0.21 24)"
typography:
  sans: '"Inter", -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
  mono: '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
  display: { fontSize: "1.625rem", lineHeight: 1.2, fontWeight: 600, letterSpacing: "-0.025em" }
  title: { fontSize: "1.375rem", lineHeight: 1.28, fontWeight: 600, letterSpacing: "-0.022em" }
  heading: { fontSize: "1rem", lineHeight: 1.35, fontWeight: 600, letterSpacing: "-0.015em" }
  body: { fontSize: "0.9375rem", lineHeight: 1.62, fontWeight: 400 }
  ui: { fontSize: "0.8125rem", lineHeight: 1.4, fontWeight: 400 }
  caption: { fontSize: "0.75rem", lineHeight: 1.45, fontWeight: 400 }
  micro: { fontSize: "0.6875rem", lineHeight: 1.35, fontWeight: 500 }
---

# Design System: AlphaCode Web

## Overview

**Creative North Star:「统一的 shadcn/ui AI Elements 开发工作台」**

严格对齐官方 [shadcn/ui AI Elements](https://ui.shadcn.com/docs/ai-elements/radix/chat)（`radix-rhea` + `neutral`）设计语言，并贯彻 `jakubkrehel/skills`（`better-colors`、`better-typography`、`better-ui`、`better-layout`、`better-motion`、`better-accessibility`、`better-writing`）的工程细节。全站以零色偏纯中性 OKLCH 色阶、克制发丝边框、色阶分层与原生 AI Elements 组合实现高度融合：侧栏、对话、工具轨迹、审批确认、排队队列、上下文统计、命令搜索、设置与技能市场共用同一套视觉语法。

`src/styles.css` 是运行时设计 Token 的单一真相源；浏览器与 Electron 客户端共用同一套组件、Token、翻译与主题切换逻辑。

## AI Elements Component Mapping

- **Chat & Message (`ui/message-scroller`, `ui/message`, `ui/bubble`, `ai-elements/message`)**：用户消息使用原生 `Bubble variant="muted"`，并作为 `MessageScrollerItem` 的 `scrollAnchor`；助手回复平铺 Markdown，悬停/聚焦时于 `MessageFooter` 呈现复制与 Trace 入口。
- **Prompt Input (`ui/input-group`, `ui/attachment`, `ai-elements/prompt-input`)**：采用 `InputGroup` + `InputGroupAddon` + `InputGroupButton` 组合，附件列表使用 `Attachment size="sm"` 芯片，发送按钮为单色中性圆钮（禁用态为柔和 `bg-muted`）。
- **Chain of Thought & Tool (`ui/trace`, `ui/code-block`, `ui/badge`, `ai-elements/chain-of-thought`, `tool-message`)**：执行摘要与单步工具复用 `Trace` 垂直引导线、`shimmer` 运行态及 `CodeBlock size="sm"` 命令/输出/错误块。
- **Confirmation (`ui/item`, `ui/code-block`, `session-approval`)**：工具审批使用 `Item variant="outline" size="sm"` 配合 `CodeBlock size="sm"` 预览命令及 `Deny` / `Approve` 操作。
- **Queue & Context (`session-queue`, `context-usage`, `ui/progress`)**：排队区以同色系 `rounded-t-2xl bg-muted/50` 无缝衔接输入区；上下文用量沿用 AI Elements `Context` 轻量弹层与中性分层进度条。
- **Empty & Shell (`ui/empty`, `ui/sidebar`, `settings-page`, `skills-market`)**：侧栏采用平铺嵌入式 `bg-sidebar` 与色块高亮 `bg-sidebar-accent`（去除多余悬浮卡片阴影）；空状态统一使用 `Empty` 原语；设置与技能图标、卡片及分段器全部对齐中性色阶体系。

## Colors (Pure Neutral OKLCH)

- **Tier 1 Primitives**：全套零色偏中性灰阶（Chroma = 0，匹配 shadcn/ui `neutral`）与克制状态色阶（Danger 24°、Warning 62°–75°、Success 154°），100% 落于 sRGB 色域内，并经数学测算确保浅/深色正文、次要文字与主按钮均满足 WCAG 2 AA（4.5:1+）与 APCA Lc 要求。
- **Tier 2 Semantic Roles**：主操作统一使用单色中性 `--primary`（浅色深墨 `oklch(0.205 0 0)`、深色亮白 `oklch(0.922 0 0)`）；语义状态色仅用于真实错误、高危警告与成功反馈，不作装饰色滥用。
- **Increased Contrast**：在 `@media (prefers-contrast: more)` 下分别为浅色与深色模式独立提供增强对比度覆盖。

## Typography, Motion & Accessibility

- **字体与排版**：内置可变字体 `Inter` + `Geist Mono`，全 `rem` 尺度、无单位行高、动态数字 `tabular-nums`、移动端输入框 `16px` 下限，Markdown 链接使用克制单色下划线（`decoration-foreground/35`）。
- **克制动效**：`Button` 统一 `0.96` 按压缩放；`ThemeProvider` 切换主题时瞬时禁用过渡以消除拖影；`bounce: 0` 弹簧与不对称进退场；复制按钮采用 `300ms` 缩放+模糊交叉淡入；全面尊重 `prefers-reduced-motion`。
- **无障碍与交互安全**：同步动态 `document.title`、常驻 `aria-live="polite"` 播报区、全弹层 `overscroll-behavior: contain`、纯 CSS `:hover` 统一受 `@media (hover: hover)` 保护。
