import type { AdkError, AgentEvent } from '../contracts.js';
import { error, errorData } from './errors.js';

export function createEvents(onError?: (error: AdkError) => void) {
  const listeners = new Set<(event: AgentEvent) => void>();
  // Only synchronous reentrant emissions wait here; no consumer/event history buffer.
  const pending: AgentEvent[] = [];
  let dispatching = false;
  function report() {
    try { void Promise.resolve(onError?.(errorData(error('OBSERVER_FAILED')))).catch(() => undefined); }
    catch { /* An error reporter must not recursively report itself. */ }
  }
  return {
    get dispatching() { return dispatching; },
    subscribe(listener: (event: AgentEvent) => void) {
      if (typeof listener !== 'function') throw error('CONFIG_INVALID');
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    emit(event: AgentEvent) {
      pending.push(Object.freeze(event));
      if (dispatching) return;
      dispatching = true;
      try {
        let next: AgentEvent | undefined;
        while ((next = pending.shift()) !== undefined) {
          for (const listener of [...listeners]) {
            try { void Promise.resolve(listener(next)).catch(report); } catch { report(); }
          }
        }
      } finally { dispatching = false; }
    },
  };
}
export type Events = ReturnType<typeof createEvents>;
