import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createMemoryArtifactStore, maxArtifactBytes } from '../src/index';
import { createSqliteArtifactStore } from '../src/sqlite';

const scope = { namespace: 'project', sessionId: 'one' };
for (const kind of ['memory', 'sqlite']) test(`${kind}: exact UTF-8 paging, scoped immutable references and tombstones`, async () => {
  const store = kind === 'memory' ? createMemoryArtifactStore() : createSqliteArtifactStore(':memory:');
  try {
    const content = 'a汉😀\n'.repeat(2000);
    const saved = await store.put(scope, { content, complete: false, source: { runId: 'run', assistantId: 'assistant', callId: 'call', channel: 'stdout' } });
    let recovered = '', offset = 0;
    do {
      const page = await store.read(scope, { reference: saved.reference, offset, maxBytes: 127 });
      expect(page.complete).toBe(false);
      expect(page.content).not.toContain('\ufffd');
      expect(Buffer.byteLength(page.content)).toBeLessThanOrEqual(127);
      recovered += page.content; offset = page.nextOffset;
      if (!page.hasMore) break;
    } while (true);
    expect(recovered).toBe(content);
    expect(offset).toBe(saved.bytes);
    for (const wrong of [{ ...scope, sessionId: 'two' }, { ...scope, namespace: 'other' }]) {
      await expect(store.read(wrong, { reference: saved.reference })).rejects.toMatchObject({ code: 'CONTEXT_SCOPE_MISMATCH' });
    }
    await expect(store.read(scope, { reference: saved.reference.replace(/sha256=.*/, 'sha256=' + '0'.repeat(64)) })).rejects.toMatchObject({ code: 'CONTEXT_CONTENT_MISMATCH' });
    for (const range of [{ offset: 2 }, { offset: -1 }, { offset: saved.bytes + 1 }, { maxBytes: 10000 }, { maxBytes: 1 }]) {
      await expect(store.read(scope, { reference: saved.reference, ...range })).rejects.toMatchObject({ code: 'CONTEXT_RANGE_INVALID' });
    }
    await expect(store.read(scope, { reference: '../../private' })).rejects.toMatchObject({ code: 'CONTEXT_REFERENCE_INVALID' });
    await expect(store.put(scope, { content: 'x'.repeat(maxArtifactBytes + 1) })).rejects.toMatchObject({ code: 'ARTIFACT_TOO_LARGE' });
    await expect(store.put(scope, { content: '\ud800' })).rejects.toMatchObject({ code: 'ARTIFACT_INVALID' });
    expect(await store.list(scope)).toEqual([saved]);
    expect(await store.get(scope, saved.reference)).toEqual({ artifact: saved, content });
    await store.remove(scope);
    expect(await store.list(scope)).toEqual([]);
    await expect(store.read(scope, { reference: saved.reference })).rejects.toMatchObject({ code: 'CONTEXT_NOT_FOUND' });
    await expect(store.put(scope, { content: 'stale write' })).rejects.toMatchObject({ code: 'ARTIFACT_SCOPE_DELETED' });
  } finally { store.close?.(); }
});

for (const kind of ['memory', 'sqlite']) test(`${kind}: put snapshots mutable caller input before hashing`, async () => {
  const store = kind === 'memory' ? createMemoryArtifactStore() : createSqliteArtifactStore(':memory:');
  const mutableScope = { ...scope }, input = { content: 'original' };
  try {
    const pending = store.put(mutableScope, input);
    mutableScope.sessionId = 'other'; input.content = 'changed';
    const saved = await pending;
    expect((await store.read(scope, { reference: saved.reference })).content).toBe('original');
  } finally { store.close?.(); }
});

test('SQLite evidence survives restart, detects corruption and rejects writes from stale connections after deletion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'alpha-artifact-')), filename = join(root, 'artifacts.db');
  let store = createSqliteArtifactStore(filename);
  const stale = createSqliteArtifactStore(filename);
  try {
    const saved = await store.put(scope, { content: 'exact original' });
    store.close(); store = createSqliteArtifactStore(filename);
    expect((await store.read(scope, { reference: saved.reference })).content).toBe('exact original');
    const raw = new Database(filename);
    try { raw.query('UPDATE artifacts SET content = ? WHERE id = ?').run('corrupt content', saved.id); } finally { raw.close(); }
    await expect(store.read(scope, { reference: saved.reference })).rejects.toMatchObject({ code: 'CONTEXT_CONTENT_MISMATCH' });
    await expect(store.get(scope, saved.reference)).rejects.toMatchObject({ code: 'CONTEXT_CONTENT_MISMATCH' });
    await store.remove(scope);
    await expect(stale.put(scope, { content: 'late' })).rejects.toMatchObject({ code: 'ARTIFACT_SCOPE_DELETED' });
  } finally {
    store.close(); stale.close();
    expect(dirname(resolve(root))).toBe(resolve(tmpdir()));
    await rm(root, { recursive: true, force: true });
  }
});
