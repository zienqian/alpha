import type { Database } from 'better-sqlite3';
import type { SessionSnapshot, SessionStore } from '../contracts.js';
import { snapshot, validateKey } from '../internal/codec.js';
import { Failure, ensure, safe } from '../internal/errors.js';
import { integer, keys, record, text } from '../internal/json.js';
import { listOptions, page } from '../internal/pagination.js';

const schema = `CREATE TABLE sessions (
  namespace TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, body TEXT, PRIMARY KEY(namespace,id)
);
CREATE INDEX sessions_list ON sessions(namespace,deleted,created_at DESC,id DESC);
PRAGMA user_version = 1;`;

export async function createSqliteSessionStore(options: { readonly filename: string }): Promise<SessionStore> {
  let db: Database | undefined;
  try {
    keys(options, ['filename'], 'SESSION_CONFIG_INVALID');
    const filename = options.filename;
    ensure(text(filename) && filename !== ':memory:' && !filename.includes('\0'), 'SESSION_CONFIG_INVALID');
    const { default: Database } = await import('better-sqlite3').catch(() => { throw new Failure('SQLITE_DRIVER_UNAVAILABLE'); });
    // Set the busy handler before the first read or schema transaction.
    db = new Database(filename, { timeout: 5000 });
    function versionCheck(connection: Database) {
      const version = connection.pragma('user_version', { simple: true });
      ensure(version === 0 || version === 1, 'SESSION_FORMAT_INVALID');
      if (version === 0) ensure((connection.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all()).length === 0, 'SESSION_FORMAT_INVALID');
      return version;
    }
    versionCheck(db);
    ensure(db.pragma('journal_mode = WAL', { simple: true }) === 'wal', 'STORE_UNAVAILABLE');
    db.pragma('synchronous = FULL'); db.pragma('foreign_keys = ON');
    ensure(db.pragma('synchronous', { simple: true }) === 2 && db.pragma('foreign_keys', { simple: true }) === 1 && db.pragma('busy_timeout', { simple: true }) === 5000, 'STORE_UNAVAILABLE');
    const connection = db;
    connection.transaction(() => { if (versionCheck(connection) === 0) connection.exec(schema); }).immediate();
    const columns = connection.prepare('PRAGMA table_info(sessions)').all() as { name: string }[];
    ensure(['namespace', 'id', 'revision', 'deleted', 'created_at', 'updated_at', 'body'].every(name => columns.some(c => c.name === name)), 'SESSION_FORMAT_INVALID');
    const get = connection.prepare('SELECT id,revision,body FROM sessions WHERE namespace=? AND id=? AND deleted=0');
    const insert = connection.prepare('INSERT INTO sessions(namespace,id,revision,created_at,updated_at,body) VALUES(?,?,0,?,?,?)');
    const update = connection.prepare('UPDATE sessions SET revision=revision+1,body=?,updated_at=? WHERE namespace=? AND id=? AND revision=? AND deleted=0');
    const remove = connection.prepare('UPDATE sessions SET revision=revision+1,deleted=1,body=NULL WHERE namespace=? AND id=? AND revision=? AND deleted=0');
    let closed = false, closePromise: Promise<void> | undefined;
    const guard = () => ensure(!closed, 'STORE_CLOSED');
    function decode(row: unknown): SessionSnapshot {
      try {
        ensure(record(row) && typeof row.body === 'string' && typeof row.id === 'string', 'SESSION_FORMAT_INVALID');
        return snapshot({ revision: row.revision, data: JSON.parse(row.body) }, row.id);
      } catch { throw new Failure('SESSION_FORMAT_INVALID'); }
    }
    const store: SessionStore = Object.freeze({
      durability: 'transactional',
      async create(key, data) {
        try {
          guard(); validateKey(key); const value = snapshot({ revision: 0, data }, key.id);
          connection.transaction(() => insert.run(key.namespace, key.id, value.data.createdAt, value.data.updatedAt, JSON.stringify(value.data))).immediate();
          return value;
        } catch (cause) {
          if (record(cause) && cause.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') throw new Failure('SESSION_EXISTS');
          throw safe(cause);
        }
      },
      async read(key) { try { guard(); validateKey(key); const row = get.get(key.namespace, key.id); return row === undefined ? undefined : decode(row); } catch (e) { throw safe(e); } },
      async list(namespace, options) {
        try {
          guard(); const { after, limit } = listOptions(namespace, options);
          const query = connection.prepare('SELECT id,revision,body FROM sessions WHERE namespace=? AND deleted=0' +
            (after ? ' AND (created_at < ? OR (created_at = ? AND id < ? COLLATE BINARY))' : '') + ' ORDER BY created_at DESC,id DESC LIMIT ?');
          const rows = after ? query.all(namespace, after.createdAt, after.createdAt, after.id, limit + 1) : query.all(namespace, limit + 1);
          return page(namespace, rows.map(decode), options);
        } catch (e) { throw safe(e); }
      },
      async compareAndSet(key, expectedRevision, next) {
        try {
          guard(); validateKey(key); ensure(integer(expectedRevision) && expectedRevision < Number.MAX_SAFE_INTEGER, 'SESSION_INPUT_INVALID');
          const value = next === null ? null : snapshot({ revision: expectedRevision + 1, data: next }, key.id);
          const result = connection.transaction(() => value ? update.run(JSON.stringify(value.data), value.data.updatedAt, key.namespace, key.id, expectedRevision) : remove.run(key.namespace, key.id, expectedRevision)).immediate();
          return Object.freeze(result.changes === 1 ? { applied: true, revision: expectedRevision + 1 } : { applied: false });
        } catch (e) { throw safe(e); }
      },
      close() {
        if (!closePromise) {
          closed = true;
          closePromise = Promise.resolve().then(() => { try { connection.close(); } catch (e) { throw safe(e); } });
        }
        return closePromise;
      },
    } satisfies SessionStore);
    return store;
  } catch (cause) {
    try { db?.close(); } catch { /* Preserve initialization failure. */ }
    throw safe(cause);
  }
}
