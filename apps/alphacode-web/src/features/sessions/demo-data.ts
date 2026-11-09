import type { SessionFolder } from "@/features/sessions/types";

export const demoFolders: SessionFolder[] = [
  {
    id: "alphacode-web",
    name: "alphacode-web",
    path: "apps/alphacode-web",
    sessions: [
      {
        id: "workspace-layout",
        title: "搭建前端工作区",
        description: "从一个清晰的布局开始，专注每一次对话。",
        messages: [
          {
            id: "layout-request",
            role: "user",
            content: "我们先做第一版前端：左侧按文件夹管理 Session，右侧展示 Markdown 消息，整体遵循 **shadcn/ui** 的设计风格。",
          },
          {
            id: "layout-response",
            role: "assistant",
            content: [
              "## 一个简单、专注的工作区",
              "左侧保留项目与会话的上下文，右侧留给内容。选择任意 Session，即可查看对应的消息记录。",
              "### 布局约定",
              "- **品牌区域**：展示 AlphaCode 名称与工作区标识。\n- **文件夹分组**：按项目目录组织 Session，支持展开和收起。\n- **消息列表**：区分你的提问与助手回复，完整呈现 Markdown。",
              "### 组件组成",
              "| 区域 | 组件 | 用途 |\n| :--- | :--- | :--- |\n| 左侧导航 | Sidebar | 品牌、搜索与 Session 列表 |\n| 文件夹 | Collapsible | 展开和收起会话分组 |\n| 顶部路径 | Breadcrumb | 标识当前会话的位置 |\n| 消息正文 | Markdown | 列表、表格与代码块 |",
              "### 开始开发",
              "```bash\nbun run dev:web\nbun run build:web\n```",
              "> 当前是前端布局预览，所有会话均为示例数据，没有连接后端或调用模型。",
              "### 第一版检查清单",
              "- [x] 按文件夹浏览会话\n- [x] 切换会话与搜索标题\n- [x] 渲染 Markdown 内容\n- [ ] 接入真实 Session 与消息接口",
            ].join("\n\n"),
          },
        ],
      },
      {
        id: "markdown-preview",
        title: "Markdown 渲染预览",
        description: "列表、引用、表格与代码，都保持一致的阅读体验。",
        messages: [
          { id: "markdown-request", role: "user", content: "展示一下 Markdown 的常见格式，尤其是嵌套列表和代码。" },
          {
            id: "markdown-response",
            role: "assistant",
            content: [
              "## Markdown 格式预览",
              "正文支持 **重点强调**、*斜体*、~~删除线~~，以及 `inline code`。",
              "### 有序与嵌套列表",
              "1. 选择工作目录\n2. 打开一个 Session\n   - 阅读用户消息\n   - 查看助手回复\n3. 继续你的开发工作",
              "### 代码块",
              "```tsx\nexport function Welcome() {\n  return <h1>Hello, AlphaCode</h1>;\n}\n```",
              "> 好的界面让内容成为主角。",
              "---",
              "了解更多：[shadcn/ui 文档](https://ui.shadcn.com/docs)。",
            ].join("\n\n"),
          },
        ],
      },
      {
        id: "navigation-states",
        title: "整理导航交互",
        description: "让每个会话都有清晰的位置。",
        messages: [
          { id: "navigation-request", role: "user", content: "左侧导航需要有哪些基础交互？" },
          { id: "navigation-response", role: "assistant", content: "## 基础交互\n\n- 点击文件夹，展开或收起 Session 列表。\n- 搜索会话标题、文件夹名称或路径。\n- 点击 Session，同步更新路径和右侧内容。\n- 点击顶部侧栏按钮，隐藏或显示导航。\n\n在窄屏设备上，导航以抽屉打开，选择会话后自动收起。" },
        ],
      },
    ],
  },
  {
    id: "docs",
    name: "docs",
    path: "docs",
    sessions: [
      {
        id: "project-notes",
        title: "项目说明与约定",
        description: "记录开发工作区的基础约定。",
        messages: [
          { id: "notes-request", role: "user", content: "帮我整理一下当前前端的开发约定。" },
          { id: "notes-response", role: "assistant", content: "## 开发约定\n\n1. UI 组件放在 `src/components/ui`，按需引入。\n2. 会话类型与视图放在 `src/features/sessions`。\n3. 使用主题变量，不在业务组件里硬编码颜色。\n4. 浏览器代码不直接依赖服务端内部实现。\n\n> 示例数据与视图分离，后续可用真实接口替换。" },
        ],
      },
      {
        id: "integration-plan",
        title: "后续接口接入计划",
        description: "先稳定布局，再接入真实数据。",
        messages: [
          { id: "integration-response", role: "assistant", content: "## 接入计划\n\n- [ ] 获取工作目录与 Session 列表\n- [ ] 按 Session 获取历史消息\n- [ ] 增加加载、失败与重试状态\n- [ ] 接入消息发送与流式回复\n\n以上为后续计划，当前预览不发起 API 请求。" },
        ],
      },
    ],
  },
  {
    id: "example-agent",
    name: "example-agent",
    path: "apps/example-agent",
    sessions: [
      { id: "empty-session", title: "待开始的会话", description: "一个空白的开始。", messages: [] },
    ],
  },
];
