import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('published root exposes static tools without Workspace, Session or runtime Provider imports', async () => {
  const visited = new Set();
  async function inspect(url) {
    if (visited.has(url.href)) return; visited.add(url.href);
    const source = await readFile(url, 'utf8');
    for (const match of source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      assert.equal(specifier.includes('/node/'), false);
      assert.equal(specifier.startsWith('@alpha/adk-session'), false);
      assert.equal(specifier.startsWith('@alpha/provider'), false);
      if (specifier.startsWith('.')) await inspect(pathToFileURL(Bun.resolveSync(specifier, dirname(fileURLToPath(url)))));
    }
  }
  await inspect(new URL('../dist/index.js', import.meta.url)); assert.ok(visited.size >= 5);
  const root = await import('../dist/index');
  assert.deepEqual(Object.keys(root).sort(), ['codingTools', 'createCodingAgent', 'createFileTool', 'createProjectInstructionsPlugin', 'editFileTool', 'formatSkillsForPrompt', 'listFilesTool', 'loadSkills', 'readContextTool', 'readFileTool', 'readSkill', 'readSkillTool', 'runCommandTool', 'searchTool']);
});
