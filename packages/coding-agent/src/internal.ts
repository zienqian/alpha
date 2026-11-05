import type { CodingToolResult } from './contracts.js';

export const byteLength = (text: string): number => new TextEncoder().encode(text).length;
export function failure(code: string): Error & { code: string } { return Object.assign(new Error(code), { code }); }
export function codeOf(cause: unknown, fallback: string): string {
  const code = (cause as { code?: unknown })?.code;
  return typeof code === 'string' && /^[A-Z_]{1,64}$/.test(code) ? code : fallback;
}
export function checkSignal(signal?: AbortSignal): void { if (signal?.aborted) throw failure('CANCELLED'); }
export function positive(value: number, name: string, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) throw failure(`INVALID_${name}`);
  return value;
}
export function relativePath(value: string, directory = false): string {
  const windows = process.platform === 'win32';
  const path = windows ? value.replaceAll('\\', '/') : value;
  if (directory && path === '.') return '.';
  if (!path || path.startsWith('/') || (windows && /[:<>"|?*]/.test(path)) || [...path].some(c => c.charCodeAt(0) < 32)) throw failure('INVALID_PATH');
  const parts = path.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || (windows && (/[. ]$/.test(p) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p))))) throw failure('INVALID_PATH');
  return parts.join('/');
}
export async function digest(value: string): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
export function clip(text: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return new TextDecoder().decode(bytes.subarray(0, end));
}
export function encode(result: CodingToolResult, budget: number): string {
  // Bound the serialized JSON, including escaped controls, not merely the raw text.
  const value = structuredClone(result);
  let output = JSON.stringify(value);
  if (!value.ok && !value.detail) return output;
  const data = (value.ok ? value.data : value.detail) as Record<string, unknown>;
  while (byteLength(output) > budget) {
    data.truncated = true;
    const key = ['content', 'stdout', 'stderr', 'paths', 'matches'].filter(k => data[k] !== undefined)
      .sort((a, b) => JSON.stringify(data[b]).length - JSON.stringify(data[a]).length)[0];
    const entry = data[key];
    if (typeof entry === 'string' && entry.length) data[key] = clip(entry, Math.floor(byteLength(entry) / 2));
    else if (Array.isArray(entry) && entry.length) data[key] = entry.slice(0, Math.floor(entry.length / 2));
    else throw failure('RESULT_BUDGET_TOO_SMALL');
    output = JSON.stringify(value);
  }
  return output;
}
