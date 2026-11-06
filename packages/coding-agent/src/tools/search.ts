import { createTool, type ToolContext } from '@alpha/adk/core';
import { z } from 'zod';
import type { CodingContext } from '../contracts';
import { searchFiles } from '../search';
import { resolvePath } from '../files';
import { readResult, type Prepare } from './shared';

export const prepareSearch: Prepare = async (context, args) => ({ kind: 'search', args, preview: { type: 'path', path: await resolvePath(context.cwd, (args.path ?? '.') as string, false, true, context.fileAccess) } });
export const searchTool = createTool({
  name: 'search', effect: 'read',
  description: 'Search literal text under path (default working directory), respecting ignore files. Returns file paths and line numbers. Does not replace read_file before editing. Requires ripgrep.',
  input: z.strictObject({ path: z.string().min(1).max(512).optional(), query: z.string().min(1).max(4096), glob: z.string().max(1024).optional(), limit: z.int().positive().max(1000).optional() }),
  execute: (args, ctx: ToolContext<CodingContext>) => readResult(ctx, () => searchFiles(ctx.app.cwd, args, ctx.signal, ctx.app)),
});
