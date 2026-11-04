import { createHash, randomUUID } from 'node:crypto';
import { ensure } from './errors.js';

export const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const bytes = (v: unknown): number => Buffer.byteLength(JSON.stringify(v), 'utf8');
export const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
export const identifier = (v: unknown): v is string => text(v) && Buffer.byteLength(v) <= 512 && !/[\p{Cc}\p{Cs}]/u.test(v);
export const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export const now = () => new Date().toISOString();
export const id = () => randomUUID();
export const inputHash = (agentKey: string, input: string) => createHash('sha256').update(JSON.stringify([1, agentKey, input])).digest('hex');
export function keys(value: unknown, allowed: readonly string[], code: string): asserts value is Record<string, unknown> {
  ensure(record(value) && Object.keys(value).every(k => allowed.includes(k)), code);
}
/** Strict, defensive JSON copy. The codec is independent of core internals. */
export function copy<T>(value: T, code = 'SESSION_INPUT_INVALID'): T {
  const seen = new Set<object>();
  function visit(v: unknown, depth: number): unknown {
    ensure(depth <= 256, code);
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number') { ensure(Number.isFinite(v), code); return v; }
    ensure(typeof v === 'object' && v !== null && !seen.has(v), code);
    ensure(Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null, code);
    seen.add(v);
    const out: unknown[] | Record<string, unknown> = Array.isArray(v) ? [] : {};
    const names = Reflect.ownKeys(v);
    if (Array.isArray(v)) ensure(names.length === v.length + 1, code);
    for (const name of names) {
      if (Array.isArray(v) && name === 'length') continue;
      ensure(typeof name === 'string', code);
      if (Array.isArray(v)) ensure(/^(0|[1-9][0-9]*)$/.test(name) && Number(name) < v.length, code);
      const desc = Object.getOwnPropertyDescriptor(v, name);
      ensure(desc && desc.enumerable && 'value' in desc, code);
      Object.defineProperty(out, name, { value: visit(desc.value, depth + 1), enumerable: true, configurable: true, writable: true });
    }
    seen.delete(v); return Object.freeze(out);
  }
  return visit(value, 0) as T;
}
export function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null || Array.isArray(a) !== Array.isArray(b)) return false;
  const aa = Object.keys(a), bb = Object.keys(b);
  return aa.length === bb.length && aa.every(k => Object.hasOwn(b, k) && equal((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
