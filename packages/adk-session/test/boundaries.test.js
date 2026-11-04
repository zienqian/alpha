import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { ESLint } from 'eslint';
import * as session from '@alpha/adk-session';
import * as sqlite from '@alpha/adk-session/sqlite';

test('exports expose only factories and private entry points remain inaccessible', async () => {
  assert.deepEqual(Object.keys(session).sort(), ['createMemorySessionStore', 'createSession', 'createSessionManager', 'createSessionPlugin']);
  assert.deepEqual(Object.keys(sqlite), ['createSqliteSessionStore']);
  for (const name of ['@alpha/adk-session/internal/session.js', '@alpha/adk-session/dist/index.js', '@alpha/adk-session/src/contracts.ts', '@alpha/adk-session/package.json']) {
    await assert.rejects(import(name), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
  }
});

test('root import and Memory work without SQLite; adapter reports missing driver explicitly', () => {
  const script = `import assert from 'node:assert/strict';
    import { createMemorySessionStore } from '@alpha/adk-session';
    import { createSqliteSessionStore } from '@alpha/adk-session/sqlite';
    const store = createMemorySessionStore(); assert.equal(store.durability, 'memory'); await store.close();
    await assert.rejects(createSqliteSessionStore({ filename: 'never-created.db' }), { code: 'SQLITE_DRIVER_UNAVAILABLE' });`;
  const result = spawnSync(process.execPath, ['--no-warnings', '--experimental-loader', new URL('without-sqlite-loader.js', import.meta.url).href, '--input-type=module', '--eval', script], { cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
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
        if (specifier.startsWith('.')) visitFile(new URL(specifier, url));
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
  for (const name of ['@alpha/adk/core', '@alpha/adk', '@alpha/adk/src/core/contracts.js', '@alpha/provider', 'better-sqlite3', './sqlite/index.js']) {
    const [invalid] = await eslint.lintText(`import * as value from '${name}'; export { value };`, { filePath });
    assert.ok(invalid.messages.some(m => m.ruleId === 'no-restricted-imports'), name);
  }
});
