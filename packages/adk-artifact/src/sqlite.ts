import { Database } from 'bun:sqlite';
import { contentHash, contextError, maxSessionArtifactBytes, parseContextReference, prepareArtifact, readContextText } from './index';
import type { Artifact, ArtifactStore } from './index';

/** Separate immutable evidence store; no changes to Session archive format or revision. */
export function createSqliteArtifactStore(filename: string): ArtifactStore & { close(): void } {
  const db = new Database(filename, { create: true });
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS artifacts (
      namespace TEXT NOT NULL, session_id TEXT NOT NULL, id TEXT NOT NULL,
      bytes INTEGER NOT NULL, metadata TEXT NOT NULL, content TEXT NOT NULL,
      PRIMARY KEY(namespace, session_id, id));
    CREATE TABLE IF NOT EXISTS artifact_tombstones (
      namespace TEXT NOT NULL, session_id TEXT NOT NULL, PRIMARY KEY(namespace, session_id));`);
  return {
    async put(scope, input) {
      scope = { ...scope }; input = { ...input, ...(input.source ? { source: { ...input.source } } : {}) };
      const metadata = await prepareArtifact(scope, input);
      db.transaction(() => {
        if (db.query('SELECT 1 FROM artifact_tombstones WHERE namespace = ? AND session_id = ?').get(scope.namespace, scope.sessionId)) throw contextError('ARTIFACT_SCOPE_DELETED');
        const used = db.query('SELECT COALESCE(SUM(bytes), 0) AS bytes, COUNT(*) AS count FROM artifacts WHERE namespace = ? AND session_id = ?').get(scope.namespace, scope.sessionId) as { bytes: number; count: number };
        if (used.bytes + metadata.bytes > maxSessionArtifactBytes || used.count >= 10000) throw contextError('ARTIFACT_STORAGE_LIMIT');
        db.query('INSERT INTO artifacts VALUES (?, ?, ?, ?, ?, ?)').run(scope.namespace, scope.sessionId, metadata.id, metadata.bytes, JSON.stringify(metadata), input.content);
      }).immediate();
      return metadata;
    },
    async read(scope, request) {
      scope = { ...scope }; request = { ...request };
      const ref = await parseContextReference(scope, request.reference);
      if (ref.kind !== 'artifact') throw contextError('CONTEXT_REFERENCE_INVALID');
      const row = db.query('SELECT metadata, content FROM artifacts WHERE namespace = ? AND session_id = ? AND id = ?').get(scope.namespace, scope.sessionId, ref.id) as { metadata: string; content: string } | null;
      if (!row) throw contextError('CONTEXT_NOT_FOUND');
      const metadata = JSON.parse(row.metadata) as Artifact;
      if (metadata.sha256 !== ref.sha256 || await contentHash(row.content) !== ref.sha256) throw contextError('CONTEXT_CONTENT_MISMATCH');
      return readContextText(row.content, request, metadata.complete);
    },
    async list(scope) {
      return (db.query('SELECT metadata FROM artifacts WHERE namespace = ? AND session_id = ? ORDER BY rowid').all(scope.namespace, scope.sessionId) as { metadata: string }[]).map(row => JSON.parse(row.metadata) as Artifact);
    },
    async remove(scope) {
      db.transaction(() => {
        db.query('INSERT OR IGNORE INTO artifact_tombstones VALUES (?, ?)').run(scope.namespace, scope.sessionId);
        db.query('DELETE FROM artifacts WHERE namespace = ? AND session_id = ?').run(scope.namespace, scope.sessionId);
      }).immediate();
    },
    close() { db.close(); },
  };
}
