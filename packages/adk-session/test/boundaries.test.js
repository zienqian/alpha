import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { ESLint } from 'eslint';
import * as session from '@alpha/adk-session';
import * as sqlite from '@alpha/adk-session/sqlite';

test('exports expose only factories and private implementation entry points remain inaccessible', async () => {
  assert.deepEqual(Object.keys(session).sort(), ['createMemorySessionStore', 'createSession', 'createSessionManager', 'createSessionPlugin']);
  assert.deepEqual(Object.keys(sqlite), ['createSqliteSessionStore']);
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(manifest.exports).sort(), ['.', './sqlite']);
  // Bun permits package.json metadata imports even when exports omits it.
  // Implementation modules must still remain inaccessible by package subpath.
  for (const name of ['@alpha/adk-session/internal/session.js', '@alpha/adk-session/dist/index.js', '@alpha/adk-session/src/contracts.ts']) {
    await assert.rejects(import(name), { code: 'ERR_MODULE_NOT_FOUND' });
  }
});

test('Memory and SQLite work without external drivers in a fresh Bun process', async () => {
  // Copy the emitted package outside the workspace so dependency resolution
  // cannot pick up any dependencies from workspace node_modules.
  const dir = await mkdtemp(join(tmpdir(), 'alpha-session-boundary-'));
  await using cleanup = { async [Symbol.asyncDispose]() {
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith('alpha-session-boundary-'));
    await rm(dir, { recursive: true, force: true });
  } };
  await cp(new URL('../dist/', import.meta.url), join(dir, 'dist'), { recursive: true });
  const script = `import assert from 'node:assert/strict';
    import { createMemorySessionStore } from './dist/index';
    import { createSqliteSessionStore } from './dist/sqlite/index';
    assert.ok(process.versions.bun);
    const store = createMemorySessionStore(); assert.equal(store.durability, 'memory'); await store.close();
    const sqlite = await createSqliteSessionStore({ filename: 'session.db' }); assert.equal(sqlite.durability, 'transactional'); await sqlite.close();`;
  const probe = join(dir, 'probe.mjs');
  await writeFile(probe, script);
  // Disable Bun's automatic cache/registry installation for standalone scripts.
  const result = Bun.spawnSync([process.execPath, '--no-install', probe], { cwd: dir, env: { ...process.env, NODE_PATH: '' }, windowsHide: true, timeout: 10000 });
  assert.equal(result.exitCode, 0, result.stderr.toString());
});

test('emitted root dependency graph has no external runtime imports or SQLite path', () => {
  const visited = new Set();
  function visitFile(url) {
    if (visited.has(url.href)) return; visited.add(url.href);
    assert.ok(!url.href.includes('/sqlite/'));
    const source = ts.createSourceFile(url.pathname, readFileSync(url, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        const specifier = node.moduleSpecifier.text;
        assert.ok(specifier.startsWith('.') || specifier.startsWith('node:'), specifier);
        if (specifier.startsWith('.')) visitFile(pathToFileURL(Bun.resolveSync(specifier, dirname(fileURLToPath(url)))));
      }
      assert.ok(!(ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword), 'No hidden dynamic root dependencies');
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  visitFile(new URL('../dist/index.js', import.meta.url)); assert.ok(visited.size >= 6);
  for (const pkg of ['adk', 'provider']) {
    const dir = new URL(`../../${pkg}/`, import.meta.url), manifest = JSON.parse(readFileSync(new URL('package.json', dir)));
    assert.equal(manifest.dependencies?.['@alpha/adk-session'], undefined);
    function walk(folder) {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), folder);
        if (entry.isDirectory()) walk(url);
        else if (entry.name.endsWith('.ts')) assert.ok(!readFileSync(url, 'utf8').includes('@alpha/adk-session'));
      }
    }
    walk(new URL('src/', dir));
  }
});

test('Session lint allows public core types and rejects runtime/private/provider/driver imports', async () => {
  const eslint = new ESLint({ cwd: fileURLToPath(new URL('../../../', import.meta.url)) });
  const filePath = fileURLToPath(new URL('../src/boundary-probe.ts', import.meta.url));
  const [valid] = await eslint.lintText('import type { Agent } from "@alpha/adk/core"; export type A = Agent;', { filePath });
  assert.equal(valid.messages.some(m => m.ruleId === 'no-restricted-imports'), false);
  for (const name of ['@alpha/adk/core', '@alpha/adk', '@alpha/adk/src/core/contracts.js', '@alpha/provider', 'bun:sqlite', './sqlite/index']) {
    const [invalid] = await eslint.lintText(`import * as value from '${name}'; export { value };`, { filePath });
    assert.ok(invalid.messages.some(m => m.ruleId === 'no-restricted-imports'), name);
  }
});
