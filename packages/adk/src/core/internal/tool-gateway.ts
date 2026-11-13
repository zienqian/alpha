import type { Hooks, PreparedTool, Tool, ToolExecution, ToolResultMessage } from '../contracts';
import type { Run } from './run-controller';
import { Stop } from './run-controller';
import { ensure, error, safeError } from './errors';
import { freezeArguments, record, textBytes } from './json';
import { callKey, createToolResult } from './messages';
import { placeholder } from './history';

interface ToolSteering {
  hasSteering(): boolean;
  prepare<T>(operation: (signal: AbortSignal, release: () => void) => Promise<T>): Promise<T>;
}

/** One tracked operation owns the whole batch, including all work draining after a stop. */
export function callTools<C>(run: Run<C>, tools: ReadonlyMap<string, Tool<C>>, hooks: Hooks<C>, assistantId: string, steering: ToolSteering): Promise<void> {
  return run.operate(async () => {
    const calls = run.history.pending.filter(pending => pending.assistantId === assistantId);
    const active = new Set<Promise<void>>();
    try {
      for (const { call } of calls) {
        const read = tools.get(call.name)?.info.effect === 'read';
        // Writes, unknown effects and missing tools are barriers. Never move a
        // later read ahead of them, even when a concurrency slot is available.
        if (!read) await Promise.all(active);
        else if (active.size >= run.limits.maxConcurrentTools) await Promise.race(active);
        run.check();
        if (steering.hasSteering()) break;
        let ready!: () => void;
        const prepared = new Promise<void>(resolve => { ready = resolve; });
        const work = steering.prepare((signal, release) => executeTool(run, tools, hooks, assistantId, call.id, signal, () => {
          release(); ready();
        }));
        const settled = work.then(() => undefined, cause => { run.fail(cause); }).finally(() => {
          ready(); active.delete(settled);
        });
        active.add(settled);
        // Preparation and authorization stay ordered, with at most one approval
        // pending. Only execution/result processing can overlap for read tools.
        await prepared;
        if (!read) await settled;
      }
    } finally {
      // Promise.all is safe here: every tracked promise handles its rejection.
      await Promise.all(active);
    }
    run.check();
  });
}

export function callTool<C>(run: Run<C>, tools: ReadonlyMap<string, Tool<C>>, hooks: Hooks<C>, assistantId: string, callId: string, steeringSignal: AbortSignal, finishPreparation: () => void): Promise<ToolResultMessage> {
  return run.operate(() => executeTool(run, tools, hooks, assistantId, callId, steeringSignal, finishPreparation));
}

async function executeTool<C>(run: Run<C>, tools: ReadonlyMap<string, Tool<C>>, hooks: Hooks<C>, assistantId: string, callId: string, steeringSignal: AbortSignal, finishPreparation: () => void): Promise<ToolResultMessage> {
  run.check();
  const key = callKey(assistantId, callId), completed = run.completed.get(key);
  if (completed) return Promise.resolve(completed);
  ensure(run.assistants.has(assistantId), 'CALL_NOT_PENDING');
  const pending = run.history.getPending(assistantId, callId);
  ensure(pending, 'CALL_NOT_PENDING');
  let execution: ToolExecution = 'not_executed', content: string, resultCommitted = false, started = false;
  const preparationContext = Object.freeze({ ...run.context, signal: AbortSignal.any([run.context.signal, steeringSignal]) });
  const checkPreparation = () => { run.check(); preparationContext.signal.throwIfAborted(); };
  const tool = tools.get(pending.call.name);
  try {
    checkPreparation();
    ensure(tool, 'TOOL_NOT_FOUND');
    let prepared: PreparedTool<C>;
    try { prepared = await tool.prepare(pending.call.arguments, preparationContext.signal); }
    catch { throw error('TOOL_INPUT_INVALID'); }
    checkPreparation();
    ensure(record(prepared) && typeof prepared.execute === 'function', 'TOOL_INPUT_INVALID');
    const args = freezeArguments(prepared.arguments);
    Object.freeze(prepared);
    const call = Object.freeze({ assistantId, callId, name: pending.call.name, arguments: args, effect: tool.info.effect });
    let denied = false;
    for (const hook of hooks.authorizeTool ?? []) {
      let decision;
      try { decision = await hook(call, preparationContext); } catch { throw error('HOOK_FAILED'); }
      checkPreparation();
      ensure(record(decision) && (decision.action === 'allow' || decision.action === 'deny'), 'HOOK_FAILED');
      if (decision.action === 'deny') {
        ensure(typeof decision.reason === 'string', 'HOOK_FAILED');
        denied = true; break;
      }
    }
    if (denied) { execution = 'denied'; content = '[Tool execution denied.]'; }
    else {
      // From this point the tool may have effects. Steering can skip later
      // calls, but only an explicit run cancellation may abort this one.
      finishPreparation();
      run.reserveTool();
      run.emit({ type: 'tool.start', assistantId, callId, name: pending.call.name }, { effect: tool.info.effect });
      run.check();
      started = true;
      pending.fallback = tool.info.effect === 'read' ? 'failed' : 'outcome_unknown';
      execution = pending.fallback;
      let output: string;
      try { output = await prepared.execute(Object.freeze({ ...run.context, assistantId, callId })); }
      catch { throw error(tool.info.effect === 'read' ? 'TOOL_FAILED' : 'TOOL_OUTCOME_UNKNOWN'); }
      execution = 'succeeded'; pending.fallback = execution;
      ensure(typeof output === 'string' && textBytes(output) <= run.limits.maxToolResultBytes, 'TOOL_RESULT_INVALID');
      content = output;
    }
    // Once an effect is known, cancellation must never erase that fact.
    if (!run.intent) {
      for (const hook of hooks.mapToolResult ?? []) {
        let output: string;
        const result = createToolResult(pending.resultId, assistantId, callId, content, execution);
        try { output = await hook(result, run.context); } catch { throw error('TOOL_RESULT_PROCESSING'); }
        ensure(typeof output === 'string' && textBytes(output) <= run.limits.maxToolResultBytes, 'TOOL_RESULT_INVALID');
        content = output;
        if (run.intent) break;
      }
    }
    const result = run.toolResult(assistantId, callId, content, execution);
    resultCommitted = true;
    run.check();
    return result;
  } catch (cause) {
    if (!started && !resultCommitted && !run.intent && steeringSignal.aborted) {
      const result = run.toolResult(assistantId, callId, '[Skipped for steering.]', 'not_executed');
      run.check();
      return result;
    }
    run.fail(cause instanceof Stop ? cause : safeError(cause, 'TOOL_FAILED'));
    if (!resultCommitted) run.toolResult(assistantId, callId, placeholder, execution);
    throw new Stop();
  }
}
