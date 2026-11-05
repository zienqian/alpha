import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSqliteSessionStore } from '@alpha/adk-session/sqlite';
import { key, seed } from './helpers';

async function sandbox() {
  const dir = await mkdtemp(join(tmpdir(), 'alpha-session-process-')), filename = join(dir, 'sessions.db'), effectFile = join(dir, 'effects.txt');
  const stops = [];
  const dispose = async () => {
    await Promise.all(stops.map(stop => stop()));
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + '\\alpha-session-process-') || resolve(dir).startsWith(resolve(tmpdir()) + '/alpha-session-process-'));
    await rm(dir, { recursive: true, force: true });
  };
  const store = await createSqliteSessionStore({ filename }); await store.create(key('thread'), seed('thread')); await store.close();
  return { [Symbol.asyncDispose]: dispose, filename, effectFile, stops };
}
function worker(files, mode, requestId) {
  const received = [], waiters = []; let errors = '', exited = false;
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL('worker.js', import.meta.url)), files.filename, 'thread', mode, files.effectFile, requestId], {
    stdin: 'ignore', stdout: 'ignore', stderr: 'pipe', windowsHide: true, serialization: 'json',
    ipc(message) { const index = waiters.findIndex(w => w.type === message.type); if (index >= 0) waiters.splice(index, 1)[0].resolve(message); else received.push(message); },
  });
  const output = new Response(child.stderr).text().then(text => { errors = text; });
  const done = Promise.all([child.exited, output]).then(([code]) => {
    exited = true;
    for (const waiter of waiters.splice(0)) waiter.reject(new Error(`Child exited before ${waiter.type}: ${errors}`));
    return { code, signal: child.signalCode };
  });
  const stop = async () => { if (!exited) child.kill(); await done; };
  files.stops.push(stop);
  return { send: command => child.send(command), stop, done, next(type) {
    const index = received.findIndex(m => m.type === type);
    if (index >= 0) return Promise.resolve(received.splice(index, 1)[0]);
    if (exited) return Promise.reject(new Error(`Child exited: ${errors}`));
    return new Promise((resolve, reject) => waiters.push({ type, resolve, reject }));
  } };
}
test('SQLite: a different process restores saved history and opaque continuation', async () => {
  await using files = await sandbox();
  const first = worker(files, 'complete', 'r1');
  await first.next('ready'); first.send('go'); const initial = await first.next('outcome'); assert.equal(initial.result.persistence.status, 'saved'); assert.equal((await first.done).code, 0);
  const second = worker(files, 'resume', 'r2'); await second.next('ready'); second.send('go');
  const resumed = await second.next('outcome'); assert.equal(resumed.result.persistence.status, 'saved');
  assert.equal(resumed.input.messages.find(m => m.toolCalls?.length).continuation.content[0].signature, 'persist-me');
  assert.deepEqual(resumed.input.messages.map(m => m.role), ['system', 'user', 'assistant', 'tool', 'assistant', 'user']);
  assert.equal((await second.done).code, 0);
  const receipt = worker(files, 'inspect', 'r1'); await receipt.next('ready'); receipt.send('go');
  const repeated = await receipt.next('outcome'); assert.deepEqual(repeated.result, initial.result); assert.equal(repeated.calls, 0); await receipt.done;
});
test('SQLite: competing processes both read revision zero but only one executes the write tool', async () => {
  await using files = await sandbox();
  const a = worker(files, 'race', 'a'), b = worker(files, 'race', 'b');
  await Promise.all([a.next('ready'), b.next('ready')]); a.send('go'); b.send('go');
  await Promise.all([a.next('at-admission'), b.next('at-admission')]); a.send('enter'); b.send('enter');
  const results = await Promise.all([a.next('outcome'), b.next('outcome')]);
  assert.equal(results.filter(r => r.result?.persistence.status === 'saved').length, 1);
  const loser = results.find(r => r.code); assert.equal(loser.code, 'SESSION_CONFLICT'); assert.equal(loser.calls, 0);
  assert.equal((await readFile(files.effectFile, 'utf8')).trim().split('\n').length, 1);
  await Promise.all([a.done, b.done]);
});
for (const phase of ['crash-admission', 'crash-tool']) test(`SQLite: forcefully killed ${phase} process cannot be automatically replayed`, async () => {
  await using files = await sandbox();
  const doomed = worker(files, phase, 'original'); await doomed.next('ready'); doomed.send('go');
  await doomed.next(phase === 'crash-admission' ? 'admitted' : 'effect'); await doomed.stop();
  const checking = worker(files, 'inspect', 'retry'); await checking.next('ready'); checking.send('go');
  const result = await checking.next('outcome'); assert.equal(result.code, 'RECOVERY_REQUIRED'); assert.equal(result.calls, 0); await checking.done;
  const store = await createSqliteSessionStore({ filename: files.filename });
  const snapshot = await store.read(key('thread')); assert.equal(snapshot.revision, 1); assert.equal(snapshot.data.pending.requestId, 'original'); assert.equal(snapshot.data.turns.length, 0); await store.close();
  if (phase === 'crash-tool') assert.equal((await readFile(files.effectFile, 'utf8')).trim().split('\n').length, 1);
});
