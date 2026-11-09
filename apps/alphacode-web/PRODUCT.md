# AlphaCode Web

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Purpose

AlphaCode 的浏览器会话工作区，按项目目录浏览 Session 和阅读开发对话。

## Capabilities and Constraints

- 当前数据来自 `src/features/sessions/demo-data.ts`，没有接入服务端或模型。
- 保留项目搜索、文件夹展开收起、会话切换、Markdown 和移动端导航。
- 默认打开本地新会话，可从侧栏项目分组新建草稿，首次发送创建服务端会话。支持文字对话、流式回复、停止及工具审批，与 CLI 同步。输入框下方不显示文件夹和保存提示。未发送文本和 File 对象按会话隔离，刷新丢失；附件暂不上传，含附件时暂停发送并给出提示。主题偏好保存在浏览器。
- React / Vite / Tailwind v4；使用 Bun 和仓库唯一的 `bun.lock`。
- 浏览器不得依赖 CLI / server 内部模块。

## Brand Commitments

用户明确要求 shadcn/ui 官方设计风格及官方 AI Elements，保留 AlphaCode 名称和中文界面。最新指示是放下之前的设计重新组织整个界面，重点解决尺寸过大、缺少精致感；当前方向是紧凑、克制的代码工作台。

## Evidence on Hand

本包 README、当前实现及真实 server 协议。示例数据仅用于自动化测试；真实服务端连接、发送与流式回复已接入。
