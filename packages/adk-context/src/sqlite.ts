import { Database } from 'bun:sqlite';
import type { ContextCheckpoint, ContextStore } from './index';

/** Separate derived-data file. Never changes the session store's schema or CAS revision. */
export function createSqliteContextStore(filename: string): ContextStore & { remove(namespace: string, sessionId: string): void; close(): void } {
  const db = new Database(filename, { create: true });
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS context_checkpoints (namespace TEXT NOT NULL, session_id TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(namespace, session_id))');
  return {
    async read(namespace, sessionId) {
      const row = db.query('SELECT payload FROM context_checkpoints WHERE namespace = ? AND session_id = ?').get(namespace, sessionId) as { payload: string } | null;
      return row ? (JSON.parse(row.payload) as ContextCheckpoint | null) ?? undefined : undefined;
    },
    async write(value, expectedId) {
      const payload = JSON.stringify(value);
      if (payload.length > 200000) return false;
      const result = expectedId === undefined
        ? db.query('INSERT OR IGNORE INTO context_checkpoints(namespace, session_id, id, payload) VALUES (?, ?, ?, ?)').run(value.namespace, value.sessionId, value.id, payload)
        : db.query("UPDATE context_checkpoints SET id = ?, payload = ? WHERE namespace = ? AND session_id = ? AND id = ? AND id != 'deleted'").run(value.id, payload, value.namespace, value.sessionId, expectedId);
      return result.changes === 1;
    },
    remove(namespace, sessionId) {
      // Empty tombstone prevents an already-running stale writer from restoring deleted text.
      db.query("INSERT INTO context_checkpoints(namespace, session_id, id, payload) VALUES (?, ?, 'deleted', 'null') ON CONFLICT(namespace, session_id) DO UPDATE SET id = 'deleted', payload = 'null'").run(namespace, sessionId);
    },
    close() { db.close(); },
  };
}
