import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { ESLint } from 'eslint';
import * as core from '@alpha/adk/core';

test('only core factories are exported and internal entry points are inaccessible', async () => {
  assert.deepEqual(Object.keys(core).sort(), ['createAgent', 'createTool']);
  for (const name of ['@alpha/adk', '@alpha/adk/standard', '@alpha/adk/loops', '@alpha/adk/core/internal/create-loop.js']) {
    await assert.rejects(import(name), { code: 'ERR_MODULE_NOT_FOUND' });
  }
});

test('emitted kernel modules have no external runtime dependencies', () => {
  function walk(url) {
    for (const entry of readdirSync(url, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), url);
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith('.js')) {
        const source = ts.createSourceFile(entry.name, readFileSync(child, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
        function visit(node) {
          if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
            const path = node.moduleSpecifier.text;
            assert.ok(path.startsWith('.'), entry.name + ' imports ' + path);
          }
          assert.ok(!(ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword), 'No hidden dynamic package dependencies.');
          ts.forEachChild(node, visit);
        }
        visit(source);
      }
    }
  }
  walk(new URL('../dist/core/', import.meta.url));
});

test('lint boundary permits Provider types and rejects its runtime import', async () => {
  const eslint = new ESLint({ cwd: fileURLToPath(new URL('../../../', import.meta.url)) });
  const filePath = fileURLToPath(new URL('../src/core/boundary-probe.ts', import.meta.url));
  const [invalid] = await eslint.lintText('import { createProvider } from "@alpha/provider"; export { createProvider };', { filePath });
  assert.ok(invalid.messages.some(m => m.ruleId === 'no-restricted-imports'));
  const [valid] = await eslint.lintText('import type { LanguageModel } from "@alpha/provider"; export type Model = LanguageModel;', { filePath });
  assert.equal(valid.messages.some(m => m.ruleId === 'no-restricted-imports'), false);
});
