import type { JsonObject, ToolContext } from '@alpha/adk/core';
import type { CodingContext, CodingPlan, CodingToolResult } from '../contracts';
import { callKey, emitCodingEvent } from '../context';
import { codeOf, encode, failure, type OutputMode } from '../internal';
import { writeFile } from '../files';
import { saveFileArtifact } from '../file-artifacts';

export type Prepare = (context: CodingContext, args: JsonObject, signal: AbortSignal) => Promise<CodingPlan> | CodingPlan;
export const result = (ctx: ToolContext<CodingContext>, value: CodingToolResult, mode: OutputMode = 'exact') => encode(value, ctx.app.state.budget, mode);
export const rejected = (ctx: ToolContext<CodingContext>, code: string) => result(ctx, { ok: false, code });
export async function readResult(ctx: ToolContext<CodingContext>, operation: () => Promise<JsonObject>, mode: OutputMode = 'exact'): Promise<string> {
  try { return result(ctx, { ok: true, data: await operation() }, mode); }
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
  const outcome = await writeFile(ctx.app.cwd, plan.write, ctx.signal, undefined, ctx.app.fileAccess);
  if (outcome.status === 'unknown') throw failure(outcome.code);
  if (outcome.status === 'rejected') return rejected(ctx, outcome.code);
  ctx.app.state.observations.delete(plan.write.path);
  emitCodingEvent(ctx.app, { type: 'file.changed', runId: ctx.runId, callId: ctx.callId,
    path: plan.write.path, beforeRevision: plan.write.expectedRevision, afterRevision: outcome.revision });
  const evidence = await saveFileArtifact(ctx, plan.write, outcome.revision);
  return result(ctx, { ok: true, data: kind === 'create'
    ? { path: plan.write.path, created: true, afterRevision: outcome.revision, ...evidence }
    : { path: plan.write.path, changed: true, beforeRevision: plan.write.expectedRevision, afterRevision: outcome.revision, ...evidence } });
}
