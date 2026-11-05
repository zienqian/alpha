import { createTool, type ToolContext } from '@alpha/adk/core';
import { z } from 'zod';
import type { CodingContext, CommandInput } from '../contracts.js';
import { emitCodingEvent } from '../context.js';
import { failure, relativePath } from '../internal.js';
import { resolvePath } from '../files.js';
import { runCommand } from '../process/run-command.js';
import { rejected, result, takePlan, type Prepare } from './shared.js';

export const prepareCommand: Prepare = async (context, args) => {
  if (!context.shell) throw failure('SHELL_UNAVAILABLE');
  const cwd = relativePath((args.cwd as string | undefined) ?? '.', true);
  const absoluteCwd = await resolvePath(context.cwd, cwd, false, true);
  return { kind: 'command', args: { ...args, cwd },
    preview: { type: 'command', command: args.command as string, cwd: absoluteCwd, shell: context.shell.path } };
};
export const runCommandTool = createTool({
  name: 'run_command', effect: 'unknown',
  description: 'Execute a command in the configured host shell shown in the system instructions. Requires host permission. Check exitCode and outputIncomplete. Shell exit codes are returned as reported by that shell.',
  input: z.strictObject({ command: z.string().min(1).max(16384), cwd: z.string().min(1).max(512).optional(), timeoutMs: z.int().positive().max(60000).optional() }),
  async execute(_args, ctx: ToolContext<CodingContext>) {
    const plan = takePlan(ctx, 'command');
    if (plan.rejected) return rejected(ctx, plan.rejected);
    const outcome = await runCommand(ctx.app.cwd, ctx.app.shell, plan.args as unknown as CommandInput, {
      signal: ctx.signal,
      onOutput: (channel, text) => emitCodingEvent(ctx.app, { type: 'command.output', runId: ctx.runId, callId: ctx.callId, channel, text }),
    });
    if (outcome.status !== 'not_started') ctx.app.state.observations.clear();
    if (outcome.status === 'unknown') throw failure(outcome.code);
    if (outcome.status === 'not_started') return rejected(ctx, outcome.code);
    const detail = { exitCode: outcome.exitCode, stdout: outcome.stdout, stderr: outcome.stderr, truncated: outcome.truncated, outputIncomplete: outcome.outputIncomplete };
    return result(ctx, outcome.exitCode === 0 ? { ok: true, data: detail } : { ok: false, code: 'COMMAND_EXIT_NONZERO', detail });
  },
});
