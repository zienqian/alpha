import type { ValidatedCall } from '@alpha/adk/core';
import type { CodingActionKind, CodingContext, CodingPlan } from '../contracts';
import { checkSignal, codeOf } from '../internal';
import { readFileTool, prepareRead } from './read-file';
import { listFilesTool, prepareList } from './list-files';
import { searchTool, prepareSearch } from './search';
import { createFileTool, prepareCreate } from './create-file';
import { editFileTool, prepareEdit } from './edit-file';
import { runCommandTool, prepareCommand } from './run-command';
import type { Prepare } from './shared';

export { readFileTool, listFilesTool, searchTool, createFileTool, editFileTool, runCommandTool };
export const codingTools = Object.freeze([readFileTool, listFilesTool, searchTool, editFileTool, createFileTool, runCommandTool]);
const preparations: Readonly<Record<string, readonly [CodingActionKind, Prepare]>> = Object.freeze({
  read_file: ['read', prepareRead], list_files: ['search', prepareList], search: ['search', prepareSearch],
  create_file: ['create', prepareCreate], edit_file: ['edit', prepareEdit], run_command: ['command', prepareCommand],
});
export async function prepareCodingCall(context: CodingContext, call: ValidatedCall, signal: AbortSignal): Promise<CodingPlan> {
  const entry = Object.hasOwn(preparations, call.name) ? preparations[call.name] : undefined;
  let plan: CodingPlan = { kind: entry?.[0] ?? 'custom', args: { ...call.arguments }, preview: { type: 'custom', description: call.name } };
  try { if (entry) plan = await entry[1](context, plan.args, signal); }
  catch (cause) { checkSignal(signal); plan = { ...plan, rejected: codeOf(cause, 'PREFLIGHT_FAILED') }; }
  return Object.freeze({ ...plan, args: Object.freeze(plan.args), preview: Object.freeze(plan.preview),
    ...(plan.write ? { write: Object.freeze(plan.write) } : {}) });
}
