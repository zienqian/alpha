import { createTool, type ToolContext } from '@alpha/adk/core';
import { z } from 'zod';
import type { CodingContext } from '../contracts.js';
import { readFile } from '../files.js';
import { byteLength, clip, failure, relativePath } from '../internal.js';
import { executeWrite, type Prepare } from './shared.js';

export const prepareCreate: Prepare = async (context, args, signal) => {
  const path = relativePath(args.path as string), content = args.content as string;
  if (await readFile(context.cwd, path, signal)) throw failure('FILE_EXISTS');
  const diff = `+++ ${path}\n${content}`;
  return { kind: 'create', args: { ...args, path }, write: { path, content, expectedRevision: null },
    preview: { type: 'diff', path, beforeRevision: null, diff: clip(diff, 16384), truncated: byteLength(diff) > 16384 } };
};
export const createFileTool = createTool({
  name: 'create_file', effect: 'write',
  description: 'Create a new UTF-8 file in an existing directory. Never overwrites a file.',
  input: z.strictObject({ path: z.string().min(1).max(512), content: z.string().max(1048576) }),
  execute: (_args, ctx: ToolContext<CodingContext>) => executeWrite(ctx, 'create'),
});
