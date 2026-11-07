import type { Plugin } from '@alpha/adk/core';
import type { CodingContext } from '../contracts';
import { formatSkillsForPrompt } from './format';

export function createSkillsPlugin<C>(context: CodingContext<C>): Plugin<CodingContext<C>> {
  const content = formatSkillsForPrompt(context.skills);
  const id = `coding-skills:${globalThis.crypto.randomUUID()}`;
  return {
    id: 'coding/skills', apiVersion: 1,
    setup(api) {
      api.hook('beforeModel', messages => content ? [{ id, role: 'user', content }, ...messages] : messages);
    },
  };
}
