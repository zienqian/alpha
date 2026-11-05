import { createTool, type ToolContext } from '@alpha/adk/core';
import { z } from 'zod';
import type { CodingContext } from '../contracts.js';
import { searchFiles } from '../search.js';
import { readResult, type Prepare } from './shared.js';

export const prepareSearch: Prepare = (_context, args) => ({ kind: 'search', args, preview: { type: 'path', path: (args.glob ?? '.') as string } });
export const searchTool = createTool({
  name: 'search', effect: 'read',
  description: 'Search literal text in files, respecting ignore files. Returns line numbers. Does not replace read_file before editing. Requires ripgrep.',
  input: z.strictObject({ query: z.string().min(1).max(4096), glob: z.string().max(1024).optional(), limit: z.int().positive().max(1000).optional() }),
  execute: (args, ctx: ToolContext<CodingContext>) => readResult(ctx, () => searchFiles(ctx.app.cwd, args, ctx.signal)),
});
