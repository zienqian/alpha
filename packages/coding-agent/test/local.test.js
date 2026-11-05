import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, symlink, readdir, rm } from 'node:fs/promises';
import { join, dirname, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { readFile as readLocal, writeFile as writeLocal } from '../dist/files.js';
import { listFiles, searchFiles } from '../dist/search.js';
import { runCommand } from '../dist/process/run-command.js';
import { selectShell } from '../dist/process/shell.js';
import { fixture } from './helpers.js';
const signal = () => new AbortController().signal;
async function localFixture() { const f = await fixture(); return { ...f, root: f.cwd }; }

test('local files preserve UTF-8 BOM/CRLF, reject stale versions and create-only collisions', async () => {
  await using f = await localFixture();
  const { root } = f;
  await writeFile(join(root, 'a.txt'), '\ufefffirst\r\nsecond\r\n');
  const original = await readLocal(root, 'a.txt'); assert.equal(original.content, '\ufefffirst\r\nsecond\r\n');
  const applied = await writeLocal(root, { path: 'a.txt', content: original.content.replace('first', 'changed'), expectedRevision: original.revision });
  assert.equal(applied.status, 'applied'); assert.equal((await readLocal(root, 'a.txt')).revision, applied.revision);
  assert.equal((await writeLocal(root, { path: 'a.txt', content: 'stale', expectedRevision: original.revision })).code, 'FILE_CONFLICT');
  assert.equal((await writeLocal(root, { path: 'a.txt', content: 'overwrite', expectedRevision: null })).code, 'FILE_EXISTS');
  assert.equal((await writeLocal(root, { path: 'new.txt', content: 'new', expectedRevision: null })).status, 'applied');
  assert.equal((await writeLocal(root, { path: 'missing/new.txt', content: 'new', expectedRevision: null })).status, 'rejected');
  assert.deepEqual((await readdir(root)).sort(), ['a.txt', 'new.txt']);
});

test('relative path rules and junction escapes are enforced on reads, writes and cwd', async () => {
  await using f = await localFixture();
  const { root } = f;
  const outside = await mkdtemp(join(tmpdir(), 'alpha-coding-outside-'));
  await using cleanup = { async [Symbol.asyncDispose]() { assert.equal(dirname(resolve(outside)), resolve(tmpdir())); assert.ok(basename(outside).startsWith('alpha-coding-outside-')); await rm(outside, { recursive: true, force: true }); } };
  await writeFile(join(outside, 'secret.txt'), 'outside'); await symlink(outside, join(root, 'escape'), 'junction');
  for (const path of ['../secret.txt', '//server/share/a', 'a/../b', 'escape/secret.txt', ...(process.platform === 'win32' ? ['C:/secret.txt', 'a:stream', 'CON', 'a./b'] : [])]) {
    await assert.rejects(readLocal(root, path));
    assert.equal((await writeLocal(root, { path, content: 'bad', expectedRevision: null })).status, 'rejected');
  }
  assert.equal((await runCommand(root, selectShell(), { command: "'bad'", cwd: 'escape' }, { signal: signal() })).status, 'not_started');
  assert.equal(await readFile(join(outside, 'secret.txt'), 'utf8'), 'outside');
  assert.deepEqual((await listFiles(root, {})).paths, []);
});

test('read rejects binary, invalid UTF-8 and oversized files; abort does not write', async () => {
  await using f = await localFixture();
  const { root } = f;
  await writeFile(join(root, 'binary'), Buffer.from([0, 1])); await writeFile(join(root, 'invalid'), Buffer.from([0xff])); await writeFile(join(root, 'big'), 'x'.repeat(1048577));
  for (const [path, code] of [['binary','BINARY_FILE'], ['invalid','INVALID_UTF8'], ['big','FILE_TOO_LARGE']]) await assert.rejects(readLocal(root, path), { code });
  const controller = new AbortController(); controller.abort();
  assert.equal((await writeLocal(root, { path: 'new', content: 'x', expectedRevision: null }, controller.signal)).status, 'rejected');
  assert.equal(await readLocal(root, 'new'), undefined);
});

test('list/search use stable paths, glob and ignores; query is literal, results are bounded', async () => {
  await using f = await localFixture();
  const { root } = f;
  await mkdir(join(root, '.git')); await writeFile(join(root, '.gitignore'), 'ignored.txt\n');
  for (const name of ['b.txt', 'a.txt', 'ignored.txt']) await writeFile(join(root, name), 'a.*b\nsecond\n');
  assert.deepEqual((await listFiles(root, { glob: '*.txt' })).paths, ['a.txt', 'b.txt']);
  assert.equal((await listFiles(root, { glob: '*.txt', limit: 1 })).truncated, true);
  const search = await searchFiles(root, { query: 'a.*b', glob: '*.txt', limit: 1 });
  assert.deepEqual(search.matches, [{ path: 'a.txt', line: 1, text: 'a.*b' }]); assert.equal(search.truncated, true);
  assert.deepEqual((await searchFiles(root, { query: 'a.b' })).matches, []);
});

test('search truncates its raw JSON stream without retaining fragments after the output cap', async () => {
  await using f = await localFixture();
  const { root } = f;
  for (let i = 0; i < 16; i++) await writeFile(join(root, `${String(i).padStart(2, '0')}.txt`), '"'.repeat(200000) + 'needle\n');
  const found = await searchFiles(root, { query: 'needle', limit: 100 });
  assert.equal(found.truncated, true); assert.ok(found.matches.length > 0 && found.matches.length < 16);
  for (const match of found.matches) assert.equal(match.text, '"'.repeat(200000) + 'needle');
});
