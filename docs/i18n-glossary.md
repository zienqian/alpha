# AlphaCode 中英术语表

审校日期：2026-11-13。适用范围：Web、CLI 和 TUI 的界面词典。英文是源语言；同一产品概念在两端使用相同术语，具体句子按语境调整。

## 参考与取舍

| 官方来源 | 核对到的用法 | 本项目选择 |
| --- | --- | --- |
| [VS Code 简体中文词典](https://github.com/microsoft/vscode-loc/blob/main/i18n/vscode-language-pack-zh-hans/translations/main.i18n.json) | `sessionScope` 使用“会话”，`workspaceScope` 使用“工作区”；工具描述使用“读取技能”；命令规则使用“自动审批” | 会话对象统一为 session／会话；沿用工作区、技能和审批用语 |
| [Roo Code 英文词典](https://github.com/RooCodeInc/Roo-Code/blob/main/webview-ui/src/i18n/locales/en/settings.json)、[简体中文词典](https://github.com/RooCodeInc/Roo-Code/blob/main/webview-ui/src/i18n/locales/zh-CN/settings.json) | 使用“提供商”“API 密钥”；模型输出数量保留 Token；审批栏目译为“自动批准”，技能栏目仍保留 Skills | 采用提供商、API 密钥和 Token；审批、技能按本项目规则统一，不照搬其他项目全部译法 |
| [OpenCode V1 技能文档](https://opencode.ai/v1/docs/zh-cn/skills/)、[权限文档](https://opencode.ai/v1/docs/zh-cn/permissions/) | 自然语言使用“技能”“权限”“审批”，文件名和配置值保留 `SKILL.md`、`allow`、`ask`、`deny` | 中文界面使用“技能”，代码标识原样保留；仅参考术语，不采用该项目的权限行为 |
| [OpenTelemetry 中文术语表](https://opentelemetry.io/zh/docs/concepts/glossary/) | Trace 为链路，Span 保留英文，二者表示不同层级的观测数据 | AlphaCode 面向用户的运行明细称“执行记录”；讨论底层 Trace／Span 时保留技术语义，不将执行记录泛称日志 |

社区没有唯一译法。以下是结合 AlphaCode 数据模型、实际行为和现有界面作出的项目约定，不代表所有参考项目都采用相同措辞。

## 标准术语

| 概念 | 英文界面 | 中文界面 | 使用说明 |
| --- | --- | --- | --- |
| 持久化会话及本地会话草稿 | Session | 会话 | 列表、搜索、历史、保存及权限作用域统一使用；不与 conversation、chat 混称同一对象 |
| 未命名会话的标题 | New session | 新会话 | 创建操作使用“新建会话”，标题使用“新会话” |
| 会话中的单条内容 | Message | 消息 | 对话内容所占上下文用量标为 Messages／会话消息 |
| 助手回复 | Reply / Response | 回复 | Reply 用于交互；Response 用于模型响应及其完整性 |
| 工作空间 | Workspace | 工作区 | 不与项目、文件夹、工作目录混用 |
| 项目 | Project | 项目 | 已登记的项目实体 |
| 命令的执行目录 | Working directory | 工作目录 | 界面不用 Workdir、cwd；代码字段保持原样 |
| 智能体 | Agent | 智能体 | 与 Model／模型、Runtime／运行时区分 |
| 模型提供方 | Provider | 提供商 | 不混用“提供方” |
| 模型 | Model | 模型 | 执行记录中的 modelId 不是 Mode／模式 |
| 模型请求 | Model request | 模型请求 | 与 Tool call／工具调用区分 |
| 可复用技能 | Skill / Skills | 技能 | 中文不使用 Skill／Skills；`SKILL.md`、`skills.sh`、`skills.trustedProjects`、`/skills` 保留原样 |
| 权限范围 | Permission | 权限 | 与执行前的 Approval／审批区分 |
| 执行前确认流程 | Approval | 审批 | 流程名、模式名、等待状态用“审批”；批准具体操作时可用动词“批准” |
| 单次许可 | Allow once | 允许一次 | Deny 为“拒绝”，不改写配置枚举 |
| 上下文 | Context | 上下文 | System prompt 为“系统提示词”；Tool definitions 为“工具定义” |
| 模型用量单位 | Token / tokens | Token | 中文不加英文复数 s，不译成身份验证用的“令牌”；英文按句法使用 token／tokens |
| 缓存用量 | Cache read / Cache write | 缓存读取／缓存写入 | 不缩写为“缓存读／缓存写” |
| 认证密钥 | API key | API 密钥 | 环境变量名原样保留 |
| 运行明细 | Execution records | 执行记录 | 面向用户统一名称；底层 trace 字段和命名空间不变 |
| 单次运行 | Run | 运行 | 与整个会话、单次工具调用区分 |
| 工具执行状态 | Running / Completed / Failed | 执行中／已完成／已失败 | 整次运行的 Running 使用“运行中” |
| 结果未获确认 | Outcome unconfirmed | 结果未确认 | 不等同于 Failed／已失败，也不替换一般的 Outcome unknown／结果未知 |
| 排队消息 | Queued message | 排队消息 | Queued 为“排队中”；消息区域可按用途标为“待发送消息” |
| 用新指令调整当前运行 | Steer | 调整方向 | 本项目的解释性译法；提示需说明等待已开始的工具完成，再按新消息继续 |
| 退出状态码 | Exit code | 退出码 | CLI 与 Web 都保留 code 的语义 |
| 草稿与附件 | Draft / Attachment | 草稿／附件 | 不翻译用户填写的内容和附件名称 |

## 审批模式

模式标识与行为以 [permission-policy.ts](../apps/alphacode-app-server/src/runtime/permission-policy.ts) 为准。本轮只调整展示文案。

| 标识 | 英文名称 | 中文名称 | 当前行为 |
| --- | --- | --- | --- |
| `ask` | Ask for approval | 请求审批 | 命令执行前询问，允许工作区文件工具，拒绝自定义工具 |
| `auto` | Auto approval | 自动审批 | 自动批准预定义的完整常规命令；其他命令仍需询问；文件工具和自定义工具与 `ask` 相同 |
| `full` | Full access | 完全访问 | 跳过工具审批，但不授予 AlphaCode 进程额外的系统权限 |

两端模式名称和说明保持一致；Web 的简短标签与菜单名称使用同一名称。“自动审批”不表示所有命令自动执行，“完全访问”不表示提权。

## 维护要求

- 英文标题和标签使用句首大写，专有名词及缩写除外；中文中的 Token、API、CLI、ZIP 与中文之间保留空格。
- 不改动翻译键、插值参数、复数后缀、命令、路径、配置字段或后端枚举。英文使用所需的 `_one`／`_other`，中文保留 `_other`。
- 根据绑定的数据核对标签。历史键 `traces.details_runtime` 当前展示 agentName，`traces.details_mode` 当前展示 modelId，故文案分别为 Agent／智能体、Model／模型。
- 用户输入、模型生成内容、工具原始输出和兼容历史文本不进行术语替换。
- 修改词典后运行 `bun run i18n:types`；审阅中英配对差异后，在两端应用目录分别运行 `bun run i18n:review`，最后在根目录运行 `bun run i18n:check` 并更新受影响的交互断言。
