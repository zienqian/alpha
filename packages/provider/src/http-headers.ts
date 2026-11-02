import { resolveCredential } from './credentials.js';
import { ProviderError } from './errors.js';
import type { AdapterContext, HeaderValue } from './types.js';
import { invalid, isRecord } from './validation-helpers.js';

const reserved = /^(authorization|proxy-authorization|cookie|set-cookie|anthropic-version|content-type)$/i;
const envName = /^[A-Za-z_][A-Za-z0-9_]*$/;

function validHeader(name: string, value: string, anthropic: boolean): boolean {
  try {
    const headers = new Headers();
    headers.set(name, value);
    return !reserved.test(name) && !(anthropic && /^x-api-key$/i.test(name));
  } catch {
    return false;
  }
}

/** Config validation must not read or reveal header values. */
export function validateConfiguredHeaders(value: unknown, path: string, anthropic: boolean): void {
  if (!isRecord(value)) invalid(path);
  const names = new Set<string>();
  for (const [name, header] of Object.entries(value)) {
    const normalized = name.toLowerCase();
    if (names.has(normalized)) invalid(path);
    names.add(normalized);
    if (typeof header === 'string') {
      if (!validHeader(name, header, anthropic)) invalid(path);
    } else if (!isRecord(header) || Object.keys(header).length !== 1 || typeof header.env !== 'string' || !envName.test(header.env) || !validHeader(name, 'placeholder', anthropic)) {
      invalid(path);
    }
  }
}

/** Called at use(), so environment-backed headers follow model credential rotation. */
export function resolveConfiguredHeaders(headers: Readonly<Record<string, HeaderValue>> | undefined, getEnv: AdapterContext['getEnv'], anthropic: boolean): Record<string, string> | undefined {
  if (!headers) return undefined;
  const resolved: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [name, value] of Object.entries(headers)) {
    const text = typeof value === 'string' ? value : resolveCredential(value, getEnv);
    if (text === undefined || !validHeader(name, text, anthropic)) {
      throw new ProviderError('CONFIG_INVALID', 'Configured HTTP header is invalid.');
    }
    resolved[name] = text;
  }
  return resolved;
}

/** Reject protocol-owned headers and ambiguous case-insensitive duplicates. */
export function applyRequestHeaders(target: Headers, value: unknown, anthropic: boolean): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new ProviderError('INVALID_INPUT', 'Invalid request headers.');
  const names = new Set<string>();
  for (const [name, header] of Object.entries(value)) {
    const normalized = name.toLowerCase();
    if (names.has(normalized) || typeof header !== 'string' || !validHeader(name, header, anthropic)) {
      throw new ProviderError('INVALID_INPUT', 'Invalid request headers.');
    }
    names.add(normalized);
    target.set(name, header);
  }
}
