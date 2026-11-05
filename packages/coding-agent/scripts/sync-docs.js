// Review attachment only; examples typecheck against the real emitted package declarations.
import { readFile, writeFile } from 'node:fs/promises';
const base = new URL('../', import.meta.url), docs = new URL('../../../docs/', import.meta.url);
const contracts = (await readFile(new URL('src/contracts.ts', base), 'utf8'))
  .replaceAll('\r\n', '\n')
  .replace("import type { Shell } from './process/shell.js';\n", '')
  .replace('AgentOptions, AppOption', 'Agent, Plugin, Tool, AgentOptions, AppOption')
  .replace('export interface CodingPlan', 'interface CodingPlan')
  .replace('export type CodingContextOptions', 'type CodingContextOptions');
const factories = `
export interface Shell { readonly path: string; readonly family: 'posix' | 'powershell' | 'cmd'; }
export function createCodingAgent<C = undefined>(options: CodingAgentOptions<C>): Promise<Agent<CodingContext<C>>>;
export const codingTools: readonly Tool<CodingContext>[];
export const readFileTool: Tool<CodingContext>;
export const listFilesTool: Tool<CodingContext>;
export const searchTool: Tool<CodingContext>;
export const editFileTool: Tool<CodingContext>;
export const createFileTool: Tool<CodingContext>;
export const runCommandTool: Tool<CodingContext>;
export function createProjectInstructionsPlugin<C = undefined>(options: {
  readonly cwd: string; readonly file?: string; readonly maxBytes?: number;
}): Plugin<C>;
`;
const indent = text => text.split('\n').map(line => line ? '  ' + line : line).join('\n');
await writeFile(new URL('coding-agent-api-c1.d.ts', docs), `/** Alpha Coding Agent R3 — generated API snapshot, 2026-11-06. */
declare module '@alpha/coding-agent' {
${indent(contracts)}
${indent(factories)}
}
`);
