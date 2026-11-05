import type { ApprovalRequest, RequestApproval } from "./contracts";

export interface Approvals {
  readonly pending: ApprovalRequest | undefined;
  request: RequestApproval;
  answer(allow: boolean): void;
  subscribe(listener: (action: ApprovalRequest | undefined) => void): () => void;
}

export function createApprovals(): Approvals {
  let pending: ApprovalRequest | undefined;
  let decide: ((allow: boolean) => void) | undefined;
  const listeners = new Set<(action: ApprovalRequest | undefined) => void>();
  const publish = (action: ApprovalRequest | undefined) => {
    pending = action;
    for (const listener of listeners) listener(action);
  };
  return {
    get pending() { return pending; },
    request(action, signal) {
      // A single visible question can authorize only one command.
      if (signal.aborted || decide) return Promise.resolve(false);
      return new Promise(resolve => {
        let settled = false;
        const finish = (allow: boolean) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", abort);
          decide = undefined;
          publish(undefined);
          resolve(allow && !signal.aborted);
        };
        const abort = () => finish(false);
        decide = finish;
        signal.addEventListener("abort", abort, { once: true });
        publish(action);
        if (signal.aborted) abort();
      });
    },
    answer(allow) { decide?.(allow); },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
