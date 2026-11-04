import type { AdkError } from '@alpha/adk/core';
import type { SessionEvent } from '../contracts.js';
import { ensure } from './errors.js';

export function createDispatch(onError?: (error: Readonly<AdkError>) => void) {
  let depth = 0;
  const report = () => {
    try { void Promise.resolve(onError?.(Object.freeze({ code: 'OBSERVER_FAILED', message: 'OBSERVER_FAILED' }))).catch(() => undefined); }
    catch { /* Observer reporting is best effort. */ }
  };
  return {
    guard() { ensure(depth === 0, 'SESSION_REENTRANT'); },
    invoke(listeners: readonly ((event: SessionEvent) => void)[], event: SessionEvent) {
      depth++;
      try { for (const fn of listeners) { try { void Promise.resolve(fn(event)).catch(report); } catch { report(); } } }
      finally { depth--; }
    },
  };
}
export type Dispatch = ReturnType<typeof createDispatch>;
