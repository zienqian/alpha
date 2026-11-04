import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

test('published root graph excludes Node workspace adapter, Session and runtime Provider imports', async () => {
  const visited = new Set();
  async function inspect(url) {
    if (visited.has(url.href)) return; visited.add(url.href);
    const source = await readFile(url, 'utf8');
    for (const match of source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      assert.equal(specifier.startsWith('node:'), false, `${fileURLToPath(url)} imports ${specifier}`);
      assert.equal(specifier.includes('/node/'), false);
      assert.equal(specifier.startsWith('@alpha/adk-session'), false);
      assert.equal(specifier.startsWith('@alpha/provider'), false);
      if (specifier.startsWith('.')) await inspect(new URL(specifier, url));
    }
  }
  await inspect(new URL('../dist/index.js', import.meta.url)); assert.ok(visited.size >= 5);
  const root = await import('../dist/index.js');
  assert.deepEqual(Object.keys(root).sort(), ['createCodingAgent', 'createProjectInstructionsPlugin', 'createWorkspacePlugin']);
  const node = await import('../dist/node/index.js'); assert.deepEqual(Object.keys(node), ['createLocalWorkspace']);
  for (const name of ['bridge.cs', 'bridge.ps1']) assert.ok((await readFile(new URL(`../dist/node/${name}`, import.meta.url))).length > 0);
});
