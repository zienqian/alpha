# Alpha Skills S1 技术设计

> 状态：S1 已实现。更新日期：2026-11-07。设计基线：`352bf55`。使用方式见 Coding Agent 与 AlphaCode README。

## 1. 确定的方案

Skills 的公开函数就三个：

```text
loadSkills(options)             → { skills: SkillMetadata[], diagnostics }
formatSkillsForPrompt(skills)   → string
readSkill(skill, options?)      → SkillContent
```

- `loadSkills()` 扫描目录、解析元数据、处理冲突，返回元数据和诊断，不返回正文。
- `formatSkillsForPrompt()` 把元数据格式化为模型可见的摘要，是无 I/O 的纯函数。
- `readSkill()` 按需读取一个 Skill 的完整正文，不执行正文中的任务或脚本。

**模型侧只增加一个工具，工具名就是 `readSkill`，参数为 `{ name }`。** 工具从本 Agent 的元数据列表找到对应项，再调用同一个 SDK readSkill 函数。不为每个 Skill 注册工具。

```text
启动：loadSkills → 元数据列表 → formatSkillsForPrompt → 模型上下文
运行：模型选择名称 → readSkill 工具 → 完整正文 → 继续使用现有工具
```

不增加公开的目录管理对象、注册中心、发现接口、Prompt Builder 或热更新 API；不修改 read_file 的协议，也不新增资源读取工具。保持 `packages/coding-agent` → core 的依赖方向，不改 Provider、core Loop 或 Session 协议。

## 2. 公共 API 与数据结构

### 2.1 元数据与诊断

```ts
export interface SkillRoot {
  readonly path: string;
  readonly source: 'project' | 'user';
  readonly trusted: boolean;
}

export interface SkillMetadata {
  readonly name: string;
  readonly description: string;
  readonly filePath: string;
  readonly baseDir: string;
  readonly source: SkillRoot['source'];
  readonly revision: string;
  readonly argumentHint?: string;
  readonly disableModelInvocation: boolean;
  readonly userInvocable: boolean;
}

export interface SkillDiagnostic {
  readonly code: string;
  readonly severity: 'warning' | 'error';
  readonly path: string;
  readonly name?: string;
  readonly field?: string;
}

export interface LoadSkillsOptions {
  readonly roots: readonly SkillRoot[];
  readonly disabledNames?: readonly string[];
  readonly reservedNames?: readonly string[];
  readonly signal?: AbortSignal;
}

export interface LoadSkillsResult {
  readonly skills: readonly SkillMetadata[];
  readonly diagnostics: readonly SkillDiagnostic[];
}
```

filePath 是规范化的 SKILL.md 绝对路径，baseDir 是它的父目录，revision 是入口文件原始字节的 SHA-256。name 在生效列表中唯一，模型按 name 选择；不再额外引入 Skill ID。

SkillMetadata **没有 content 字段**。loadSkills 可以为解析、格式校验和 revision 计算读取文件，但不把正文保存在结果中，也不读取附属文件。

### 2.2 三个函数签名

```ts
export interface SkillContent {
  readonly name: string;
  readonly filePath: string;
  readonly baseDir: string;
  readonly revision: string;
  readonly content: string;
}

export interface ReadSkillOptions {
  readonly signal?: AbortSignal;
}

export declare function loadSkills(
  options: LoadSkillsOptions,
): Promise<LoadSkillsResult>;

export declare function formatSkillsForPrompt(
  skills: readonly SkillMetadata[],
): string;

export declare function readSkill(
  skill: SkillMetadata,
  options?: ReadSkillOptions,
): Promise<SkillContent>;
```

SkillContent.content 是剥离 frontmatter 后的完整 Markdown 正文，不做参数替换；其 revision 仍对应完整原始文件。SDK 返回普通数据，失败抛出带稳定 code 的错误；只有模型工具适配层使用仓库已有的 `{ ok, data }` / `{ ok: false, code }` 格式。

SDK readSkill 接收一项元数据，避免依赖隐式全局状态；模型工具接收 name，避免让模型提供任意文件路径。两者通过一个薄适配层连接，不需要一个新的管理对象。

入口开关不塞进 SDK 文件读取逻辑：模型工具检查 disableModelInvocation，显式命令检查 userInvocable。底层 readSkill 只负责读取与完整性校验。

### 2.3 Agent 配置

```ts
readonly skills?: readonly SkillMetadata[];
```

Skills 始终启用，无总开关。createCodingAgent 不再次扫描目录，只复制、校验并冻结传入列表；未配置时使用空列表。工具按 name 查询本 Agent 的只读列表，重复名称直接报配置错误。模型参数不能修改该配置。

这些元数据是**宿主传入的配置**，不是模型可提交的授权对象。宿主通常使用 loadSkills 的结果；如果自行构造元数据，宿主负责信任决策，readSkill 仍执行路径、文件类型和 revision 校验。

## 3. 使用方式

### 3.1 SDK

```ts
import {
  createCodingAgent,
  formatSkillsForPrompt,
  loadSkills,
  readSkill,
} from '@alpha/coding-agent';

const { skills, diagnostics } = await loadSkills({
  roots: [{
    path: '/repo/.alphacode/skills',
    source: 'project',
    trusted: true,
  }],
  reservedNames: ['skills', 'permission'],
});

const agent = await createCodingAgent({ model, cwd: '/repo', skills });

try {
  await agent.prompt('审查本次代码改动。');
} finally {
  await agent.close();
}
```

model 沿用现有 Provider。宿主将 diagnostics 交给日志或 UI 展示；createCodingAgent 内部调用 formatSkillsForPrompt，调用方不再往 instructions 重复拼接一次。

不使用 createCodingAgent 的消费者，也可以独立使用这两个步骤：

```ts
const summary = formatSkillsForPrompt(skills);
const selected = skills.find(skill => skill.name === 'review');
if (!selected) throw new Error('Skill not found: review');
const content = await readSkill(selected);
```

summary 是目录摘要，content 是单个完整正文；它们不会自动启动模型调用。

### 3.2 Skill 文件

```text
.alphacode/skills/review/
  SKILL.md
  references/checklist.md
  scripts/check.ts
```

```markdown
---
name: review
description: 审查代码改动中的正确性、回归风险和测试缺口。用户要求 code review 时使用。
argument-hint: "[待审查的范围]"
---

# 代码审查

1. 从当前请求确定审查范围；未说明时检查本次改动。
2. 按需读取 references/checklist.md，路径相对于本文件所在目录。
3. 按严重程度报告问题，给出文件位置和验证依据。
4. 未获用户要求，不直接修改代码。
```

自然语言请求由模型选择是否调用 readSkill；`/review packages/adk` 则由宿主显式选择。`/skills` 只显示已加载的元数据和诊断，不读取全部正文。

## 4. loadSkills 的职责

### 4.1 加载流程

```text
校验宿主配置和根信任
  → 按 roots 顺序扫描直接子目录
  → 找到 SKILL.md
  → 有界读取、解析 frontmatter、计算 revision
  → 校验名称和能力字段
  → 按名称处理覆盖、禁用和保留命令
  → 返回 { skills, diagnostics }
```

结果只含可信、有效、未禁用且未遮蔽的元数据。单个文件损坏进入 diagnostics，不让一个坏 Skill 破坏整个列表；配置错误、整次扫描超限和取消则拒绝 Promise。没有目录属于空结果，不是错误。

同名候选中 roots 靠前者优先。同名高优先级入口存在但内容非法时，保留诊断并阻止该名称，不静默回退到另一份内容；没有 SKILL.md 的普通目录不占用名称。

S1 不递归仓库、不向祖先扫描、不读取其他产品配置、不执行脚本、不安装依赖、不枚举附属文件。扫描结束后不保留正文缓存或文件句柄。

### 4.2 AlphaCode 的根配置

AlphaCode 在 runtime 中组装 roots，库只处理显式传入的绝对路径：

1. `<cwd>/.alphacode/skills`
2. `<cwd>/.agents/skills`，共享目录兼容开启时
3. `<cwd>/.claude/skills`，Claude 目录兼容开启时
4. `<configDirectory>/skills`，默认 `~/.alphacode/skills`
5. `~/.agents/skills`，共享目录兼容开启时
6. `~/.claude/skills`，Claude 目录兼容开启时

configDirectory 沿用 ALPHACODE_HOME。原生和共享目录默认启用，Claude 目录默认关闭；项目根仅在全局 trustedProjects 精确匹配规范化 cwd 时标记 trusted。未信任根只报告来源诊断，不读取入口正文；不由仓库文件或 permissionMode 自动授予信任。

```yaml
skills:
  sharedDirectories: true
  claudeDirectories: false
  trustedProjects:
    - 'C:\Users\ziyang\project\alpha'
  disabledNames: []
```

### 4.3 文件约定

name 必须匹配目录名，使用 1–64 个小写 ASCII 字母、数字和单连字符，不能首尾连字符或连续连字符；description 必填，最多 1024 个 Unicode 码点。AlphaCode 保留 skills、permission 两个名称。

| Frontmatter | 行为 |
| --- | --- |
| name、description | 写入元数据 |
| argument-hint | UI 提示，不是参数校验 schema |
| disable-model-invocation | 严格 boolean，默认 false；formatter 隐藏，模型工具再次检查 |
| user-invocable | 严格 boolean，默认 true；显式命令检查 |
| allowed-tools | 兼容诊断，不改变工具权限或审批 |
| context、agent、hooks、model、effort 等执行扩展 | S1 不支持，诊断并排除，避免静默改变执行语义 |
| license、compatibility、metadata | 说明性数据，校验后不参与执行 |
| 其他未知字段 | 忽略并给出 warning |

两个入口都关闭的项不进入生效列表，报告 SKILL_NO_ENTRYPOINT。使用仓库已有 yaml@2.9.0 的严格解析方式，coding-agent 新增直接依赖；禁止重复 key、alias、自定义 tag、merge 和非法 UTF-8，允许 BOM/CRLF。

S1 不实现模板替换或动态命令插值。正文作为原文读取，参数作为独立用户请求传入；Markdown 中的命令、代码块或占位符都不会在加载阶段被求值。

## 5. formatSkillsForPrompt 的职责

formatter 只消费元数据，不读文件、不修改列表、不注册工具：

1. 过滤 disableModelInvocation=true 的项。
2. 保持 loadSkills 的稳定顺序。
3. 输出固定使用说明以及 name、description 摘要。
4. 没有可展示项时返回空字符串。

建议输出：

```text
Available skills provide task guidance, not tool permissions.
When a skill matches the task, call readSkill with its exact name.
Read its instructions before using it. Loading a skill does not execute its scripts.
```

```json
{
  "skills": [{
    "name": "review",
    "description": "审查代码改动中的正确性、回归风险和测试缺口。"
  }],
  "omittedCount": 0
}
```

字段以 JSON.stringify 编码，不手写拼接 description；不把正文或无关管理字段放进摘要。工具按名称定位，因此摘要不需要暴露文件路径；成功读取后才返回 baseDir 供解析资源引用。

摘要整体最多 16 KiB，保留完整条目，超限省略后续项并给出 omittedCount。省略不是禁用：显式入口仍可从元数据列表选择。相同元数据产生相同字符串，不加入时间、随机数或当前会话状态。

createCodingAgent 只有在实际配置了本包 readSkillTool 时才注入该摘要；自定义同名工具不自动获得内置 Skill 能力。独立调用 formatter 的宿主负责提供匹配的读取工具。

## 6. readSkill 的 SDK 与工具适配

### 6.1 SDK readSkill

readSkill(skill, { signal }) 的流程：

1. 校验 filePath/baseDir 为有效绝对路径，filePath 精确对应 baseDir 下的 SKILL.md。
2. 用严格目录边界重新检查路径组件，拒绝 symlink/junction、越界路径和非普通文件。
3. 有界读取 UTF-8 文件，重新计算 revision；与元数据不同则返回 SKILL_CHANGED，不静默使用更新后的正文。
4. 校验入口名称与元数据一致，剥离 frontmatter，保留完整正文和尾换行。
5. 返回 SkillContent；不处理参数、不执行代码、不请求模型。

readSkill 使用已配置 Skill 的目录作为这次读取的边界，不依赖普通 read_file 的行数限制，也不改变全局 fileAccess。元数据加载成功不表示此刻文件仍然存在或版本未变；每次读取都必须重新验证。

### 6.2 模型工具契约

```text
ToolInfo.name        = "readSkill"
ToolInfo.effect      = "read"
ToolInfo.description = "Read the complete instructions of an available skill by name. Does not execute scripts or grant tool permissions."
```

```json
{
  "type": "object",
  "properties": {
    "name": { "type": "string", "minLength": 1, "maxLength": 64 }
  },
  "required": ["name"],
  "additionalProperties": false
}
```

工具只接受 name，不接受 path、source、trusted、tools 或参数模板。适配层从 context.skills 查找名称，检查 disableModelInvocation，再调用 SDK readSkill。未知名称返回 SKILL_NOT_FOUND，仅手动项返回 SKILL_MODEL_INVOCATION_DISABLED。

成功结果沿用 CodingToolResult：

```json
{
  "ok": true,
  "data": {
    "name": "review",
    "filePath": "/repo/.alphacode/skills/review/SKILL.md",
    "baseDir": "/repo/.alphacode/skills/review",
    "revision": "sha256...",
    "content": "完整 Markdown 正文"
  }
}
```

正文必须完整。先检查最终成功结果的 UTF-8 JSON 字节数是否落在 context.state.budget 内，再交给原有编码器；超限返回 SKILL_CONTENT_TOO_LARGE，不允许通用 encode 把正文截断后仍报告成功。

### 6.3 工具选择与审批接入

静态定义名为 readSkillTool，对外可导出以支持自定义 tools 数组；它是第三个函数的模型适配器，不是另一套 Skill API。

- codingTools 保持现有六个工具不变。
- 未显式传 tools 时，createCodingAgent 始终使用 `[...codingTools, readSkillTool]`，不依赖 skills 是否配置。
- 显式 tools 精确覆盖；tools:[] 仍不添加任何工具，也不注入自动摘要。
- 未配置 skills 与显式空列表等价，formatter 返回空字符串；readSkillTool 仍可用，读取未知名称返回 SKILL_NOT_FOUND。
- 现有工具名保持不变；新增工具使用确定的 camelCase 名 `readSkill`，不另起别名。

`tools/index.ts` 的 preparations 增加精确映射 `readSkill → ['read', prepareReadSkill]`。预检查找名称、检查入口开关和路径，产生真实文件路径 preview，随后走现有 CodingPolicy；不会落入 custom 默认拒绝。

执行端必须再次检查名称、入口开关和路径。当前 coding-plugin 对预检失败会允许执行端返回业务错误，不能误以为进入 execute 就已经安全通过校验。SDK 读取和模型工具包装共用底层校验逻辑，不复制两份文件读取实现。

### 6.4 引用文件和脚本

readSkill 只读取 SKILL.md。附属文件仍用已有 read_file，脚本仍用 run_command；相对路径以返回的 baseDir 为基准，不修改 cwd。

本阶段不扩展 read_file 的访问根：在 SDK 默认 workspace 模式下，工作区外个人 Skill 的正文可以由 readSkill 读取，但其外部引用文件仍可能被普通文件策略拒绝。需要这些资源的宿主必须显式提供已有的合适访问能力或把资源放入工作区，不能悄悄把 fileAccess 改成 host。当前 AlphaCode 已配置 host 访问，沿用其原有授权即可。

## 7. Agent 中的生命周期

### 7.1 初始化与上下文

loadSkills 在创建 Agent 前完成。Agent 生命周期内持有固定的元数据副本；formatSkillsForPrompt 的结果在组装时计算一次，内部插件通过 beforeModel 投影到当前消息之前，不在每次模型调用时重新扫盘。

只有模型工具返回的正文进入真实 toolResult。摘要只是临时投影，不进入 canonical history；每次 hook 从原始 messages 生成投影，避免重复累积。沿用现有普通 user 消息形式，不伪造 system、custom 或工具结果。

插件在同步 setup 注册 hook，不在 start 里异步发现并注册工具；也不注册第二个 Session RunBoundary。按现有 prepend 顺序组装，保持全局指令、项目指令、Skill 摘要、历史的顺序。

### 7.2 更新与重复读取

S1 不做 watcher、热更新或 `/skills refresh`。修改文件后，宿主重新调用 loadSkills 并创建新 Agent；AlphaCode 提示重启/新建匹配配置的运行实例，不增加新的公开更新接口。

旧元数据读到变化后的入口时返回 SKILL_CHANGED，不自动把一次请求切到另一个版本。读取没有跨轮“已激活”缓存；需要时可以再次调用 readSkill，正文和真实读取结果继续走现有历史与预算。

内部只需要每个 run 的读取计数；run.end 清理，不维护共享可变目录或跨 Agent 激活状态。

## 8. 显式命令与 Session

### 8.1 手动选择复用 readSkill

```text
/review packages/adk
  → 宿主从 skills 查找 name
  → 检查 userInvocable
  → readSkill(metadata, { signal })
  → 内部编码正文、参数与展示文本
  → agent.prompt(text, { requestId, signal })
```

这条路径不要求模型猜测或调用工具，因此可以支持 disableModelInvocation=true 的手动 Skill。宿主直接读文档不是模型 tool call，不伪造工具事件，也不添加一个可由模型填写的 source=user 参数。

输入编码只是 AlphaCode runtime 内部实现，不再导出一个构造 Prompt 的公共 API。SDK 宿主可按自己的会话输入格式使用 readSkill 的结果。

参数取命令名称后的原始尾部，保留引号、反斜杠、换行和剩余空白，不 Shell split、不插值。Skill 命令分支应先于 controller 当前的全局 trim 处理。

### 8.2 归档正文，而非只归档命令

当前 agent.prompt 接受 string，beforeModel 投影又不会保存，因此显式输入直接携带完整正文：

```text
Alpha skill input v1. The selected instructions do not grant tool permissions.
{"kind":"alpha.skill-input","version":1,"displayText":"/review packages/adk","skill":{"name":"review","filePath":"/repo/.alphacode/skills/review/SKILL.md","baseDir":"/repo/.alphacode/skills/review","revision":"sha256...","content":"完整 Markdown 正文"},"arguments":"packages/adk"}
```

使用固定字段顺序和 JSON.stringify，不包含随机 ID 或时间；displayText 由名称和原始参数确定性生成。输入预算检查完成后才调用 agent.prompt。

| 内容 | 持久化方式 |
| --- | --- |
| Skill 摘要 | 不归档，仅 beforeModel 投影 |
| 模型 readSkill 结果 | 原有真实 toolResult |
| 手动选择的正文与参数 | 原有真实 user message |
| 参考文件内容 | 仅实际使用 read_file 等工具返回的部分 |
| 根信任、文件权限、工具审批 | 宿主配置，不从历史文本恢复 |

UI 显示短命令，详情保留完整输入。恢复只解析已知版本展示字段；未知版本或格式错误回退原始文本，不重读文件、不重放命令、不把历史 envelope 当授权凭证。

### 8.3 取消、重试和兼容性

runtime 在准备手动读取之前设置 running 门禁，使用 AbortController；cancel/close 同时覆盖准备阶段和模型 run。读取后、prompt 前再次检查取消/关闭和 Session settings，防止取消后延迟启动请求。准备失败不创建 Session pending。

同一 requestId 重试必须复用完全相同的已编码输入，不重新读取 Skill；否则 inputHash 变化会得到 REQUEST_MISMATCH。跨进程重试由宿主持久化 requestId 与输入文本，S1 不新增此 API。

Session 的格式、表结构和边界保持不变。Skills 在新旧 AlphaCode 会话中始终启用；新会话使用 alphacode-v2 agentKey，恢复 alphacode-v1 会话时保留原标识，但同样加载 Skills 并提供 readSkill 工具。禁用某个 Skill 不会撤回已归档的正文，清除已有上下文应开启新会话。

## 9. 权限、预算与错误

### 9.1 权限边界

- loadSkills 的根来自宿主；未信任来源不进入生效列表。模型只能从已配置名称中选择，不能通过 readSkill 参数新增路径或信任。
- readSkillTool 是 read 动作，沿用 CodingPolicy 和真实路径 preview。allowed-tools、正文、历史输入均不能更改权限或免除审批。
- SDK readSkill 是宿主直接操作，不经过模型 CodingPolicy；需要额外审批的宿主应在调用前完成授权。
- 附属文件和命令仍由原有工具及其权限控制，不增加目录挂载或隐式写权限。
- 名称隐藏/禁用不是整机文件 ACL。现有 host 或 Shell 权限若本来允许读取同一文件，本功能不会撤销这些权限。

路径检查沿用 realpath/lstat 与相对包含关系，不能只用 startsWith；拒绝 symlink/junction、设备文件、NUL、ADS 等绕过，处理 Windows 盘符与大小写。不声称解决硬链接、恶意并发文件替换或所有 OS 级 TOCTOU；更强隔离需要系统沙箱。

description、正文和引用文件仍是外部任务内容。模型摘要以结构化数据封装，UI 清洗终端控制字符；diagnostics 和日志仅记录稳定 code、字段和路径，不回显正文或 YAML 错误摘录。

### 9.2 S1 默认预算

| 对象 | 上限 | 行为 |
| --- | --- | --- |
| roots | 16 个 | 超限拒绝配置 |
| 扫描目录项 / 候选目录 | 2048 项 / 256 个 | 增量 opendir；整次超限拒绝，不返回伪完整列表 |
| SKILL.md / frontmatter | 32 KiB / 8 KiB | 超限诊断；正文不截断 |
| 模型摘要 | 16 KiB，含封装 | 省略完整条目并标明数量 |
| readSkill 工具结果 | context.state.budget，目前至多 48 KiB | 检查最终 JSON；超限明确失败 |
| 手动 arguments / 编码后的输入 | 8 KiB / 48 KiB | 超限不启动 run |
| 每 run 的 readSkill 执行 | 8 次，成功结果累计 128 KiB | 超限返回业务错误 |

工具执行端业务失败占读取次数，审批拒绝不占；所有调用仍受 core 的总次数限制。SDK readSkill 不计入模型 run 的工具计数，但受同样文件大小限制。32 KiB 原文可能因 JSON 转义超过结果上限，必须检查最终字节数。

### 9.3 主要错误

| 错误 | 发生处 | 处理 |
| --- | --- | --- |
| SKILL_FRONTMATTER_REQUIRED / SKILL_INVALID_YAML / SKILL_UNSUPPORTED_FIELD | loadSkills | 单项诊断并排除 |
| SKILL_SHADOWED / SKILL_ROOT_UNTRUSTED | loadSkills | 返回诊断，不暴露为可调用项 |
| SKILL_INVALID_METADATA | Agent 组装 | skills 必须为元数据数组，不能传 false |
| SKILL_NOT_FOUND | 工具或命令查找 | 不读取任意替代路径 |
| SKILL_MODEL_INVOCATION_DISABLED | 模型工具 | 保留显式选择路径 |
| SKILL_USER_INVOCATION_DISABLED | 显式命令 | 不启动 run |
| SKILL_CHANGED / FILE_NOT_FOUND | readSkill | 重新加载配置或修复文件，不使用旧正文缓存 |
| SKILL_CONTENT_TOO_LARGE | 模型工具编码 | 不返回截断成功 |
| SKILL_READ_LIMIT | 模型工具 | 停止重复读取 |

失败的 SDK Promise 不转换成空内容；模型工具将异常 code 转成 `{ ok: false, code }`。UI 应把业务失败识别为失败，而不是仅看 core execution 已结束。

## 10. 代码落点

### 10.1 coding-agent

```text
packages/coding-agent/src/
  skills/contracts.ts       SkillMetadata、LoadSkillsResult、SkillContent 等类型
  skills/load.ts            loadSkills：扫描、校验、冲突和诊断
  skills/parse.ts           load/read 共用的 frontmatter 解析
  skills/format.ts          formatSkillsForPrompt：纯摘要格式化
  skills/read.ts            readSkill：严格完整读取和版本校验
  skills/plugin.ts          内部 beforeModel 摘要注入；计数由 coding-plugin 清理
  tools/read-skill.ts        readSkillTool、prepareReadSkill
```

| 现有文件 | 修改 |
| --- | --- |
| `packages/coding-agent/src/index.ts` | 导出三个函数、相关类型及 readSkillTool |
| `packages/coding-agent/src/contracts.ts` | CodingAgentOptions 增加 skills，CodingContext 增加只读 Skill 配置 |
| `packages/coding-agent/src/context.ts` | 校验并复制元数据列表、持有 run 计数 |
| `packages/coding-agent/src/create-coding-agent.ts` | 默认工具组合、调用 formatter、安装内部插件 |
| `packages/coding-agent/src/tools/index.ts` | 导出 readSkillTool，增加精确名称预检映射；codingTools 保持六个 |
| `packages/coding-agent/package.json` | 声明 yaml 直接依赖 |

readSkill 复用现有 files.ts 的有界读取和严格根检查；parse.ts 供 load/read 共用，避免两套 frontmatter 规则。read_file、其他现有工具协议与写路径不改。

### 10.2 AlphaCode

| 文件 | 修改 |
| --- | --- |
| `apps/alphacode/src/config.ts`、`global-config.ts` | skills 配置与可信根规则 |
| `apps/alphacode/src/runtime/skills.ts` | 根组装、loadSkills、诊断映射、显式命令的读取与输入编码 |
| `apps/alphacode/src/runtime/create-runtime.ts` | 初始化时加载一次、传 skills、准备阶段取消与并发门禁 |
| `apps/alphacode/src/runtime/history.ts` | 显式输入短命令展示，保留完整正文 |
| `apps/alphacode/src/runtime/tool-records.ts` | 增加 known tool name readSkill，解析业务失败，展示名称与路径 |
| `apps/alphacode/src/input.ts`、`chat/controller.ts` | 纯命令解析、保留 Skill 参数、准备失败状态 |
| `apps/alphacode/src/chat/contracts.ts`、`ui/commands.ts`、`ui/components/composer.tsx` | `/skills` 列表、Skill 命令补全、真正按命令种类分发 |

当前 composer 把斜杠命令截获并按 permission 处理，必须同时改分发，不能只增加菜单项。菜单来自同一份元数据，过滤 userInvocable=false；模型摘要则过滤 disableModelInvocation=true，不混用两种开关。

UI 不依赖 SDK 实现类型，使用自己的展示 DTO；遵循现有英文文案约定。readSkill 成功表示“读取了 Skill”，不表示“任务执行成功”。

## 11. 实施与验收

### 11.1 实施顺序

1. 实现 loadSkills、formatSkillsForPrompt、readSkill 与类型，完成文件和纯函数测试。
2. 实现唯一的 readSkillTool，接入预检、审批、默认工具组合和摘要注入。
3. 接入 AlphaCode 的 `/skills`、显式命令、取消、归档和恢复，更新 SDK 示例。

### 11.2 必须覆盖的测试

| 范围 | 验收点 |
| --- | --- |
| API 边界 | loadSkills 结果没有正文；formatter 无文件 I/O；readSkill 完整读取但不执行脚本 |
| 数据一致性 | formatter 只用传入列表；模型按 name 查同一列表；重复名称配置被拒绝 |
| 发现 | 缺失根、可信根、覆盖、非法高优先级不回退、禁用、保留命令、预算超限 |
| 格式 | BOM/CRLF、多语言、非法 UTF-8、重复 key、alias、能力字段、四种入口开关组合 |
| 完整读取 | 超过 200 行仍完整；保留尾换行；删除/变更返回明确错误；最终 JSON 超预算不截断成功 |
| 工具契约 | 名称严格为 readSkill，参数只有 name；任意 path/source 等额外字段被拒绝 |
| 选择兼容 | 未配置 skills 或配置空列表仍默认提供七个工具；空列表不注入摘要；显式 tools:[] 不加工具、不注入摘要 |
| 审批 | 已知 read 分类、真实路径 preview、自定义 policy 拒绝、预检失败后执行端重验 |
| 路径 | 符号链接/junction、越界、目录前缀碰撞、Windows 路径、非法文件类型、取消关闭句柄 |
| 资源边界 | SDK workspace 下外部引用仍遵守原 read_file 规则，不自动扩大权限 |
| 会话 | 摘要不归档；工具正文和显式正文真实归档；恢复不重新读文件或执行命令 |
| 幂等 | 同 requestId + 同文本重放；同 requestId + 新正文拒绝；重放不依赖原文件存在 |
| UI | permission 不回归，Skill 补全/命令分发正确，参数未经错误 trim，业务失败不显示为成功 |
| 竞态 | 准备/send/settings/close 门禁，取消后不延迟启动 run，不同 Agent 的计数不串 |

沿用现有测试目录、临时文件与 fakeModel，不依赖在线模型。公共函数单测与模型工具契约测试分开：不能通过工具包装后的结果来掩盖 SDK 的返回类型或错误语义。

## 12. 参考与取舍

pi 的 loadSkills 返回元数据和诊断，formatSkillsForPrompt 格式化可用摘要；其普通 Skill 读取复用通用 reader。[S1] Alpha 采用前两个函数的职责划分，并按本方案**额外增加一个 readSkill 工具**，不再扩展通用 read_file。

pi 的显式 Skill 命令由宿主读取正文再拼入用户输入；Codex 也将用户选择建模为独立 Skill 输入。[S2][S3] Alpha 沿用当前 string prompt，以内部版本化文本保存完整输入，不为此改 core 协议。

采用 SKILL.md 与 YAML frontmatter 的基础目录格式，但不承诺完整实现 Claude Code 的扩展执行字段、模板、子 Agent 或工具授权。[S4][S5]

参考资料于 2026-11-06 核对；源码 main 链接不是固定发布版本：

- [S1] pi：Skill、LoadSkillsResult、loadSkills、formatSkillsForPrompt。`https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/skills.ts`
- [S2] pi：AgentSession._expandSkillCommand。`https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session.ts`
- [S3] Codex：UserInput::Skill。`https://github.com/openai/codex/blob/main/codex-rs/protocol/src/user_input.rs`
- [S4] Agent Skills 文件格式。`https://agentskills.io/specification`
- [S5] Claude Code Skills。`https://code.claude.com/docs/en/skills`
