import { createTool, type ToolContext } from '@alpha/adk/core';
import { z } from 'zod';
import type { CodingContext } from '../contracts';
import { listFiles } from '../search';
import { resolvePath } from '../files';
import { readResult, type Prepare } from './shared';

export const prepareList: Prepare = async (context, args) => ({ kind: 'search', args, preview: { type: 'path', path: await resolvePath(context.cwd, (args.path ?? '.') as string, false, true, context.fileAccess) } });
export const listFilesTool = createTool({
  name: 'list_files', effect: 'read',
  description: 'List files under path (default working directory), filtered by a relative glob and respecting ignore files. Default limit 200. Requires ripgrep.',
  input: z.strictObject({ path: z.string().min(1).max(512).optional(), glob: z.string().max(1024).optional(), limit: z.int().positive().max(1000).optional() }),
  execute: (args, ctx: ToolContext<CodingContext>) => readResult(ctx, () => listFiles(ctx.app.cwd, args, ctx.signal, ctx.app), 'compact'),
});
