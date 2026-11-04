// Refresh the review attachment from the implemented contracts; no ambient stub is used for typechecking.
import { readFile, writeFile } from 'node:fs/promises';
const base = new URL('../', import.meta.url), docs = new URL('../../../docs/', import.meta.url);
const contracts = (await readFile(new URL('src/contracts.ts', base), 'utf8')).replaceAll('\r\n', '\n');
const local = (await readFile(new URL('src/node/local-workspace.ts', base), 'utf8')).replaceAll('\r\n', '\n');
const localOptions = local.slice(local.indexOf('export interface LocalWorkspaceOptions'), local.indexOf('\nconst hash'));
const factories = `
/** Ordinary core Agent, using the same Loop and public contracts. */
export function createCodingAgent<C = undefined>(options: CodingAgentOptions<C>): Promise<Agent<C>>;
/** maxResultBytes must match a lower core limit when assembling manually; minimum 4096. */
export function createWorkspacePlugin<C = undefined>(options: CodingControls & { readonly maxResultBytes?: number }): Plugin<C>;
export function createProjectInstructionsPlugin<C = undefined>(options: {
  readonly workspace: CodingWorkspace; readonly file?: string; readonly maxBytes?: number;
}): Plugin<C>;
`;
const indent = text => text.split('\n').map(line => line ? '  ' + line : line).join('\n');
const api = `/**
 * Alpha Coding Agent C1 — implemented API snapshot, 2026-11-04.
 * Generated from package contracts by packages/coding-agent/scripts/sync-docs.js.
 * Review attachment only. Consumers import the package; examples check its real emitted types.
 */
declare module '@alpha/coding-agent' {
${indent(contracts.replace('AgentOptions, Awaitable', 'Agent, AgentOptions, Awaitable'))}
${indent(factories)}}

declare module '@alpha/coding-agent/node' {
  import type { CodingWorkspace } from '@alpha/coding-agent';
${indent(localOptions)}
  export function createLocalWorkspace(options: LocalWorkspaceOptions): Promise<CodingWorkspace>;
}
`;
await writeFile(new URL('coding-agent-api-c1.d.ts', docs), api);
let html = await readFile(new URL('coding-agent-design-c1.html', docs), 'utf8');
const dataPattern = /<script id="design-data" type="application\/json">([\s\S]*?)<\/script>/;
const data = JSON.parse(html.match(dataPattern)[1]);
data.api.types.code = api;
data.api.types.label = 'Coding C1 已实现 · 公开类型';
data.api.types.hint = '与包内公开契约同步；组合示例针对实际 dist 声明检查，不使用提案 stub。根入口不加载 Node 文件/进程实现。';
data.api.minimal.label = '最小使用 · 已实现 API';
data.api.session.hint = data.api.session.hint.replace('C1 的 coding 领域工具仍是设计稿。', 'C1 六工具与 Session 插件的组合、重放和补写已验证。');
// Preserve the explanatory samples and seven pinned community-research snapshots.
for (const panel of Object.values(data.api)) panel.code = panel.code.replaceAll('C1 PROPOSAL ONLY', 'C1 IMPLEMENTED');
html = html.replace(dataPattern, () => `<script id="design-data" type="application/json">${JSON.stringify(data).replaceAll('<', '\\u003c')}</script>`);
const replacements = [
  ['Coding Agent C1 尚未实现', 'Coding Agent C1 已实现'],
  ['建议 API · 设计稿，包尚未实现', '公开 API · C1 已实现'],
  ['<strong>本次交付是设计与 API 评审稿。</strong>7 个社区项目的调研保留；Session S2 与通用运行边界已实现并验证：执行统一为 agent.prompt，会话通过插件接入。C1 coding 包及六个领域工具仍待实现；类型附件只覆盖其提案。', '<strong>C1 已实现并通过真实模型修复验证。</strong>独立 Coding 包提供六工具、工作区租约、宿主审批与项目指令；复用 core 唯一 Loop，Session 通过插件接入。7 个社区项目调研保留。<a href="coding-agent-c1-spec.md">实现规格</a> · <a href="coding-agent-c1-validation.md">验收记录</a> · <a href="../packages/coding-agent/README.md">使用说明</a> · '],
  ['已实现的是通用 Session S2 和 core 运行边界。Coding C1 的文件、搜索、命令工具及 createCodingAgent 仍为设计提案，本次没有实现。', 'Coding C1 与 Session S2 已实现：createCodingAgent 返回普通 core Agent，文件/命令由工作区插件提供，会话通过 createSessionPlugin 组合。'],
  ['Node fs、搜索程序、PowerShell / Bash、进程树控制和工作区租约；具体依赖实施前核对', 'Node fs、rg + minimatch、Windows PowerShell 7、路径与输出控制和 OS 独占租约；Bash / 其他平台明确拒绝'],
  ['实施前验证实际进程树控制和独占工作区锁。', '已实测跨进程独占锁、取消/超时回收 detached 子进程与孙进程，以及宿主死亡后的释放。'],
  ['后续 C1 复用这条已经验证的接入路径。', 'C1 已复用并验证这条接入路径。'],
  ['<summary>实施前需要完成的技术预演</summary>', '<summary>已落实的实现选择与边界</summary>'],
  ['Windows 工作区独占锁与进程树收束：选择可安装的实现，证明跨进程所有权和崩溃释放；缺实现时明确失败，不能静默退化成 Map 锁。', 'Windows：PowerShell 7 bridge 持有 FileShare.None OS 锁；CreateProcess suspended 后加入 Job Object 再恢复。跨进程抢锁与孙进程收束有真实测试。'],
  ['Node 的单文件替换、权限、链接和 Windows 文件占用语义：确认可保证的窗口；不宣称通用原子文件 CAS。', '文件：严格 UTF-8、BOM/CRLF 保留、同目录临时文件 + rename / 独占 link；路径和版本重检，不宣称恶意外部并发下的原子 CAS 或 ACL 完整保留。'],
  ['搜索 / glob 依赖与输入转义：rg 用参数数组启动；匹配表达式、输出量和目录范围都受限。命令工具则明确执行 shell 字符串。', '搜索：rg 固定参数数组 + 字面匹配，先尊重 ignore，再由 minimatch 筛选 glob；原始输出上限 4 MiB。命令工具执行宿主批准的 shell 字符串。'],
  ['根入口采用具体 schema 实现的依赖取舍：core 仍只认识标准协议；C1 工具可选用现有 Zod 4，但需核对包体积和声明，不能把它移进内核。', 'schema：Coding 包使用现有 Zod 4 单 schema；core 无改动，仍只使用标准协议。根入口不加载 Node adapter 或 Session。'],
  ['后续真实联调复用已确认的 <code>http://127.0.0.1:3425/v1</code> / <code>codex/gpt-6.1-sol</code>。后续 Session S2 实施已用该端点验证运行边界、SQLite 重开和去重；这些证据不代表六个 coding 工具已经实现或验收。', '真实修复已通过 <code>http://127.0.0.1:3425/v1</code> / <code>codex/gpt-6.1-sol</code>：5 次模型调用、2 次测试命令、1 次源码修改；测试从 exit 1 到 exit 0，测试文件未改。Session 原 Agent / 重新接入重放均为零新增副作用。'],
  ["implementation:false,exportedAt:", "implementation:true,exportedAt:"],
];
for (const [before, after] of replacements) html = html.replaceAll(before, after);
await writeFile(new URL('coding-agent-design-c1.html', docs), html);
