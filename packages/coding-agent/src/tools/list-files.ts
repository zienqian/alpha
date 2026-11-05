import { createTool, type ToolContext } from '@alpha/adk/core';
import { z } from 'zod';
import type { CodingContext } from '../contracts';
import { listFiles } from '../search';
import { readResult, type Prepare } from './shared';

export const prepareList: Prepare = (_context, args) => ({ kind: 'search', args, preview: { type: 'path', path: (args.glob ?? '.') as string } });
export const listFilesTool = createTool({
  name: 'list_files', effect: 'read',
  description: 'List files in stable order using a relative glob, respecting ignore files. Default limit 200. Requires ripgrep.',
  input: z.strictObject({ glob: z.string().max(1024).optional(), limit: z.int().positive().max(1000).optional() }),
  execute: (args, ctx: ToolContext<CodingContext>) => readResult(ctx, () => listFiles(ctx.app.cwd, args, ctx.signal)),
});
