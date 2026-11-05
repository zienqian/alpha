import { createTool, type ToolContext } from '@alpha/adk/core';
import { z } from 'zod';
import type { CodingContext } from '../contracts.js';
import { readFile } from '../files.js';
import { byteLength, clip, failure, relativePath } from '../internal.js';
import { executeWrite, type Prepare } from './shared.js';

export const prepareEdit: Prepare = async (context, args, signal) => {
  const snapshot = await readFile(context.cwd, relativePath(args.path as string), signal);
  if (!snapshot) throw failure('FILE_NOT_FOUND');
  const { observations } = context.state;
  if (!observations.has(snapshot.path)) throw failure('FILE_NOT_READ');
  if (observations.get(snapshot.path) !== snapshot.revision) throw failure('FILE_CONFLICT');
  const old = args.oldText as string, index = snapshot.content.indexOf(old);
  if (index < 0) throw failure('TEXT_NOT_FOUND');
  if (snapshot.content.indexOf(old, index + 1) >= 0) throw failure('TEXT_NOT_UNIQUE');
  const content = snapshot.content.slice(0, index) + args.newText + snapshot.content.slice(index + old.length);
  const diff = `--- ${snapshot.path}\n${old}\n+++ ${snapshot.path}\n${args.newText}`;
  return { kind: 'edit', args: { ...args, path: snapshot.path }, write: { path: snapshot.path, content, expectedRevision: snapshot.revision },
    preview: { type: 'diff', path: snapshot.path, beforeRevision: snapshot.revision, diff: clip(diff, 16384), truncated: byteLength(diff) > 16384 } };
};
export const editFileTool = createTool({
  name: 'edit_file', effect: 'write',
  description: 'Replace exactly one nonempty oldText in a previously read file. Rejects stale versions and ambiguous matches.',
  input: z.strictObject({ path: z.string().min(1).max(512), oldText: z.string().min(1).max(1048576), newText: z.string().max(1048576) }),
  execute: (_args, ctx: ToolContext<CodingContext>) => executeWrite(ctx, 'edit'),
});
