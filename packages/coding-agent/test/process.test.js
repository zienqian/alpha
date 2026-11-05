import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { selectShell, shellArgs } from '../dist/process/shell';
import { runCommand, runProcess } from '../dist/process/run-command';
import { fixture, scriptCommand, waitFile, pause } from './helpers';

async function gone(pid) {
  for (let i = 0; i < 100; i++) { try { process.kill(pid, 0); } catch { return; } await pause(20); }
  assert.fail(`process ${pid} still alive`);
}
for (const reason of ['cancel', 'timeout']) test(`${reason} terminates a live root and its descendants`, async () => {
  await using f = await fixture();
  const grand = `require('node:fs').writeFileSync('grand.pid',String(process.pid)); setInterval(()=>{},1000)`;
  const child = `require('node:fs').writeFileSync('child.pid',String(process.pid)); require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(grand)}],{stdio:'ignore',windowsHide:true}); setInterval(()=>{},1000)`;
  await f.write('tree.cjs', `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(child)}],{stdio:'ignore',windowsHide:true}); setInterval(()=>{},1000)`);
  const controller = new AbortController();
  const running = runProcess(process.execPath, ['tree.cjs'], { cwd: f.cwd, signal: controller.signal, timeoutMs: reason === 'timeout' ? 1800 : 10000 });
  const pids = [Number(await waitFile(join(f.cwd, 'child.pid'))), Number(await waitFile(join(f.cwd, 'grand.pid')))];
  try {
    for (const pid of pids) process.kill(pid, 0);
    if (reason === 'cancel') controller.abort();
    const result = await running; assert.equal(result.status, 'unknown'); assert.equal(result.code, reason === 'cancel' ? 'COMMAND_CANCELLED' : 'COMMAND_TIMEOUT');
    for (const pid of pids) await gone(pid);
  } finally { controller.abort(); await running; for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch {} await gone(pid); } }
});

test('abort on output terminates the selected shell and its child', async () => {
  await using f = await fixture({ 'slow.cjs': "console.log(process.pid); setInterval(()=>{},1000)" }); const controller = new AbortController(); let pid;
  const result = await runCommand(f.cwd, selectShell(), { command: scriptCommand('slow.cjs') }, {
    signal: controller.signal, onOutput(channel, text) { if (channel === 'stdout' && !pid) { pid = Number(text.trim()); controller.abort(); } },
  });
  try { assert.equal(result.status, 'unknown'); assert.equal(result.code, 'COMMAND_CANCELLED'); assert.ok(pid); await gone(pid); }
  finally { if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} await gone(pid); } }
});

test('root exit with descendant-held pipes returns bounded incomplete output', async () => {
  await using f = await fixture();
  const descendant = `require('node:fs').writeFileSync('holder.pid',String(process.pid)); setTimeout(()=>process.exit(0),4000)`;
  const code = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:['ignore',1,2],windowsHide:true,detached:true}).unref(); console.log('root'); setInterval(()=>{if(require('node:fs').existsSync('holder.pid'))process.exit(0)},10)`;
  const start = Date.now(), out = await runProcess(process.execPath, ['-e', code], { cwd: f.cwd, timeoutMs: 10000 });
  const pid = Number(await waitFile(join(f.cwd, 'holder.pid')));
  try { assert.equal(out.status, 'exited'); assert.equal(out.exitCode, 0); assert.match(out.stdout, /root/); assert.equal(out.outputIncomplete, true); assert.ok(Date.now() - start < 3000); }
  finally { try { process.kill(pid, 'SIGKILL'); } catch {} await gone(pid); }
});

test('shell selection covers no Git Bash, Windows fallback, POSIX fallback, unsupported shells', () => {
  const available = new Map(); const locate = p => available.get(p);
  const select = (platform, env = {}, configured) => selectShell({ platform, env, configured, locate });
  available.set('powershell.exe', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(select('win32').family, 'powershell');
  available.set('pwsh.exe', 'C:\\PowerShell\\pwsh.exe'); assert.match(select('win32').path, /pwsh/);
  assert.match(select('win32', { SHELL: 'powershell.exe' }).path, /powershell.exe/);
  available.clear(); available.set('git.exe', 'C:\\Git\\cmd\\git.exe'); available.set('C:\\Git\\bin\\bash.exe', 'C:\\Git\\bin\\bash.exe');
  assert.equal(select('win32').family, 'posix');
  available.clear(); available.set('C:\\Windows\\System32\\cmd.exe', 'C:\\Windows\\System32\\cmd.exe'); assert.equal(select('win32').family, 'cmd');
  available.set('bash.exe', 'C:\\Windows\\System32\\bash.exe'); assert.equal(select('win32', { SHELL: 'bash.exe' }).family, 'cmd');
  available.clear(); assert.equal(select('win32'), null);
  available.set('/bin/sh', '/bin/sh'); assert.equal(select('linux').path, '/bin/sh'); assert.equal(select('darwin').path, '/bin/sh');
  available.set('fish', '/usr/bin/fish'); assert.equal(select('linux', { SHELL: 'fish' }).path, '/bin/sh');
  assert.throws(() => select('linux', {}, 'fish'), { code: 'INVALID_SHELL' });
  available.set('/bin/zsh', '/bin/zsh'); assert.equal(select('darwin').path, '/bin/zsh');
  available.set('bash', '/usr/bin/bash'); assert.equal(select('linux').path, '/usr/bin/bash');
  assert.equal(select('linux', {}, false), null);
  assert.deepEqual(shellArgs({ family: 'posix', path: '/bin/sh' }, 'echo x'), ['-c', 'echo x']);
});

const powerShells = process.platform === 'win32'
  ? [...new Set([Bun.which('pwsh.exe'), Bun.which('powershell.exe')].filter(Boolean))] : [];
for (const path of powerShells) test(`PowerShell Unicode, plain stderr, quoting and explicit exit: ${path}`, async () => {
  await using f = await fixture(); const shell = selectShell({ configured: path });
  await mkdir(join(f.cwd, '中文 space'));
  const out = await runCommand(f.cwd, shell, { cwd: '中文 space', command: `[Console]::Write('汉字😀 "quotes"'); [Console]::Error.Write('错误'); Write-Error 'plain-error'; exit 7` }, {});
  assert.equal(out.status, 'exited'); assert.equal(out.exitCode, 7); assert.equal(out.stdout, '汉字😀 "quotes"');
  assert.match(out.stderr, /错误/); assert.match(out.stderr, /plain-error/); assert.doesNotMatch(out.stderr, /CLIXML|<Objs/);
  const native = await runCommand(f.cwd, shell, { command: `& '${process.execPath.replaceAll("'", "''")}' -e 'process.exit(23)'; exit $LASTEXITCODE` }, {});
  assert.equal(native.exitCode, 23);
});

test('fixed argv respects metacharacters, cwd spaces, streamed UTF-8 and exit code', async () => {
  await using f = await fixture(); await mkdir(join(f.cwd, '中文 space'));
  const first = [];
  const out = await runProcess(process.execPath, ['-e', `console.log(process.argv[1]); console.log(process.cwd()); const bytes=Buffer.from('汉字😀'); for(let i=0;i<bytes.length;i++) process.stdout.write(bytes.subarray(i,i+1)); setTimeout(()=>{console.error('错误'); process.exit(9)}, 300)`, 'a & b | $x'], {
    cwd: join(f.cwd, '中文 space'), onOutput: (channel, text) => first.push({ channel, text, at: Date.now() }),
  });
  assert.equal(out.status, 'exited'); assert.equal(out.exitCode, 9); assert.match(out.stdout, /a & b/); assert.match(out.stdout, /中文 space/);
  assert.match(out.stdout, /汉字😀/); assert.match(out.stderr, /错误/); assert.equal(out.outputIncomplete, false); assert.ok(Date.now() - first[0].at >= 200);
});

test('output cap drains streams without splitting UTF-8; inherited secrets excluded', async () => {
  await using f = await fixture(); process.env.ALPHA_CODING_PRIVATE_TEST = 'never-inherit';
  try {
    const out = await runProcess(process.execPath, ['-e', `if(process.env.ALPHA_CODING_PRIVATE_TEST) process.exit(88); console.log('汉😀'.repeat(100000)); console.error('错误'.repeat(100000))`], { cwd: f.cwd, maxOutputBytes: 1024 });
    assert.equal(out.exitCode, 0); assert.equal(out.truncated, true); assert.ok(Buffer.byteLength(out.stdout + out.stderr) <= 1024); assert.doesNotMatch(out.stdout + out.stderr, /\ufffd/);
  } finally { delete process.env.ALPHA_CODING_PRIVATE_TEST; }
});

test('pre-abort, missing executable and invalid cwd are never-started facts', async () => {
  await using f = await fixture(); const controller = new AbortController(); controller.abort();
  assert.equal((await runProcess(process.execPath, ['-e', "throw Error('must not run')"], { cwd: f.cwd, signal: controller.signal })).status, 'not_started');
  assert.equal((await runProcess(join(f.cwd, 'missing.exe'), [], { cwd: f.cwd })).status, 'not_started');
  assert.equal((await runProcess(process.execPath, [], { cwd: join(f.cwd, 'missing') })).status, 'not_started');
  assert.equal((await runCommand(f.cwd, selectShell(), { cwd: '../outside', command: 'echo nope' }, {})).status, 'not_started');
});

test('truncation retains a prefix and does not append later ASCII into a UTF-8 gap', async () => {
  await using f = await fixture();
  const out = await runProcess(process.execPath, ['-e', "process.stdout.write('汉'); setTimeout(()=>process.stdout.write('x'),100)"], { cwd: f.cwd, maxOutputBytes: 1 });
  assert.equal(out.exitCode, 0); assert.equal(out.stdout, ''); assert.equal(out.truncated, true);
});

const extraShells = process.platform === 'win32' ? [Bun.which('cmd.exe'), Bun.which('bash.exe')].filter(Boolean) : ['/bin/sh'];
for (const path of extraShells) test(`real alternate shell handles cwd spaces and native arguments: ${path}`, async () => {
  await using f = await fixture({ 'args file.cjs': "console.log('汉😀'); console.error('stderr'); console.log(process.cwd())" });
  const shell = selectShell({ configured: path });
  const out = await runCommand(f.cwd, shell, { command: scriptCommand('args file.cjs', shell) }, {});
  assert.equal(out.status, 'exited'); assert.equal(out.exitCode, 0); assert.match(out.stdout, /汉😀/); assert.match(out.stderr, /stderr/);
});

test('file reads start without PATH shell/ripgrep dependencies; search fails only when invoked', async () => {
  await using f = await fixture({ a: 'available' });
  const helper = new URL('./helpers.js', import.meta.url).href, entry = new URL('../dist/index.js', import.meta.url).href;
  const script = `const {createCodingAgent}=await import(${JSON.stringify(entry)}); const {fakeModel,request,call,answer,results}=await import(${JSON.stringify(helper)}); process.env.PATH=''; const agent=await createCodingAgent({cwd:process.cwd(),model:fakeModel(request(call('read_file',{path:'a'})),request(call('search',{query:'available'})),answer())}); await agent.prompt('read'); console.log(JSON.stringify(results(agent).map(r=>r.data))); await agent.close();`;
  const out = await runProcess(process.execPath, ['-e', script], { cwd: f.cwd });
  assert.equal(out.exitCode, 0); const results = JSON.parse(out.stdout);
  assert.equal(results[0].data.content, 'available'); assert.equal(results[1].code, 'RIPGREP_NOT_FOUND');
});
