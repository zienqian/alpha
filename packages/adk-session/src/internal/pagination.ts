import type { ListOptions, Page, SessionSnapshot, SessionSummary } from '../contracts.js';
import { summary } from './codec.js';
import { ensure } from './errors.js';
import { identifier, integer, keys } from './json.js';

export function listOptions(namespace: string, options?: ListOptions) {
  const C = 'SESSION_INPUT_INVALID'; ensure(identifier(namespace), C);
  keys(options ?? {}, ['limit', 'cursor'], C);
  const limit = options?.limit ?? 20; ensure(integer(limit) && limit >= 1 && limit <= 100, C);
  let after: { createdAt: string; id: string } | undefined;
  if (options?.cursor !== undefined) {
    try {
      ensure(typeof options.cursor === 'string' && /^[A-Za-z0-9_-]+$/.test(options.cursor), C);
      const decoded: unknown = JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8'));
      keys(decoded, ['v', 'namespace', 'createdAt', 'id'], C);
      ensure(decoded.v === 1 && decoded.namespace === namespace && typeof decoded.createdAt === 'string' && Number.isFinite(Date.parse(decoded.createdAt)) && identifier(decoded.id), C);
      after = { createdAt: decoded.createdAt, id: decoded.id };
    } catch { ensure(false, C); }
  }
  return { limit, after };
}
export function compare(a: { createdAt: string; id: string }, b: { createdAt: string; id: string }) {
  return Buffer.compare(Buffer.from(b.createdAt), Buffer.from(a.createdAt)) || Buffer.compare(Buffer.from(b.id), Buffer.from(a.id));
}
export function page(namespace: string, rows: SessionSnapshot[], options?: ListOptions): Page<SessionSummary> {
  const { limit, after } = listOptions(namespace, options);
  const eligible = rows.sort((a, b) => compare(a.data, b.data)).filter(s => !after || compare(s.data, after) > 0);
  const selected = eligible.slice(0, limit), last = selected.at(-1);
  return Object.freeze({ items: Object.freeze(selected.map(summary)), ...(eligible.length > limit && last ? { cursor: Buffer.from(JSON.stringify({ v: 1, namespace, createdAt: last.data.createdAt, id: last.data.id })).toString('base64url') } : {}) });
}
