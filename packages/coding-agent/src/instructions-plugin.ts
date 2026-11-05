import type { Plugin } from '@alpha/adk/core';
import { readFile } from './files.js';
import { byteLength, failure, positive, relativePath } from './internal.js';

export function createProjectInstructionsPlugin<C = undefined>(options: {
  readonly cwd: string; readonly file?: string; readonly maxBytes?: number;
}): Plugin<C> {
  const file = relativePath(options.file ?? 'AGENTS.md');
  const max = positive(options.maxBytes ?? 32768, 'INSTRUCTION_LIMIT', 1048576);
  const id = `coding-instructions:${globalThis.crypto.randomUUID()}`;
  let content = '', used = false;
  return {
    id: 'coding/project-instructions', apiVersion: 1,
    setup(api) {
      if (used) throw failure('PLUGIN_ALREADY_USED');
      used = true;
      api.hook('beforeModel', messages => content ? [
        { id, role: 'user', content: `Project instructions from ${file}:\n${content}` }, ...messages,
      ] : messages);
    },
    async start(signal) {
      const snapshot = await readFile(options.cwd, file, signal);
      content = snapshot?.content ?? '';
      if (byteLength(content) > max) throw failure('PROJECT_INSTRUCTIONS_TOO_LARGE');
    },
    dispose() { content = ''; },
  };
}
