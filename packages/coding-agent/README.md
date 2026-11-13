# @alpha/coding-agent

为 ADK 增加六个静态编程工具和 `readSkill` 工具。`createCodingAgent` 返回普通 core Agent，复用同一套 Loop；Session 通过插件组合。

```ts
import { createCodingAgent } from '@alpha/coding-agent';

const agent = await createCodingAgent({
  model,
  cwd: process.cwd(),
  approve: async (action, context) =>
    await askUser(action.preview, context.signal) ? 'allow' : 'deny',
});
try { await agent.prompt('修复问题并运行相关测试。'); }
finally { await agent.close(); }
```

## 内置系统指令

`src/instructions.ts` 集中维护行为规则，`createCodingAgent` 在创建时按实际工具、Shell、文件访问模式和命令期限拼装。调用方 `instructions` 仍追加在末尾；项目 AGENTS.md 与 Skills 继续通过既有插件注入，系统指令不写入对话历史。AlphaCode 的 CLI、Web 和桌面端共用 app-server 的 `createCodingAgent`，无需在各端重复配置。

2026-11-14 对公开 Claude Code prompt 的核对与取舍：

- [官方 changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md) 当日首项为 **2.1.323**；[Piebald 提取仓库 v2.1.322](https://github.com/Piebald-AI/claude-code-system-prompts/tree/v2.1.322) 的 README 标注 **2026-11-09**。本文以该固定 tag 为研究基线，不把它称为官方最新版的完整运行时 prompt。
- 网传 [Fable 5.2 转储](https://github.com/elder-plinius/CL4R1T4S/blob/main/ANTHROPIC/CLAUDE-CODE-FABLE-5.2.txt) 混合了工具 schema、模型行为、云端环境和技能正文；其中 `agentic_behavior/situation` 自述基于 Claude Code，但不是 Claude Code 本体。来源是社区发布，真实性与完整性未获官方确认。
- Claude Code 的指令由多个条件片段和工具描述组成，单个文件不是所有用户都会收到的唯一 prompt。Alpha 采用下列原则的独立改写，不导入整份转储，也不在运行时联网加载上游内容。

| 参考原则 | Alpha 的内置行为 |
| --- | --- |
| [完整交付](https://github.com/Piebald-AI/claude-code-system-prompts/blob/v2.1.322/system-prompts/system-prompt-delivering-work-at-full-scope.md) | 合理假设下推进实现与验证；确实阻塞时完成其余部分并说明缺口 |
| [控制范围](https://github.com/Piebald-AI/claude-code-system-prompts/blob/v2.1.322/system-prompts/system-prompt-doing-tasks-no-unnecessary-additions.md) | 最小且完整的修改，复用现有约定，保护用户已有改动，避免顺手重构 |
| [工具使用](https://github.com/Piebald-AI/claude-code-system-prompts/blob/v2.1.322/system-prompts/system-prompt-harness-instructions.md) | 专用工具优先；仅独立读取并行；搜索与读取有界，依赖和副作用顺序执行 |
| [行动边界](https://github.com/Piebald-AI/claude-code-system-prompts/blob/v2.1.322/system-prompts/system-prompt-executing-actions-with-care.md) | 授权范围内继续执行；被拒操作不可换工具绕过；提交、发布和破坏性操作遵守明确授权 |
| [证据汇报](https://github.com/Piebald-AI/claude-code-system-prompts/blob/v2.1.322/system-prompts/system-prompt-reporting-outcomes.md) | 根据实际结果报告完成情况，区分通过、失败、未运行和未知结果 |
| [面向用户沟通](https://github.com/Piebald-AI/claude-code-system-prompts/blob/v2.1.322/system-prompts/system-prompt-outcome-first-communication-style.md) | 任务开始说明意图，重要进展简报，最终先讲结果、验证和限制 |

本地适配保留了 Alpha 的真实协议：`search` 是字面搜索，编辑前必须有 `read_file` 凭据，编辑或执行命令后再次编辑必须重读，`create_file` 不覆盖文件，JSON 的 `ok/code` 与命令退出码都要检查。PowerShell 单独提示传播原生命令退出码；禁用 Shell、工具子集、自定义同名工具、host/workspace 模式和无限期限不会收到相互矛盾的内置工具指令。

未迁移 Claude 的身份、模型特定策略、Artifacts、自动发布、子代理、计划模式、记忆、后台任务或连接器工具指令；这些依赖不同的产品和运行时。尤其没有迁移转储中“编辑后不要重读”的规则，因为 Alpha 的编辑凭据会失效。权限仍由 `policy/approve` 和执行器落实，prompt 是行为指导，不是权限隔离。离线测试验证拼装与运行时契约，不能据此宣称真实模型的任务成功率已经提升。

## Skills

Skills 使用三个公开函数，不新增注册中心或独立执行循环：

```ts
import { loadSkills, formatSkillsForPrompt, readSkill, createCodingAgent } from '@alpha/coding-agent';

const { skills, diagnostics } = await loadSkills({
  roots: [{ path: '/repo/.alphacode/skills', source: 'project', trusted: true }],
  disabledNames: [],
});
const agent = await createCodingAgent({ model, cwd: '/repo', skills });
const summary = formatSkillsForPrompt(skills);
const selected = skills.find(skill => skill.name === 'review');
if (selected) await readSkill(selected);
try { await agent.prompt('审查本次改动'); }
finally { await agent.close(); }
```

- `loadSkills` 只扫描显式根的直接子目录 `SKILL.md`，返回冻结的元数据和诊断，不返回正文。根必须为规范化绝对路径，未信任根不读取正文；先出现的根优先，非法的高优先级入口阻止同名回退。
- `formatSkillsForPrompt` 是无 I/O 的纯函数，输出名称、描述的 JSON 摘要，最多 16 KiB；被省略的完整条目通过 `omittedCount` 计数。
- `readSkill(metadata, { signal? })` 返回 `name/filePath/baseDir/revision/content`，正文完整保留，不做模板展开；文件变更返回 `SKILL_CHANGED`，缺失返回 `FILE_NOT_FOUND`。
- Skills 始终启用，无总开关；`skills` 未配置时使用空列表，不接受 `false`。默认工具为 `[...codingTools, readSkillTool]`，共七项。模型调用名为 **`readSkill`**，唯一参数 `{ name }`。空列表不生成摘要，读取未知名称返回 `SKILL_NOT_FOUND`。显式 `tools` 完全覆盖默认列表；`codingTools` 自身始终只有六项。
- 只有选用内置 `readSkillTool` 才注入摘要，调用方不要重复拼接 `summary`。摘要不写入 Session；完整读取结果通过普通 toolResult 归档。该工具沿用 read 审批，不授予 edit_file 的读取凭据或更多文件权限。
- `name`、`description` 必填；名称须与目录一致，1–64 个小写字母/数字/单连字符。支持 `argument-hint`、`disable-model-invocation`、`user-invocable`。两个入口均禁用则排除。`allowed-tools` 只诊断、不授权；`context/agent/hooks/model/effort` 拒绝。YAML 重复键、别名、显式标签及 merge 不支持。
- 文件上限 32 KiB，frontmatter 8 KiB；扫描上限 16 根、2048 目录项、256 候选目录。工具每轮最多执行 8 次，成功 JSON 累计 128 KiB，并遵守单次结果预算；超限明确失败，绝不返回截断成功。

SDK 不自动信任项目、不发现个人目录、不执行脚本、不热更新。Skills 路径拒绝符号链接/junction；路径校验不是 OS 沙箱，不保证防御恶意并发替换或硬链接。附属资源使用现有文件工具，脚本使用 `run_command`，权限不变；workspace 模式不会因为加载个人 Skill 而隐式开放其目录。

## 编程运行时结构

- `cwd` 是启动时规范化的目录字符串，不持有工具或资源。
- `src/tools/` 中每个工具是模块常量，定义 schema、预检和执行；通过 `tools: [readFileTool, searchTool]` 选择，默认 `[...codingTools, readSkillTool]`，传 `[]` 可关闭全部工具。
- 每个 Agent 独立持有 `CodingContext`：`cwd`、已选定 `shell`、业务 `data`、审批控制与文件读取版本。业务 `appContext` 在工具中通过 `ctx.app.data` 访问。
- 内部审批插件只处理预检和许可。修改与命令的预检计划绑定同一次调用，批准后消费，拒绝、取消和运行结束清理；读取工具直接执行。
- `files.ts`、`search.ts` 是显式接收 cwd 的普通函数；`process/` 处理 Shell 选择、启动、输出、取消和超时。

原 `createLocalWorkspace`、`CodingWorkspace`、`WorkspaceLease`、公开 `createCodingContext/createCodingPlugin`、长生命周期目录锁和 PowerShell/C# bridge 已移除。调用方只需关闭 Agent，不再创建或关闭 Workspace。

## Shell 与进程

采用 [OpenCode 路线及固定源码版本](THIRD_PARTY_NOTICES.md)，直接依赖 `cross-spawn@7.0.6`。Shell 在模型第一次调用之前选定，系统指令和审批预览显示实际解释器路径；执行批准的命令时不重新挑选 Shell。

1. 宿主显式传入 `shell: '/path/to/bash'` 或 `shell: 'pwsh.exe'`，必须存在且属于支持的 Shell。`shell: false` 禁用命令。
2. 自动选择优先使用有效、受支持的 `$SHELL`（fish/nu 不用于 POSIX 命令兼容模式）。
3. Windows：pwsh → Windows PowerShell（包括系统路径）→ 可用的 Git Bash → COMSPEC/cmd。拒绝把 Windows 系统目录的 WSL bash 当成本地 Shell。
4. macOS：zsh → bash → sh；Linux：bash → sh。候选程序必须存在。

未找到 Shell 时，聊天和文件工具仍可用，命令返回 `SHELL_UNAVAILABLE`；显式无效配置报 `INVALID_SHELL`。文件工具不要求安装 PowerShell 7 或 Bash；只有列表/搜索运行时需要 PATH 上的 ripgrep。

Windows 以 `taskkill /T /F` 终止进程树；Unix 使用 detached 进程组，先 SIGTERM，3 秒后 SIGKILL。根进程退出后最多再等 1 秒排空管道，超时会标记 `outputIncomplete`。持续读取 stdout/stderr，超过保留额度继续排空。取消或超时发生在启动之后返回未知副作用，交给 core 阻断继续执行。

PowerShell 5.1/7 使用 UTF-8 和纯文本输出，不加载 profile。退出码是 **Shell 报告的退出码**；PowerShell 需要保留原生命令的具体退出码时使用 `exit $LASTEXITCODE`。命令环境沿用必要的系统变量白名单，不自动继承 Provider 密钥。

当前没有 PTY、后台任务或永久 Shell。命令拥有当前用户权限；路径检查不是操作系统沙箱。已退出父进程的脱离子进程、主动脱离 Unix 进程组的后代、宿主被强杀时的清理不作完整保证。

## 工具与审批

| 工具 | 行为 |
| --- | --- |
| `read_file` | UTF-8；默认 200 行，记录全文件版本 |
| `list_files` | 稳定排序，尊重 ignore；默认 200 项 |
| `search` | 单行字面搜索；默认 100 项，不算编辑前的读取 |
| `edit_file` | 当前 Agent 必须先读，oldText 非空且唯一；校验读取版本 |
| `create_file` | 只创建；父目录必须存在，不覆盖 |
| `run_command` | 执行已选 Shell 的命令；参数 `command, cwd?, timeoutMs?` |

同一模型响应中连续的 `read_file`、`list_files`、`search`、`readSkill` 默认最多 4 个并行；通过 `limits.maxConcurrentTools` 调整，设为 1 恢复串行。审批仍按调用顺序进行。`edit_file`、`create_file` 和 `run_command` 前后形成执行屏障，确保先完成读取再编辑，修改后的读取也不会提前执行。相互依赖的读取应分轮请求。

默认读取、搜索、编辑、创建允许；命令询问、自定义工具拒绝。静态 `policy.decide(action, context)` 返回 allow/ask/deny；缺少 approve 回调时 ask 拒绝。`action.cwd` 标识根目录，digest 绑定参数、路径、Shell、预期文件版本和预览。审批期间文件变化返回 `FILE_CONFLICT`。

结果为有界 JSON 字符串：`{ ok: true, data }` 或 `{ ok: false, code, detail? }`。非零退出返回 `COMMAND_EXIT_NONZERO`，保留退出码和日志，模型可继续修复。无法确认副作用则抛出并产生 `outcome_unknown`，不自动重试。命令执行后清除文件观察，写文件后清除该文件观察；再次修改需重新读取。

`run_command` 接受可选 `description`（去首尾空白后 1–160 字符）：模型在同一次工具调用中用英文简述命令目的，供宿主执行前展示。该字段随调用参数进入历史，不拼入 shell；执行器只接收 `command`、`cwd`、`timeoutMs`。旧调用不带描述仍然有效。

## 限制与 Session

文件上限 1 MiB，严格 UTF-8，保留 BOM/CRLF，拒绝链接路径。更新使用同目录临时文件和 rename，创建使用独占 link；写入前复查路径与版本。没有目录锁，也不保证对并发外部修改的原子 CAS、跨文件事务或 ACL 完整保留。

命令上限 60 秒，模型可降低；stdout/stderr 合计保留 48 KiB。搜索原始输出上限 4 MiB；序列化 JSON 再按 core 工具结果预算截断，最低预算 4096 字节。preset 默认 24 次模型调用、64 次工具调用、180 秒。根目录 AGENTS.md 启动读取一次，默认最大 32 KiB，可通过 `projectInstructions: false` 禁用。

宿主可显式覆盖这些默认值：`fileAccess: 'host'` 允许绝对路径、父目录和符号链接，列表/搜索的 `path` 参数指定目录；`commandTimeoutMs: null` 关闭命令与搜索进程的执行期限，并忽略模型的 `timeoutMs`。数字值指定命令默认期限及模型可请求的最大期限。`limits.maxModelCalls`、`maxToolCalls`、`maxHistoryMessages`、`maxHistoryBytes` 支持 `null` 表示不限；`limits.timeoutMs: undefined` 关闭整轮期限。AlphaCode 使用这些覆盖项。

```ts
const session = await createSession({ store, namespace: 'my-app', agentKey: 'coding-r3:v1' });
const agent = await createCodingAgent({ model, cwd, approve, plugins: [createSessionPlugin({ session })] });
await agent.prompt('修复问题', { requestId: 'task-42' });
// 保存状态：session.state.persistence；失败可重试 session.flush()，不会重新执行工具。
// 关闭：agent.close() → session.close() → store.close()。
```

AlphaCode 保留既有 Windows `local:<sha256(canonical cwd lowercase)>` 会话命名、目录参数优先级和关闭时补写保存的行为。

## 验证

仓库根目录运行 `bun run build`、`bun run typecheck`、`bun run lint`、`bun run test`。测试使用临时目录、真实子进程和离线模型；真实模型探针为显式执行的 `bun --env-file=.env.local packages/coding-agent/integration/live.js`。

[完整组合示例](../../docs/coding-agent-example-c1.ts) · [API 快照](../../docs/coding-agent-api-c1.d.ts) · [R3 评审](../../docs/coding-agent-refactor-review.html) · [本轮验证](../../docs/coding-agent-r3-validation.md)
