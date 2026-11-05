import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from 'bun:sqlite';
import { createSqliteSessionStore } from '@alpha/adk-session/sqlite';
import { fixture, key } from './helpers.js';

for (const [archive, driver] of [['session-v1.sqlite', 'better-sqlite3'], ['session-bun-v1.sqlite', 'bun:sqlite']]) {
  test(`Bun SQLite opens a ${driver} v1 archive, replays receipts and continues the conversation`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'alpha-session-legacy-'));
    const filename = join(dir, 'session.db');
    await copyFile(new URL(`./fixtures/${archive}`, import.meta.url), filename);
    const store = await createSqliteSessionStore({ filename });
    const f = fixture({ store });
    await using cleanup = { async [Symbol.asyncDispose]() {
      try { await f.close(); } finally {
        await store.close();
        assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
        assert.ok(basename(dir).startsWith('alpha-session-legacy-'));
        await rm(dir, { recursive: true, force: true });
      }
    } };
    const previous = await store.read(key('legacy'));
    assert.equal(previous.revision, 2);
    assert.equal(previous.data.formatVersion, 1);
    assert.equal(previous.data.title, '迁移前的会话');
    assert.equal(previous.data.metadata.driver, driver);
    assert.equal(previous.data.turns.length, 1);
    const { agent, session } = await f.open('legacy');
    const replay = await agent.prompt('请保留这段历史', { requestId: 'legacy-request' });
    assert.deepEqual(replay, previous.data.turns[0].run);
    assert.equal(f.model.inputs.length, 0);
    await agent.prompt('继续旧会话', { requestId: 'bun-request' });
    assert.equal(f.model.inputs.length, 1);
    assert.ok(f.model.inputs[0].messages.some(message => message.content === '旧会话已保存'));
    assert.equal(session.state.persistence.status, 'saved');
    await agent.close(); await f.manager.close(); await store.close();
    const reopened = await createSqliteSessionStore({ filename });
    try {
      const saved = await reopened.read(key('legacy'));
      assert.equal(saved.revision, 4);
      assert.equal(saved.data.turns.length, 2);
      assert.deepEqual(saved.data.turns[0], previous.data.turns[0]);
    } finally { await reopened.close(); }
    const db = new Database(filename, { readonly: true });
    try {
      assert.equal(db.query('PRAGMA user_version').values()[0][0], 1);
      assert.equal(db.query('PRAGMA integrity_check').values()[0][0], 'ok');
    } finally { db.close(); }
  });
}
