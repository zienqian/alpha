import type { SessionSnapshot, SessionStore } from './contracts.js';
import { snapshot, validateKey } from './internal/codec.js';
import { ensure, safe } from './internal/errors.js';
import { integer } from './internal/json.js';
import { page } from './internal/pagination.js';

export function createMemorySessionStore(): SessionStore {
  const rows = new Map<string, { namespace: string; revision: number; value: SessionSnapshot | null }>();
  let closed = false, closing: Promise<void> | undefined;
  function guard() { ensure(!closed, 'STORE_CLOSED'); }
  return Object.freeze({
    durability: 'memory',
    async create(key, data) {
      try {
        guard(); validateKey(key); const name = JSON.stringify([key.namespace, key.id]);
        ensure(!rows.has(name), 'SESSION_EXISTS');
        const value = snapshot({ revision: 0, data }, key.id);
        rows.set(name, { namespace: key.namespace, revision: 0, value }); return value;
      } catch (e) { throw safe(e); }
    },
    async read(key) { guard(); validateKey(key); return rows.get(JSON.stringify([key.namespace, key.id]))?.value ?? undefined; },
    async list(namespace, options) { guard(); return page(namespace, [...rows.values()].flatMap(r => r.namespace === namespace && r.value ? [r.value] : []), options); },
    async compareAndSet(key, expectedRevision, next) {
      guard(); validateKey(key); ensure(integer(expectedRevision) && expectedRevision < Number.MAX_SAFE_INTEGER, 'SESSION_INPUT_INVALID');
      const name = JSON.stringify([key.namespace, key.id]), row = rows.get(name);
      if (!row?.value || row.value.revision !== expectedRevision) return Object.freeze({ applied: false });
      const value = next === null ? null : snapshot({ revision: expectedRevision + 1, data: next }, key.id);
      rows.set(name, { namespace: key.namespace, revision: expectedRevision + 1, value });
      return Object.freeze({ applied: true, revision: expectedRevision + 1 });
    },
    close() { if (!closing) { closed = true; rows.clear(); closing = Promise.resolve(); } return closing; },
  } satisfies SessionStore);
}
