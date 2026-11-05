# @alpha/coding-agent

C1 为现有 ADK 增加编程能力。`createCodingAgent` 返回普通 core Agent，只有一套 Loop；会话通过 `createSessionPlugin` 组合。

## 使用

```ts
import { createCodingAgent } from '@alpha/coding-agent';
import { createLocalWorkspace } from '@alpha/coding-agent/node';

const workspace = await createLocalWorkspace({ root: process.cwd(), shell: 'powershell' });
try {
  const agent = await createCodingAgent({
    model, // 已有 Provider 的 LanguageModel
    workspace,
    approve: async (action, context) => {
      // 接入应用自己的审批 UI；展示 action.preview，取消后不执行。
      return await askUser(action, context.signal) ? 'allow' : 'deny';
    },
  });
  try { await agent.prompt('修复分页边界问题，并运行相关测试。'); }
  finally { await agent.close(); }
} finally { await workspace.close(); }
```

本地适配器需要 Windows、PATH 中的 PowerShell 7 (`pwsh.exe`) 和 ripgrep (`rg.exe`)。C1 对 Bash / 其他平台返回 `PLATFORM_UNSUPPORTED`；可自行实现 `CodingWorkspace`。`isolation: 'none'` 表示命令拥有当前用户权限，路径检查和审批不提供 OS 沙箱。

## API 与组合

| 入口 | 能力 |
| --- | --- |
| `createCodingAgent(options)` | preset 系统指令、工作区插件、项目指令插件与额外 core 插件 |
| `createWorkspacePlugin({ workspace, policy?, approve?, onEvent?, maxResultBytes? })` | 六工具、预检计划、权限与工作区租约 |
| `createProjectInstructionsPlugin({ workspace, file?, maxBytes? })` | 默认根目录 AGENTS.md，启动加载一次，临时 beforeModel 投影 |
| `/node` 的 `createLocalWorkspace({ root, shell, env?, limits? })` | 本地文件、搜索、Windows 命令适配 |

`policy` 是静态对象：`{ decide(action, context) { return 'allow' | 'ask' | 'deny'; } }`。默认读取、搜索、编辑、创建允许，命令 ask，自定义工具 deny。没有 approve 回调的 ask 会拒绝。命令预览包含固定 shell / cwd / command；文件预览包含具体改动与预期版本。digest 绑定工作区、参数与版本；审批期间内容变化会返回 `FILE_CONFLICT`，不覆盖。

```ts
import { createSession, createSessionPlugin } from '@alpha/adk-session';

const session = await createSession({
  store, namespace: 'my-app', agentKey: `coding-c1:${workspace.id}:v1`,
});
const agent = await createCodingAgent({
  model, workspace, approve,
  plugins: [createSessionPlugin({ session })],
});
const result = await agent.prompt('修复问题', { requestId: 'task-42' });
// result 是 core RunResult；保存状态单独查看 session.state.persistence。
// 同一 requestId + 相同输入重放旧结果，不重新执行工具。
// 关闭顺序：agent.close() → session.close() → workspace.close() → store.close()。
```

Session 不拥有执行 API，Coding 包也不依赖 Session。关闭 Agent 如果归档失败，Session 仍可 flush；flush 不重复修改文件。工作区与 Store 都由应用持有。Workspace.close 会拒绝新操作并等待现有租约，不能在 Agent.close 前等待它完成。

## 六个工具

| 工具 | 参数 | 行为 |
| --- | --- | --- |
| `read_file` | `path, startLine?, lineCount?` | UTF-8，1-based 行号；默认 200 行；记录全文件版本 |
| `list_files` | `glob?, limit?` | 默认 200 项，稳定排序，尊重 ignore |
| `search` | `query, glob?, limit?` | 字面单行搜索，默认 100 项；不算编辑前的读取 |
| `edit_file` | `path, oldText, newText` | 当前 Agent 先读文件，oldText 非空且唯一，精确替换 |
| `create_file` | `path, content` | 只创建，父目录必须存在 |
| `run_command` | `command, cwd?, timeoutMs?` | 固定 PowerShell 7，非交互，等待完整进程树 |

结果是 core string 内的有界 JSON：`{ ok: true, data }` 或 `{ ok: false, code, detail? }`。`edit_file` 返回 beforeRevision / afterRevision / changed；`create_file` 返回 afterRevision / created。退出码 1 返回 `COMMAND_EXIT_NONZERO` 与日志摘要，模型可继续修复。只有副作用无法确认才抛出，触发 core 的 outcome_unknown / blocked；不会自动重试。

写入、命令后清除相关文件观察缓存，再次编辑需要重新 read_file。新 Agent 不沿用历史中的文件观察。项目指令默认 32 KiB，缺失等于空，读取失败或过大则启动失败；不自动加载可执行技能或插件。

## 限制与资源

- preset 默认 24 次模型调用、64 次工具调用、180 秒；可通过 core `limits` 调整。
- 文件默认 1 MiB，UTF-8 严格解码，保留 BOM / CRLF；拒绝二进制和链接路径。
- 命令默认上限 60 秒，模型只能降低；输出合计默认 48 KiB，持续排空超出部分。JSON 转义后的结果再限额，保留退出码和写入版本。
- 工具结果预算至少 4096 字节。preset 自动跟随 core `maxToolResultBytes`；手动装配插件时通过 `maxResultBytes` 与 core 的预算保持一致。
- 搜索用 rg 参数数组，无 shell 插值；原始搜索输出上限 4 MiB，超出标记 truncated。glob 在 ignore 生效后使用 minimatch 筛选；不是访问权限。
- 同一规范工作区在同一 Windows 用户的进程之间互斥。Agent 持有 OS 文件锁至关闭，锁文件位于用户临时目录并保留，句柄关闭释放锁。
- PowerShell bridge 使用 Windows Job Object；进程以 suspended 状态创建、入 Job 后恢复，取消/超时终止并排空进程树。命令超时属于未知副作用，后续执行阻断。启动桥接需要本机 .NET Add-Type 编译，未预装原生二进制。
- 文件使用同目录临时文件，更新 rename，创建独占 link。先复查版本和路径，再提交；不保证对恶意并发修改的原子 CAS，不提供多文件事务、磁盘断电恢复或 Git 回滚。NTFS 文件 ACL 等元数据不承诺完整保留。

## 验证

```sh
bun run --filter @alpha/coding-agent build
bun run --filter @alpha/coding-agent typecheck
bun run --filter @alpha/coding-agent lint
bun run --filter @alpha/coding-agent test
bun --env-file=.env.local packages/coding-agent/integration/live.js
```

最后一条是显式真实模型探针，只修改它创建的临时 fixture，验证失败测试 → 源码修复 → 测试通过 → Session 重放零副作用。普通测试离线运行；Windows 适配测试在其他平台标记 skip。

[实现规格](../../docs/coding-agent-c1-spec.md) · [验收记录](../../docs/coding-agent-c1-validation.md) · [交互文档](../../docs/coding-agent-design-c1.html) · [完整组合示例](../../docs/coding-agent-example-c1.ts)
