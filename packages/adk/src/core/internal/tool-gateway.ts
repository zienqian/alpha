import type { Hooks, PreparedTool, Tool, ToolExecution, ToolResultMessage } from '../contracts';
import type { Run } from './run-controller';
import { Stop } from './run-controller';
import { ensure, error, safeError } from './errors';
import { freezeArguments, record, textBytes } from './json';
import { callKey, createToolResult } from './messages';
import { placeholder } from './history';

export function callTool<C>(run: Run<C>, tools: ReadonlyMap<string, Tool<C>>, hooks: Hooks<C>, assistantId: string, callId: string): Promise<ToolResultMessage> {
  run.check();
  const key = callKey(assistantId, callId), completed = run.completed.get(key);
  if (completed) return Promise.resolve(completed);
  return run.operate(async () => {
    ensure(run.assistants.has(assistantId), 'CALL_NOT_PENDING');
    const pending = run.history.getPending(assistantId, callId);
    ensure(pending, 'CALL_NOT_PENDING');
    let execution: ToolExecution = 'not_executed', content: string, resultCommitted = false;
    const tool = tools.get(pending.call.name);
    try {
      ensure(tool, 'TOOL_NOT_FOUND');
      let prepared: PreparedTool<C>;
      try { prepared = await tool.prepare(pending.call.arguments, run.context.signal); }
      catch { throw error('TOOL_INPUT_INVALID'); }
      run.check();
      ensure(record(prepared) && typeof prepared.execute === 'function', 'TOOL_INPUT_INVALID');
      const args = freezeArguments(prepared.arguments);
      Object.freeze(prepared);
      const call = Object.freeze({ assistantId, callId, name: pending.call.name, arguments: args, effect: tool.info.effect });
      let denied = false;
      for (const hook of hooks.authorizeTool ?? []) {
        let decision;
        try { decision = await hook(call, run.context); } catch { throw error('HOOK_FAILED'); }
        run.check();
        ensure(record(decision) && (decision.action === 'allow' || decision.action === 'deny'), 'HOOK_FAILED');
        if (decision.action === 'deny') {
          ensure(typeof decision.reason === 'string', 'HOOK_FAILED');
          denied = true; break;
        }
      }
      if (denied) { execution = 'denied'; content = '[Tool execution denied.]'; }
      else {
        run.reserveTool();
        run.emit({ type: 'tool.start', assistantId, callId, name: pending.call.name });
        run.check();
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
      run.fail(cause instanceof Stop ? cause : safeError(cause, 'TOOL_FAILED'));
      if (!resultCommitted) run.toolResult(assistantId, callId, placeholder, execution);
      throw new Stop();
    }
  });
}
