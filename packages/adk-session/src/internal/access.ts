import type { ListOptions, Page, SessionData, SessionStore, SessionSummary } from '../contracts';
import { snapshot } from './codec';
import { ensure, safe } from './errors';
import { copy, identifier, integer, keys } from './json';
import { listOptions } from './pagination';

export function createAccess(source: SessionStore, namespace: string) {
  const C = 'SESSION_CONFIG_INVALID';
  ensure(source && ['memory', 'transactional'].includes(source.durability), C);
  for (const key of ['create', 'read', 'list', 'compareAndSet', 'close'] as const) ensure(typeof source[key] === 'function', C);
  const read = source.read.bind(source), create = source.create.bind(source), cas = source.compareAndSet.bind(source), list = source.list.bind(source);
  const key = (id: string) => Object.freeze({ namespace, id });
  return {
    async read(id: string) {
      try { const value = await read(key(id)); return value === undefined ? undefined : snapshot(value, id); } catch (cause) { throw safe(cause); }
    },
    async create(data: SessionData) {
      try { return snapshot(await create(key(data.id), data), data.id); } catch (cause) { throw safe(cause); }
    },
    async cas(id: string, revision: number, next: SessionData | null) {
      try {
        const result = await cas(key(id), revision, next);
        keys(result, ['applied', 'revision'], 'SESSION_FORMAT_INVALID');
        ensure(result.applied === false || (result.applied === true && result.revision === revision + 1), 'SESSION_FORMAT_INVALID');
        return result.applied;
      } catch (cause) { throw safe(cause); }
    },
    async list(options?: ListOptions): Promise<Page<SessionSummary>> {
      listOptions(namespace, options);
      try {
        const result = copy(await list(namespace, options), 'SESSION_FORMAT_INVALID');
        keys(result, ['items', 'cursor'], 'SESSION_FORMAT_INVALID');
        ensure(Array.isArray(result.items) && result.items.length <= (options?.limit ?? 20) && (result.cursor === undefined || typeof result.cursor === 'string'), 'SESSION_FORMAT_INVALID');
        const ids = new Set<string>();
        for (const row of result.items) {
          keys(row, ['id', 'revision', 'title', 'updatedAt', 'status'], 'SESSION_FORMAT_INVALID');
          ensure(identifier(row.id) && !ids.has(row.id) && integer(row.revision) && typeof row.title === 'string' && typeof row.updatedAt === 'string' && ['ready', 'pending', 'blocked'].includes(row.status as string), 'SESSION_FORMAT_INVALID'); ids.add(row.id);
        }
        return result as unknown as Page<SessionSummary>;
      } catch (cause) { throw safe(cause); }
    },
  };
}
export type Access = ReturnType<typeof createAccess>;
