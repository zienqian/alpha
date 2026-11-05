import type { ToolContext } from '@alpha/adk/core';
import type { CodingContext, CodingContextOptions, CodingEvent } from './contracts.js';
import { selectShell } from './process/shell.js';
import { failure, positive } from './internal.js';

export function createCodingContext<C = undefined>(options: CodingContextOptions<C>): CodingContext<C> {
  const budget = Math.min(48 * 1024, positive(options.maxResultBytes ?? 128 * 1024, 'RESULT_LIMIT'));
  if (budget < 4096) throw failure('RESULT_BUDGET_TOO_SMALL');
  return Object.freeze({
    cwd: options.cwd, shell: selectShell({ configured: options.shell }), data: options.appContext as C,
    controls: Object.freeze({ policy: options.policy, approve: options.approve, onEvent: options.onEvent }),
    state: { budget, plans: new Map(), observations: new Map(), used: false },
  });
}

export const callKey = (ctx: Pick<ToolContext<unknown>, 'agentId' | 'runId' | 'assistantId' | 'callId'>) =>
  JSON.stringify([ctx.agentId, ctx.runId, ctx.assistantId, ctx.callId]);

export function emitCodingEvent(context: CodingContext, event: CodingEvent): void {
  try { void Promise.resolve(context.controls.onEvent?.(Object.freeze(event))).catch(() => { /* Observation only. */ }); }
  catch { /* Observation cannot rewrite an effect. */ }
}
