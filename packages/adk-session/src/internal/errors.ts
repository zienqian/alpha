import type { SessionError } from '../contracts.js';

export class Failure extends Error implements SessionError {
  readonly code: string;
  readonly sessionId?: string;
  readonly cleanupErrors?: readonly { readonly code: string; readonly message: string }[];
  constructor(code: string, options?: { sessionId?: string; cleanupErrors?: readonly Failure[] }) {
    super(code); this.name = 'SessionError'; this.code = code;
    if (options?.sessionId !== undefined) this.sessionId = options.sessionId;
    if (options?.cleanupErrors?.length) this.cleanupErrors = Object.freeze(options.cleanupErrors.map(e => Object.freeze({ code: e.code, message: e.message })));
  }
}
export function ensure(condition: unknown, code: string): asserts condition { if (!condition) throw new Failure(code); }
const portableCodes = new Set(['SESSION_EXISTS', 'SESSION_NOT_FOUND', 'SESSION_FORMAT_INVALID', 'SESSION_INPUT_INVALID', 'STORE_UNAVAILABLE', 'STORE_CLOSED']);
export function safe(cause: unknown, fallback = 'STORE_UNAVAILABLE'): Failure {
  if (cause instanceof Failure) return cause;
  // Custom adapters need a public way to report errors; never trust their message/cause.
  try {
    const code = cause && typeof cause === 'object' ? Object.getOwnPropertyDescriptor(cause, 'code')?.value : undefined;
    if (typeof code === 'string' && portableCodes.has(code)) return new Failure(code);
  } catch { /* Access to an exotic error object is untrusted. */ }
  return new Failure(fallback);
}
export function aggregate(errors: Failure[]): Failure {
  const rest = errors.flatMap((error, index) => [
    ...(index === 0 ? [] : [new Failure(error.code)]),
    ...(error.cleanupErrors ?? []).map(e => new Failure(e.code)),
  ]);
  return new Failure(errors[0].code, { cleanupErrors: rest });
}
