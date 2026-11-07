import { createTool, type ToolContext } from '@alpha/adk/core';
import { z } from 'zod';
import type { CodingContext } from '../contracts';
import { byteLength, codeOf, failure } from '../internal';
import { readSkill, validateSkillFile } from '../skills/read';
import { rejected, type Prepare } from './shared';

function findSkill(context: CodingContext, name: string) {
  const skill = context.skills.find(entry => entry.name === name);
  if (!skill) throw failure('SKILL_NOT_FOUND');
  if (skill.disableModelInvocation) throw failure('SKILL_MODEL_INVOCATION_DISABLED');
  return skill;
}

export const prepareReadSkill: Prepare = async (context, args, signal) => {
  const skill = findSkill(context, args.name as string);
  await validateSkillFile(skill, signal);
  return { kind: 'read', args, preview: { type: 'path', path: skill.filePath } };
};

export const readSkillTool = createTool({
  name: 'readSkill', effect: 'read',
  description: 'Read the complete instructions of an available skill by name. This does not execute scripts or grant additional tool permissions.',
  input: z.strictObject({ name: z.string().min(1).max(64) }),
  async execute(args, ctx: ToolContext<CodingContext>) {
    try {
      const usage = ctx.app.state.skillReads.get(ctx.runId) ?? { calls: 0, bytes: 0 };
      ctx.app.state.skillReads.set(ctx.runId, usage);
      if (++usage.calls > 8) throw failure('SKILL_READ_LIMIT');
      const content = await readSkill(findSkill(ctx.app, args.name), { signal: ctx.signal });
      const output = JSON.stringify({ ok: true, data: content });
      const bytes = byteLength(output);
      if (bytes > ctx.app.state.budget) throw failure('SKILL_CONTENT_TOO_LARGE');
      if (usage.bytes + bytes > 128 * 1024) throw failure('SKILL_READ_LIMIT');
      usage.bytes += bytes;
      return output;
    } catch (cause) { return rejected(ctx, codeOf(cause, 'SKILL_READ_FAILED')); }
  },
});
