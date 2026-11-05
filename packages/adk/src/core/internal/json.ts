import type { Json, JsonObject } from '../contracts';
import { ensure, error } from './errors';

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
/** Reject lossy JSON conversion, accessors, cycles and exotic objects. */
export function copyJson(value: unknown, code = 'INPUT_INVALID'): Json {
  const parents = new Set<object>();
  function visit(input: unknown, depth: number): Json {
    ensure(depth <= 128, code);
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number') { ensure(Number.isFinite(input), code); return input; }
    ensure(typeof input === 'object' && input !== null && !parents.has(input), code);
    const proto = Object.getPrototypeOf(input);
    ensure(Array.isArray(input) || proto === Object.prototype || proto === null, code);
    ensure(Object.getOwnPropertySymbols(input).length === 0, code);
    parents.add(input);
    try {
      if (Array.isArray(input)) {
        const values: Json[] = [];
        ensure(Object.keys(input).length === input.length, code);
        for (let i = 0; i < input.length; i++) {
          const descriptor = Object.getOwnPropertyDescriptor(input, String(i));
          ensure(descriptor && 'value' in descriptor, code);
          values.push(visit(descriptor.value, depth + 1));
        }
        return Object.freeze(values);
      }
      const output: Record<string, Json> = {};
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(input))) {
        ensure(descriptor.enumerable && 'value' in descriptor, code);
        Object.defineProperty(output, key, { value: visit(descriptor.value, depth + 1), enumerable: true });
      }
      return Object.freeze(output);
    } finally { parents.delete(input); }
  }
  try { return visit(value, 0); } catch { throw error(code); }
}
export function copyObject(value: unknown, code = 'INPUT_INVALID'): JsonObject {
  ensure(record(value), code);
  return copyJson(value, code) as JsonObject;
}
/** Adapters bind execution to this exact object, so validate then freeze it in place. */
export function freezeArguments(value: JsonObject): JsonObject {
  copyObject(value, 'TOOL_INPUT_INVALID');
  function freeze(input: Json): void {
    if (input && typeof input === 'object') {
      for (const child of Object.values(input)) freeze(child);
      Object.freeze(input);
    }
  }
  freeze(value);
  return value;
}
const encoder = new TextEncoder();
export function bytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength;
}
export function textBytes(value: string): number { return encoder.encode(value).byteLength; }
export function equalJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equalJson(v, b[i]));
  if (!record(a) || !record(b) || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && equalJson(a[k], b[k]));
}
export function createId(prefix: string): string { return prefix + '_' + globalThis.crypto.randomUUID(); }
