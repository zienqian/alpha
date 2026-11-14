import type { ToolContext } from '@alpha/adk/core';
import type { CodingContext, CodingContextOptions, CodingEvent } from './contracts';
import { selectShell } from './process/shell';
import { failure, positive } from './internal';
import { validateSkillMetadata } from './skills/read';
import { maxArtifactBytes } from '@alpha/adk-artifact';

export function createCodingContext<C = undefined>(options: CodingContextOptions<C>): CodingContext<C> {
  if (options.skills !== undefined && !Array.isArray(options.skills)) throw failure('SKILL_INVALID_METADATA');
  const names = new Set<string>();
  const skills = Object.freeze((options.skills ?? []).map(skill => {
    validateSkillMetadata(skill);
    if (names.has(skill.name)) throw failure('SKILL_DUPLICATE_NAME');
    names.add(skill.name);
    return Object.freeze({ ...skill });
  }));
  const budget = Math.min(48 * 1024, positive(options.maxResultBytes ?? 128 * 1024, 'RESULT_LIMIT'));
  if (budget < 4096) throw failure('RESULT_BUDGET_TOO_SMALL');
  const fileAccess = options.fileAccess ?? 'workspace';
  if (fileAccess !== 'workspace' && fileAccess !== 'host') throw failure('INVALID_FILE_ACCESS');
  const commandTimeoutMs = options.commandTimeoutMs === null ? null : positive(options.commandTimeoutMs ?? 60000, 'COMMAND_TIMEOUT', 2_147_483_647);
  const artifacts = options.artifacts ? Object.freeze({ store: options.artifacts.store, scope: Object.freeze({ ...options.artifacts.scope }),
    maxOutputBytes: positive(options.artifacts.maxOutputBytes ?? maxArtifactBytes, 'ARTIFACT_LIMIT', maxArtifactBytes) }) : undefined;
  return Object.freeze({
    artifacts, readContext: options.readContext ?? (artifacts ? request => artifacts.store.read(artifacts.scope, request) : undefined),
    skills,
    fileAccess, commandTimeoutMs,
    cwd: options.cwd, shell: selectShell({ configured: options.shell }), data: options.appContext as C,
    controls: Object.freeze({ policy: options.policy, approve: options.approve, onEvent: options.onEvent }),
    state: { budget, plans: new Map(), observations: new Map(), skillReads: new Map(), used: false },
  });
}

export const callKey = (ctx: Pick<ToolContext<unknown>, 'agentId' | 'runId' | 'assistantId' | 'callId'>) =>
  JSON.stringify([ctx.agentId, ctx.runId, ctx.assistantId, ctx.callId]);

export function emitCodingEvent(context: CodingContext, event: CodingEvent): void {
  try { void Promise.resolve(context.controls.onEvent?.(Object.freeze(event))).catch(() => { /* Observation only. */ }); }
  catch { /* Observation cannot rewrite an effect. */ }
}
