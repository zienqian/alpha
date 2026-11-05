import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, mkdir, symlink, readdir, rm } from 'node:fs/promises';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createLocalWorkspace } from '../dist/node/index.js';
import { createCodingAgent } from '../dist/index.js';
import { fakeModel, request, call, answer, results } from './helpers.js';

const windows = { skip: process.platform !== 'win32', timeout: 30000 };
async function fixture(t, limits) {
  const root = await mkdtemp(join(tmpdir(), 'alpha-coding-test-'));
  const workspace = await createLocalWorkspace({ root, shell: 'powershell', limits });
  let lease;
  t.after(async () => {
    await lease?.release(); await workspace.close();
    assert.equal(dirname(resolve(root)), resolve(tmpdir())); assert.ok(basename(root).startsWith('alpha-coding-test-'));
    await rm(root, { recursive: true, force: true });
  });
  return { root, workspace, acquire: async () => lease = await workspace.acquire() };
}
const signal = () => new AbortController().signal;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFile(path) { for (let i = 0; i < 300; i++) { try { return await readFile(path, 'utf8'); } catch { await pause(20); } } throw Error('Fixture child did not start'); }
const childFile = fileURLToPath(new URL('./lease-child.js', import.meta.url));
function childLease(root, mode) {
  const child = spawn(process.execPath, [childFile, root, mode ?? 'once'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let text = ''; child.stdout.on('data', data => { text += data; }); child.stderr.resume();
  const done = new Promise(resolve => child.once('close', code => resolve({ code, text })));
  return { child, done, async ready() { for (let i = 0; i < 500; i++) { if (text.includes('ACQUIRED')) return; if (text.includes('BUSY')) throw Error(text); await pause(20); } throw Error('Child not ready'); } };
}

test('local files preserve UTF-8 BOM/CRLF, reject stale versions and create-only collisions', windows, async t => {
  const { root, workspace, acquire } = await fixture(t), lease = await acquire();
  await writeFile(join(root, 'a.txt'), '\ufefffirst\r\nsecond\r\n');
  const original = await workspace.readFile('a.txt'); assert.equal(original.content, '\ufefffirst\r\nsecond\r\n');
  const applied = await lease.writeFile({ path: 'a.txt', content: original.content.replace('first', 'changed'), expectedRevision: original.revision });
  assert.equal(applied.status, 'applied'); assert.equal((await workspace.readFile('a.txt')).revision, applied.revision);
  assert.equal((await lease.writeFile({ path: 'a.txt', content: 'stale', expectedRevision: original.revision })).code, 'FILE_CONFLICT');
  assert.equal((await lease.writeFile({ path: 'a.txt', content: 'overwrite', expectedRevision: null })).code, 'FILE_EXISTS');
  assert.equal((await lease.writeFile({ path: 'new.txt', content: 'new', expectedRevision: null })).status, 'applied');
  assert.equal((await lease.writeFile({ path: 'missing/new.txt', content: 'new', expectedRevision: null })).status, 'rejected');
  assert.deepEqual((await readdir(root)).sort(), ['a.txt', 'new.txt']);
});

test('relative path rules and junction escapes are enforced on reads, writes and cwd', windows, async t => {
  const { root, workspace, acquire } = await fixture(t), lease = await acquire();
  const outside = await mkdtemp(join(tmpdir(), 'alpha-coding-outside-'));
  t.after(async () => { assert.equal(dirname(resolve(outside)), resolve(tmpdir())); assert.ok(basename(outside).startsWith('alpha-coding-outside-')); await rm(outside, { recursive: true, force: true }); });
  await writeFile(join(outside, 'secret.txt'), 'outside'); await symlink(outside, join(root, 'escape'), 'junction');
  for (const path of ['../secret.txt', 'C:/secret.txt', '//server/share/a', 'a:stream', 'CON', 'a./b', 'a/../b', 'escape/secret.txt']) {
    await assert.rejects(workspace.readFile(path));
    assert.equal((await lease.writeFile({ path, content: 'bad', expectedRevision: null })).status, 'rejected');
  }
  assert.equal((await lease.runCommand({ command: "'bad'", cwd: 'escape' }, { signal: signal() })).status, 'not_started');
  assert.equal(await readFile(join(outside, 'secret.txt'), 'utf8'), 'outside');
  assert.deepEqual((await workspace.listFiles({})).paths, []);
});

test('read rejects binary, invalid UTF-8 and oversized files; abort does not write', windows, async t => {
  const { root, workspace, acquire } = await fixture(t, { maxFileBytes: 16 }), lease = await acquire();
  await writeFile(join(root, 'binary'), Buffer.from([0, 1])); await writeFile(join(root, 'invalid'), Buffer.from([0xff])); await writeFile(join(root, 'big'), 'x'.repeat(17));
  for (const [path, code] of [['binary','BINARY_FILE'], ['invalid','INVALID_UTF8'], ['big','FILE_TOO_LARGE']]) await assert.rejects(workspace.readFile(path), { code });
  const controller = new AbortController(); controller.abort();
  assert.equal((await lease.writeFile({ path: 'new', content: 'x', expectedRevision: null }, { signal: controller.signal })).status, 'rejected');
  assert.equal(await workspace.readFile('new'), undefined);
});

test('list/search use stable paths, glob and ignores; query is literal, results are bounded', windows, async t => {
  const { root, workspace } = await fixture(t);
  await mkdir(join(root, '.git')); await writeFile(join(root, '.gitignore'), 'ignored.txt\n');
  for (const name of ['b.txt', 'a.txt', 'ignored.txt']) await writeFile(join(root, name), 'a.*b\nsecond\n');
  assert.deepEqual((await workspace.listFiles({ glob: '*.txt' })).paths, ['a.txt', 'b.txt']);
  assert.equal((await workspace.listFiles({ glob: '*.txt', limit: 1 })).truncated, true);
  const search = await workspace.search({ query: 'a.*b', glob: '*.txt', limit: 1 });
  assert.deepEqual(search.matches, [{ path: 'a.txt', line: 1, text: 'a.*b' }]); assert.equal(search.truncated, true);
  assert.deepEqual((await workspace.search({ query: 'a.b' })).matches, []);
});

test('canonical workspaces are exclusive within and across processes, release allows reacquire', windows, async t => {
  const { root, workspace, acquire } = await fixture(t), lease = await acquire();
  const second = await createLocalWorkspace({ root: join(root, '.'), shell: 'powershell' });
  assert.equal(second.id, workspace.id); await assert.rejects(second.acquire(), { code: 'WORKSPACE_BUSY' });
  const busy = childLease(root); assert.deepEqual(await busy.done, { code: 0, text: 'WORKSPACE_BUSY\n' });
  await lease.release();
  const free = childLease(root); assert.deepEqual(await free.done, { code: 0, text: 'ACQUIRED\n' });
  await second.close();
});

test('search truncates its raw JSON stream without retaining fragments after the output cap', windows, async t => {
  const { root, workspace } = await fixture(t);
  for (let i = 0; i < 16; i++) await writeFile(join(root, `${String(i).padStart(2, '0')}.txt`), '"'.repeat(200000) + 'needle\n');
  const found = await workspace.search({ query: 'needle', limit: 100 });
  assert.equal(found.truncated, true); assert.ok(found.matches.length > 0 && found.matches.length < 16);
  for (const match of found.matches) assert.equal(match.text, '"'.repeat(200000) + 'needle');
});

test('host process death releases the OS lock through bridge EOF', windows, async t => {
  const { root, workspace } = await fixture(t);
  const child = childLease(root, 'hold'); await child.ready(); child.child.kill(); await child.done;
  let lease;
  for (let i = 0; i < 10; i++) { try { lease = await workspace.acquire(); break; } catch (e) { assert.equal(e.code, 'WORKSPACE_BUSY'); await pause(50); } }
  assert.ok(lease); await lease.release();
});

test('commands retain stdout/stderr/exit1, bound output and exclude inherited secrets', windows, async t => {
  process.env.ALPHA_CODING_PRIVATE_TEST = 'never-inherit';
  const { workspace, acquire } = await fixture(t, { maxOutputBytes: 1024 }), lease = await acquire();
  const output = [];
  const result = await lease.runCommand({ command: "Write-Output 'hello'; [Console]::Error.WriteLine('error'); if ($env:ALPHA_CODING_PRIVATE_TEST) { throw 'leaked' }; exit 1" }, { signal: signal(), onOutput: (channel, text) => output.push({ channel, text }) });
  assert.equal(result.status, 'exited'); assert.equal(result.exitCode, 1); assert.match(result.stdout, /hello/); assert.match(result.stderr, /error/); assert.equal(output.length > 0, true);
  const large = await lease.runCommand({ command: "[Console]::Write(('汉' * 10000))" }, { signal: signal() });
  assert.equal(large.status, 'exited'); assert.equal(large.truncated, true); assert.ok(Buffer.byteLength(large.stdout + large.stderr) <= 1024); assert.equal(large.stdout.includes('\ufffd'), false);
  assert.equal((await lease.runCommand({ command: 'echo nope', timeoutMs: 999999 }, { signal: signal() })).status, 'not_started');
  assert.equal(workspace.isolation, 'none'); delete process.env.ALPHA_CODING_PRIVATE_TEST;
});

async function tree(root) {
  const grand = `require('node:fs').writeFileSync('grand.pid', String(process.pid)); setInterval(() => {}, 1000);`;
  const child = `const {spawn}=require('node:child_process'); require('node:fs').writeFileSync('child.pid', String(process.pid)); spawn(process.execPath, ['-e', ${JSON.stringify(grand)}], {stdio:'ignore', windowsHide:true, detached:true}); setInterval(() => {}, 1000);`;
  await writeFile(join(root, 'tree.cjs'), `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(child)}], {stdio:'ignore', windowsHide:true, detached:true}); setTimeout(()=>process.exit(0), 100);`);
}

for (const reason of ['cancel', 'timeout']) test(`${reason} drains child and grandchild even after the main shell exits`, windows, async t => {
  const { root, acquire } = await fixture(t), lease = await acquire(); await tree(root);
  const controller = new AbortController();
  const command = lease.runCommand({ command: 'bun tree.cjs', timeoutMs: reason === 'timeout' ? 2500 : 10000 }, { signal: controller.signal });
  const pids = [Number(await waitFile(join(root, 'child.pid'))), Number(await waitFile(join(root, 'grand.pid')))];
  for (const pid of pids) process.kill(pid, 0);
  if (reason === 'cancel') controller.abort();
  const result = await command; assert.equal(result.status, 'unknown'); assert.equal(result.code, reason === 'cancel' ? 'COMMAND_CANCELLED' : 'COMMAND_TIMEOUT');
  for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('normal completion and release wait for a child that outlives its parent', windows, async t => {
  const { root, workspace, acquire } = await fixture(t), lease = await acquire();
  const child = `setTimeout(() => require('node:fs').writeFileSync('finished', 'done'), 700);`;
  await writeFile(join(root, 'orphan.cjs'), `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(child)}], {stdio:'ignore', windowsHide:true, detached:true}); process.exit(0);`);
  const run = lease.runCommand({ command: 'bun orphan.cjs' }, { signal: signal() }); let released = false;
  const release = lease.release().then(() => { released = true; });
  await pause(100); assert.equal(released, false);
  assert.equal((await run).status, 'exited'); await release; assert.equal(await readFile(join(root, 'finished'), 'utf8'), 'done');
  const next = await workspace.acquire(); await next.release();
});

test('host death during an active command also drains detached descendants before reacquisition', windows, async t => {
  const { root, workspace } = await fixture(t); await tree(root);
  const child = childLease(root, 'run'); await child.ready();
  const pids = [Number(await waitFile(join(root, 'child.pid'))), Number(await waitFile(join(root, 'grand.pid')))];
  child.child.kill(); await child.done;
  let lease;
  for (let i = 0; i < 10; i++) { try { lease = await workspace.acquire(); break; } catch (e) { assert.equal(e.code, 'WORKSPACE_BUSY'); await pause(50); } }
  assert.ok(lease);
  try { for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }); }
  finally { await lease.release(); }
});

test('workspace close rejects new work and waits for the borrowed Agent lease', windows, async t => {
  const { workspace } = await fixture(t);
  const agent = await createCodingAgent({ workspace, model: fakeModel(answer()) });
  let closed = false; const close = workspace.close().then(() => { closed = true; }); await pause(20); assert.equal(closed, false);
  await assert.rejects(workspace.acquire(), { code: 'WORKSPACE_CLOSED' }); await agent.close(); await close;
});

test('real Agent approval conflict preserves external editor content and startup failure releases lock', windows, async t => {
  const { root, workspace } = await fixture(t); await writeFile(join(root, 'a'), 'before');
  const agent = await createCodingAgent({ workspace, model: fakeModel(request(call('read_file', { path: 'a' })), request(call('edit_file', { path: 'a', oldText: 'before', newText: 'after' })), answer()),
    policy: { decide: a => a.kind === 'edit' ? 'ask' : 'allow' }, approve: async () => { await writeFile(join(root, 'a'), 'external'); return 'allow'; } });
  await agent.prompt('edit'); assert.equal(results(agent).at(-1).data.code, 'FILE_CONFLICT'); assert.equal(await readFile(join(root, 'a'), 'utf8'), 'external'); await agent.close();
  await writeFile(join(root, 'AGENTS.md'), 'oversized');
  await assert.rejects(createCodingAgent({ workspace, model: fakeModel(), projectInstructions: { maxBytes: 1 } }));
  const lease = await workspace.acquire(); await lease.release();
});

test('unsupported shell is rejected explicitly', async () => { await assert.rejects(createLocalWorkspace({ root: '.', shell: 'bash' }), { code: 'PLATFORM_UNSUPPORTED' }); });
