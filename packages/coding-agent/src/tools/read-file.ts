import { createTool, type ToolContext } from '@alpha/adk/core';
import { z } from 'zod';
import type { CodingContext } from '../contracts';
import { readFile, resolvePath } from '../files';
import { failure, relativePath } from '../internal';
import { readResult, type Prepare } from './shared';

export const prepareRead: Prepare = async (context, args) => ({ kind: 'read', args,
  preview: { type: 'path', path: context.fileAccess === 'host'
    ? await resolvePath(context.cwd, args.path as string, false, false, context.fileAccess) : relativePath(args.path as string) } });
export const readFileTool = createTool({
  name: 'read_file', effect: 'read',
  description: 'Read a UTF-8 file. Lines are 1-based. Required before edit_file. Large results are truncated.',
  input: z.strictObject({ path: z.string().min(1).max(512), startLine: z.int().positive().optional(), lineCount: z.int().positive().max(10000).optional() }),
  execute: (args, ctx: ToolContext<CodingContext>) => readResult(ctx, async () => {
    const snapshot = await readFile(ctx.app.cwd, args.path, ctx.signal, undefined, ctx.app.fileAccess);
    if (!snapshot) throw failure('FILE_NOT_FOUND');
    const observations = ctx.app.state.observations;
    observations.delete(snapshot.path); observations.set(snapshot.path, snapshot.revision);
    const oldest = observations.keys().next().value;
    if (observations.size > 256 && oldest !== undefined) observations.delete(oldest);
    const lines = snapshot.content.split('\n'), start = args.startLine ?? 1, count = args.lineCount ?? 200;
    const end = Math.min(lines.length, start - 1 + count);
    const content = lines.slice(start - 1, end).join('\n') + (end < lines.length && start <= lines.length ? '\n' : '');
    return { path: snapshot.path, revision: snapshot.revision, startLine: start, content, truncated: start > 1 || end < lines.length };
  }),
});
