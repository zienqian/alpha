import type { JsonObject, ToolContext } from '@alpha/adk/core';
import type { CodingContext, CodingPlan, CodingToolResult } from '../contracts.js';
import { callKey, emitCodingEvent } from '../context.js';
import { codeOf, encode, failure } from '../internal.js';
import { writeFile } from '../files.js';

export type Prepare = (context: CodingContext, args: JsonObject, signal: AbortSignal) => Promise<CodingPlan> | CodingPlan;
export const result = (ctx: ToolContext<CodingContext>, value: CodingToolResult) => encode(value, ctx.app.state.budget);
export const rejected = (ctx: ToolContext<CodingContext>, code: string) => result(ctx, { ok: false, code });
export async function readResult(ctx: ToolContext<CodingContext>, operation: () => Promise<JsonObject>): Promise<string> {
  try { return result(ctx, { ok: true, data: await operation() }); }
  catch (cause) { return rejected(ctx, codeOf(cause, 'READ_FAILED')); }
}
export function takePlan(ctx: ToolContext<CodingContext>, kind: CodingPlan['kind']): CodingPlan {
  const key = callKey(ctx), plan = ctx.app.state.plans.get(key);
  ctx.app.state.plans.delete(key);
  if (!plan || plan.kind !== kind) throw failure('PLAN_MISSING');
  return plan;
}
export async function executeWrite(ctx: ToolContext<CodingContext>, kind: 'create' | 'edit'): Promise<string> {
  const plan = takePlan(ctx, kind);
  if (plan.rejected) return rejected(ctx, plan.rejected);
  if (!plan.write) throw failure('PLAN_MISSING');
  const outcome = await writeFile(ctx.app.cwd, plan.write, ctx.signal);
  if (outcome.status === 'unknown') throw failure(outcome.code);
  if (outcome.status === 'rejected') return rejected(ctx, outcome.code);
  ctx.app.state.observations.delete(plan.write.path);
  emitCodingEvent(ctx.app, { type: 'file.changed', runId: ctx.runId, callId: ctx.callId,
    path: plan.write.path, beforeRevision: plan.write.expectedRevision, afterRevision: outcome.revision });
  return result(ctx, { ok: true, data: kind === 'create'
    ? { path: plan.write.path, created: true, afterRevision: outcome.revision }
    : { path: plan.write.path, changed: true, beforeRevision: plan.write.expectedRevision, afterRevision: outcome.revision } });
}
