import { record } from './json';

export const maxModelRetries = 5;

export function retryableModelError(cause: unknown): cause is { code: string; status?: number } {
  return record(cause) && cause.code === 'REQUEST_FAILED'
    && (cause.status === undefined || (typeof cause.status === 'number' && [408, 429, 500, 502, 503, 504].includes(cause.status)));
}

export function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, delayMs);
    signal.addEventListener('abort', abort, { once: true });
  });
}
