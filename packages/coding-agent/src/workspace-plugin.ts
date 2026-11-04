import { createTool } from '@alpha/adk/core';
import type { JsonObject, Plugin, ToolContext, ValidatedCall } from '@alpha/adk/core';
import { z } from 'zod';
import type { CodingAction, CodingActionKind, CodingControls, CodingEvent, CodingPreview, CodingToolResult, FileSnapshot, FileWrite, WorkspaceLease } from './contracts.js';
import { byteLength, checkSignal, clip, codeOf, digest, encode, failure, positive, relativePath } from './internal.js';

const schemas = {
  read_file: z.strictObject({ path: z.string().min(1).max(512), startLine: z.int().positive().optional(), lineCount: z.int().positive().max(10000).optional() }),
  list_files: z.strictObject({ glob: z.string().max(1024).optional(), limit: z.int().positive().max(1000).optional() }),
  search: z.strictObject({ query: z.string().min(1).max(4096), glob: z.string().max(1024).optional(), limit: z.int().positive().max(1000).optional() }),
  edit_file: z.strictObject({ path: z.string().min(1).max(512), oldText: z.string().min(1).max(1048576), newText: z.string().max(1048576) }),
  create_file: z.strictObject({ path: z.string().min(1).max(512), content: z.string().max(1048576) }),
  run_command: z.strictObject({ command: z.string().min(1).max(16384), cwd: z.string().min(1).max(512).optional(), timeoutMs: z.int().positive().optional() }),
};
type Name = keyof typeof schemas;
const kinds: Record<Name, CodingActionKind> = { read_file: 'read', list_files: 'search', search: 'search', edit_file: 'edit', create_file: 'create', run_command: 'command' };
const descriptions: Record<Name, string> = {
  read_file: 'Read a UTF-8 file. Lines are 1-based. Required before edit_file. Large results are truncated.',
  list_files: 'List files in stable order using a relative glob, respecting ignore files. Default limit 200.',
  search: 'Search literal text in files, respecting ignore files. Returns line numbers. Does not replace read_file before editing.',
  edit_file: 'Replace exactly one nonempty oldText in a previously read file. Rejects stale versions and ambiguous matches.',
  create_file: 'Create a new UTF-8 file in an existing directory. Never overwrites a file.',
  run_command: 'Execute a command in the configured host shell. Requires host permission. Check exitCode; truncated output is marked.',
};
type Plan = { readonly kind: CodingActionKind; readonly preview: CodingPreview; readonly args: JsonObject;
  readonly write?: FileWrite; readonly rejected?: string };
const keyOf = (ctx: { agentId: string; runId: string; assistantId: string; callId: string }) => JSON.stringify([ctx.agentId, ctx.runId, ctx.assistantId, ctx.callId]);

export function createWorkspacePlugin<C = undefined>(options: CodingControls & { readonly maxResultBytes?: number }): Plugin<C> {
  const { workspace } = options;
  const budget = Math.min(48 * 1024, positive(options.maxResultBytes ?? 128 * 1024, 'RESULT_LIMIT'));
  if (budget < 4096) throw failure('RESULT_BUDGET_TOO_SMALL');
  const plans = new Map<string, Plan>(), observations = new Map<string, string>();
  let lease: WorkspaceLease | undefined, used = false;
  const emit = (event: CodingEvent) => {
    try { void Promise.resolve(options.onEvent?.(Object.freeze(event))).catch(() => { /* Async observation only. */ }); }
    catch { /* Observation cannot rewrite an effect. */ }
  };
  const observe = (snapshot: FileSnapshot) => {
    observations.delete(snapshot.path); observations.set(snapshot.path, snapshot.revision);
    const oldest = observations.keys().next().value;
    if (observations.size > 256 && oldest !== undefined) observations.delete(oldest);
  };
  async function prepare(call: ValidatedCall, signal: AbortSignal): Promise<Plan> {
    const kind = kinds[call.name as Name] ?? 'custom';
    const args = { ...call.arguments };
    let preview: CodingPreview = { type: 'custom', description: call.name };
    if (kind === 'custom') return Object.freeze({ kind, args: Object.freeze(args), preview: Object.freeze(preview) });
    try {
      if (typeof args.path === 'string') args.path = relativePath(args.path);
      if (kind === 'command') {
        args.cwd = relativePath((args.cwd as string | undefined) ?? '.', true);
        preview = { type: 'command', command: args.command as string, cwd: args.cwd, shell: workspace.shell };
      } else if (kind === 'edit' || kind === 'create') {
        const snapshot = await workspace.readFile(args.path as string, { signal });
        if (snapshot) args.path = snapshot.path;
        let content = args.content as string, beforeRevision: string | null = null;
        if (kind === 'create') { if (snapshot) throw failure('FILE_EXISTS'); }
        else {
          if (!snapshot) throw failure('FILE_NOT_FOUND');
          if (!observations.has(snapshot.path)) throw failure('FILE_NOT_READ');
          if (observations.get(snapshot.path) !== snapshot.revision) throw failure('FILE_CONFLICT');
          const old = args.oldText as string, index = snapshot.content.indexOf(old);
          if (index < 0) throw failure('TEXT_NOT_FOUND');
          if (snapshot.content.indexOf(old, index + 1) >= 0) throw failure('TEXT_NOT_UNIQUE');
          content = snapshot.content.slice(0, index) + args.newText + snapshot.content.slice(index + old.length);
          beforeRevision = snapshot.revision;
        }
        const diff = kind === 'create' ? `+++ ${args.path}\n${content}` : `--- ${args.path}\n${args.oldText}\n+++ ${args.path}\n${args.newText}`;
        preview = { type: 'diff', path: args.path as string, beforeRevision, diff: clip(diff, 16384), truncated: byteLength(diff) > 16384 };
        return Object.freeze({ kind, args: Object.freeze(args), preview: Object.freeze(preview), write: Object.freeze({ path: args.path as string, content, expectedRevision: beforeRevision }) });
      } else preview = { type: 'path', path: (args.path ?? args.glob ?? '.') as string };
      return Object.freeze({ kind, args: Object.freeze(args), preview: Object.freeze(preview) });
    } catch (cause) {
      checkSignal(signal);
      return Object.freeze({ kind, args: Object.freeze(args), preview: Object.freeze(preview), rejected: codeOf(cause, 'PREFLIGHT_FAILED') });
    }
  }
  async function execute(ctx: ToolContext<C>): Promise<string> {
    const key = keyOf(ctx), plan = plans.get(key); plans.delete(key);
    if (!plan || !lease) throw failure('PLAN_MISSING');
    const fail = (code: string) => encode({ ok: false, code }, budget);
    if (plan.rejected) return fail(plan.rejected);
    if (ctx.signal.aborted) return fail('CANCELLED');
    const args = plan.args;
    let result: CodingToolResult;
    if (plan.write) {
      // A thrown adapter exception has unknown write effects and must reach the core.
      const outcome = await lease.writeFile(plan.write, { signal: ctx.signal });
      if (outcome.status === 'unknown') throw failure(outcome.code);
      if (outcome.status === 'rejected') return fail(outcome.code);
      observations.delete(plan.write.path);
      emit({ type: 'file.changed', runId: ctx.runId, callId: ctx.callId, path: plan.write.path, beforeRevision: plan.write.expectedRevision, afterRevision: outcome.revision });
      result = { ok: true, data: plan.kind === 'create'
        ? { path: plan.write.path, created: true, afterRevision: outcome.revision }
        : { path: plan.write.path, changed: true, beforeRevision: plan.write.expectedRevision, afterRevision: outcome.revision } };
    } else if (plan.kind === 'command') {
      const outcome = await lease.runCommand(args as unknown as { command: string }, {
        signal: ctx.signal,
        onOutput: (channel, text) => emit({ type: 'command.output', runId: ctx.runId, callId: ctx.callId, channel, text }),
      });
      observations.clear();
      if (outcome.status === 'unknown') throw failure(outcome.code);
      if (outcome.status === 'not_started') return fail(outcome.code);
      const detail = { exitCode: outcome.exitCode, stdout: outcome.stdout, stderr: outcome.stderr, truncated: outcome.truncated };
      result = outcome.exitCode === 0 ? { ok: true, data: detail } : { ok: false, code: 'COMMAND_EXIT_NONZERO', detail };
    } else {
      try {
        if (plan.kind === 'read') {
          const snapshot = await workspace.readFile(args.path as string, { signal: ctx.signal });
          if (!snapshot) return fail('FILE_NOT_FOUND');
          observe(snapshot);
          const lines = snapshot.content.split('\n'), start = (args.startLine as number | undefined) ?? 1, count = (args.lineCount as number | undefined) ?? 200;
          const end = Math.min(lines.length, start - 1 + count);
          const content = lines.slice(start - 1, end).join('\n') + (end < lines.length && start <= lines.length ? '\n' : '');
          result = { ok: true, data: { path: snapshot.path, revision: snapshot.revision, startLine: start, content, truncated: start > 1 || end < lines.length } };
        } else if (typeof args.query === 'string') result = { ok: true, data: { ...await workspace.search(args as { query: string }, { signal: ctx.signal }) } };
        else result = { ok: true, data: { ...await workspace.listFiles(args, { signal: ctx.signal }) } };
      } catch (cause) { return fail(codeOf(cause, 'READ_FAILED')); }
    }
    return encode(result, budget);
  }
  return {
    id: 'coding/workspace', apiVersion: 1,
    setup(api) {
      if (used) throw failure('PLUGIN_ALREADY_USED'); used = true;
      for (const name of Object.keys(schemas) as Name[]) api.addTool(createTool({
        name, description: descriptions[name], input: schemas[name],
        effect: name === 'run_command' ? 'unknown' : name === 'edit_file' || name === 'create_file' ? 'write' : 'read',
        execute: (_args, ctx: ToolContext<C>) => execute(ctx),
      }));
      api.hook('authorizeTool', async (call, ctx) => {
        const plan = await prepare(call, ctx.signal), context = Object.freeze({ ...ctx, assistantId: call.assistantId, callId: call.callId });
        checkSignal(ctx.signal);
        if (plan.kind !== 'custom') plans.set(keyOf(context), plan);
        if (plan.rejected) return { action: 'allow' };
        const action: CodingAction = Object.freeze({ kind: plan.kind, workspaceId: workspace.id, call, preview: plan.preview,
          digest: await digest(JSON.stringify([workspace.id, workspace.root, workspace.shell, plan.args, plan.write ?? null, plan.preview])) });
        let decision = options.policy ? await options.policy.decide(action, context) : plan.kind === 'command' ? 'ask' : plan.kind === 'custom' ? 'deny' : 'allow';
        checkSignal(ctx.signal);
        if (decision === 'ask') decision = await options.approve?.(action, context) ?? 'deny';
        checkSignal(ctx.signal);
        return decision === 'allow' ? { action: 'allow' } : { action: 'deny', reason: 'Coding policy denied the action.' };
      });
      api.observe(event => { if (event.type === 'run.end') plans.clear(); });
    },
    async start(signal) { lease = await workspace.acquire({ signal }); },
    async dispose() { plans.clear(); observations.clear(); await lease?.release(); lease = undefined; },
  };
}
