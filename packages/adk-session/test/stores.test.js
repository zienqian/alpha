import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import Database from 'better-sqlite3';
import { createMemorySessionStore } from '@alpha/adk-session';
import { createSqliteSessionStore } from '@alpha/adk-session/sqlite';
import { key, seed } from './helpers.js';

async function removeSandbox(dir) {
  assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
  assert.ok(basename(dir).startsWith('alpha-session-'));
  await rm(dir, { recursive: true, force: true });
}

for (const backend of ['memory', 'sqlite']) {
  test(`${backend}: isolation, immutable snapshots, atomic CAS, tombstones and close`, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'alpha-session-'));
    const store = backend === 'memory' ? createMemorySessionStore() : await createSqliteSessionStore({ filename: join(dir, 'store.db') });
    t.after(async () => { await store.close(); await removeSandbox(dir); });
    const data = seed('id'); const original = await store.create(key('id'), data); data.title = 'mutated';
    assert.equal(original.data.title, ''); assert.ok(Object.isFrozen(original.data.turns));
    await store.create({ namespace: 'other', id: 'id' }, seed('id'));
    assert.equal((await store.list('test')).items.length, 1);
    const updates = await Promise.all([store.compareAndSet(key('id'), 0, { ...original.data, title: 'first' }), store.compareAndSet(key('id'), 0, { ...original.data, title: 'second' })]);
    assert.equal(updates.filter(x => x.applied).length, 1); assert.equal((await store.read(key('id'))).data.title, 'first');
    assert.equal(original.revision, 0);
    assert.equal((await store.compareAndSet(key('id'), 1, null)).applied, true);
    assert.equal(await store.read(key('id')), undefined); assert.deepEqual((await store.list('test')).items, []);
    await assert.rejects(store.create(key('id'), seed('id')), { code: 'SESSION_EXISTS' });
    assert.equal((await store.read({ namespace: 'other', id: 'id' })).revision, 0);
    const closing = store.close(); assert.equal(store.close(), closing); await closing;
    await assert.rejects(store.read(key('id')), { code: 'STORE_CLOSED' });
  });
  test(`${backend}: pagination follows UTF-8 ordering, scope-bound cursor, stable creation order`, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'alpha-session-'));
    const store = backend === 'memory' ? createMemorySessionStore() : await createSqliteSessionStore({ filename: join(dir, 'store.db') });
    t.after(async () => { await store.close(); await removeSandbox(dir); });
    for (const id of ['z', 'ä', '中文', 'a']) await store.create(key(id), seed(id));
    const first = await store.list('test', { limit: 2 }); assert.deepEqual(first.items.map(i => i.id), ['中文', 'ä']);
    await store.compareAndSet(key('a'), 0, { ...seed('a'), title: 'changed', updatedAt: '2027-01-01T00:00:00.000Z' });
    const second = await store.list('test', { limit: 2, cursor: first.cursor }); assert.deepEqual(second.items.map(i => i.id), ['z', 'a']); assert.equal(second.cursor, undefined);
    await assert.rejects(store.list('other', { cursor: first.cursor }), { code: 'SESSION_INPUT_INVALID' });
    await assert.rejects(store.list('test', { limit: 0 }), { code: 'SESSION_INPUT_INVALID' });
    await assert.rejects(store.list('test', { cursor: 'not-a-cursor' }), { code: 'SESSION_INPUT_INVALID' });
  });
  test(`${backend}: rejects malformed archive and separates composite keys`, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'alpha-session-'));
    const store = backend === 'memory' ? createMemorySessionStore() : await createSqliteSessionStore({ filename: join(dir, 'store.db') });
    t.after(async () => { await store.close(); await removeSandbox(dir); });
    await assert.rejects(store.create(key('bad'), { ...seed('bad'), formatVersion: 99 }), { code: 'SESSION_FORMAT_INVALID' });
    await store.create({ namespace: 'a:b', id: 'c' }, seed('c')); await store.create({ namespace: 'a', id: 'b:c' }, seed('b:c'));
    assert.equal((await store.list('a:b')).items[0].id, 'c');
    const bad = seed('bad'); Object.defineProperty(bad.metadata, 'secret', { enumerable: true, get() { throw new Error('must not execute'); } });
    await assert.rejects(store.create(key('bad'), bad), { code: 'SESSION_FORMAT_INVALID' });
  });
}
test('SQLite: pragmas, unknown database versions, corrupt rows, transaction rollback and busy errors', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'alpha-session-')), filename = join(dir, 'store.db');
  const store = await createSqliteSessionStore({ filename }), db = new Database(filename);
  t.after(async () => { db.close(); await store.close(); await removeSandbox(dir); });
  assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
  await store.create(key('id'), seed('id'));
  db.exec("CREATE TRIGGER no_update BEFORE UPDATE ON sessions BEGIN SELECT RAISE(ABORT, 'private error'); END");
  await assert.rejects(store.compareAndSet(key('id'), 0, { ...seed('id'), title: 'discarded' }), { code: 'STORE_UNAVAILABLE' });
  assert.equal((await store.read(key('id'))).data.title, ''); db.exec('DROP TRIGGER no_update');
  db.exec('BEGIN IMMEDIATE');
  await assert.rejects(store.compareAndSet(key('id'), 0, seed('id')), { code: 'STORE_UNAVAILABLE' }); db.exec('ROLLBACK');
  db.prepare('UPDATE sessions SET body=? WHERE id=?').run('{broken', 'id');
  await assert.rejects(store.read(key('id')), { code: 'SESSION_FORMAT_INVALID' });
  db.exec('PRAGMA user_version=99');
  await assert.rejects(createSqliteSessionStore({ filename }), { code: 'SESSION_FORMAT_INVALID' });
  assert.equal(db.pragma('user_version', { simple: true }), 99);
});
