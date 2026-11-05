// Opt-in live probe. Creates and changes only a validated temporary fixture.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createProvider } from '@alpha/provider';
import { createSession, createSessionPlugin, createMemorySessionStore } from '@alpha/adk-session';
import { createCodingAgent } from '../dist/index.js';
import { createLocalWorkspace } from '../dist/node/index.js';

const baseURL = process.env.ADK_BASE_URL, modelId = process.env.ADK_MODEL;
if (!baseURL || !modelId) throw Error('Set ADK_BASE_URL and ADK_MODEL (or load .env.local).');
const started = Date.now(), root = await mkdtemp(join(tmpdir(), 'alpha-coding-live-'));
const source = `exports.nextCursor = function nextCursor(items, limit, offset = 0) {\n  if (items.length <= limit) return undefined;\n  return offset + items.length;\n};\n`;
const tests = `const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst {nextCursor} = require('./pagination.cjs');\ntest('empty page ends pagination', () => assert.equal(nextCursor([], 2, 0), undefined));\ntest('short page ends pagination', () => assert.equal(nextCursor(['a'], 2, 4), undefined));\ntest('full page advances the cursor', () => assert.equal(nextCursor(['a','b'], 2, 4), 6));\n`;
let workspace, session, agent, modelCalls = 0, approved = 0, changes = 0;
const store = createMemorySessionStore();
try {
  await writeFile(join(root, 'pagination.cjs'), source); await writeFile(join(root, 'pagination.test.cjs'), tests);
  await writeFile(join(root, 'AGENTS.md'), 'Use node:test. Preserve the tests. Make the smallest source fix. Shell is PowerShell 7.');
  const before = spawnSync(process.execPath, ['test', './pagination.test.cjs'], { cwd: root, windowsHide: true, encoding: 'utf8' }); assert.equal(before.status, 1);
  workspace = await createLocalWorkspace({ root, shell: 'powershell' });
  const model = createProvider({ providers: { local: {
    adapter: 'openai-completions', options: { baseURL, apiKey: process.env.ADK_AUTH === 'none' ? { none: true } : { env: process.env.ADK_API_KEY_ENV ?? 'OPENAI_API_KEY' } },
    models: { coding: { id: modelId } },
  } } }).use('local', 'coding');
  session = await createSession({ store, namespace: 'coding-live', agentKey: `coding-c1:${workspace.id}` });
  agent = await createCodingAgent({ model, workspace, plugins: [createSessionPlugin({ session })],
    approve(action) { if (action.preview.type === 'command' && action.preview.command.trim() === 'bun test ./pagination.test.cjs') { approved++; return 'allow'; } return 'deny'; },
    onEvent(event) { if (event.type === 'file.changed') changes++; },
  });
  agent.subscribe(event => { if (event.type === 'model.start') modelCalls++; if (event.type === 'tool.end') console.log(JSON.stringify({ event: 'tool.end', name: event.name, execution: event.execution })); });
  const input = '修复 pagination.cjs 中 nextCursor 的边界错误。先用 run_command 执行 bun test ./pagination.test.cjs 获取失败证据，然后用 read_file 读取源码和测试，用 edit_file 做最小修复，再运行同一测试命令确认通过。不要改测试文件，不要创建其他文件。最后简要说明修改和测试结果。';
  const result = await agent.prompt(input, { requestId: 'fix-pagination' });
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.equal(await readFile(join(root, 'pagination.test.cjs'), 'utf8'), tests);
  const after = spawnSync(process.execPath, ['test', './pagination.test.cjs'], { cwd: root, windowsHide: true, encoding: 'utf8' }); assert.equal(after.status, 0, after.stdout + after.stderr);
  const toolResults = agent.state.messages.filter(m => m.role === 'toolResult' && m.execution === 'succeeded').map(m => JSON.parse(m.content));
  assert.ok(toolResults.some(r => r.code === 'COMMAND_EXIT_NONZERO' && r.detail.exitCode === 1));
  assert.ok(toolResults.some(r => r.ok && r.data.exitCode === 0));
  assert.ok(changes >= 1); assert.ok(approved >= 2); assert.equal(session.state.persistence.status, 'saved');
  const counts = { modelCalls, changes, approved }; assert.deepEqual(await agent.prompt(input, { requestId: 'fix-pagination' }), result); assert.deepEqual({ modelCalls, changes, approved }, counts);
  await agent.close();
  // Reattach using the same public Session plugin; the saved receipt skips the entire Loop.
  agent = await createCodingAgent({ model, workspace, plugins: [createSessionPlugin({ session })] });
  agent.subscribe(event => { if (event.type === 'model.start') modelCalls++; });
  assert.deepEqual(await agent.prompt(input, { requestId: 'fix-pagination' }), result); assert.equal(modelCalls, counts.modelCalls);
  console.log(JSON.stringify({ status: 'passed', verified: true, date: new Date().toISOString(), endpoint: new URL(baseURL).origin, model: modelId,
    modelCalls, approvedCommands: approved, fileChanges: changes, beforeExit: before.status, afterExit: after.status, testsUnchanged: true,
    replayModelCalls: 0, replayEffects: 0, reattached: true, sessionRevision: session.state.revision, elapsedMs: Date.now() - started }));
} finally {
  try { await agent?.close(); } finally { try { await session?.close(); } finally { await workspace?.close(); await store.close(); } }
  assert.equal(dirname(resolve(root)), resolve(tmpdir())); assert.ok(basename(root).startsWith('alpha-coding-live-'));
  await rm(root, { recursive: true, force: true });
}
