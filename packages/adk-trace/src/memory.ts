import type { TraceStore, TraceSnapshot } from "./contracts";
import {
  copy,
  matchesReply,
  paginate,
  sameScope,
  validateScope,
} from "./internal";

export function createMemoryTraceStore(
  options: { maxTraces?: number } = {},
): TraceStore {
  const values = new Map<string, TraceSnapshot>();
  const max = options.maxTraces ?? 128;
  if (!Number.isInteger(max) || max < 1)
    throw new Error("TRACE_CONFIG_INVALID");
  return {
    durability: "memory",
    async write(snapshots) {
      for (const snapshot of snapshots) {
        const old = values.get(snapshot.summary.traceId);
        if (!old || old.summary.revision <= snapshot.summary.revision)
          values.set(snapshot.summary.traceId, copy(snapshot));
      }
      while (values.size > max) values.delete(values.keys().next().value!);
    },
    async read(scope, traceId) {
      validateScope(scope);
      const value = values.get(traceId);
      return value && sameScope(value.summary, scope) ? copy(value) : undefined;
    },
    async list(scope, options) {
      validateScope(scope);
      return paginate(
        [...values.values()]
          .filter((v) => sameScope(v.summary, scope))
          .map((v) => v.summary),
        options,
      );
    },
    async findByReply(scope, replyId) {
      validateScope(scope);
      const value = [...values.values()].find(
        (snapshot) =>
          sameScope(snapshot.summary, scope) && matchesReply(snapshot, replyId),
      );
      return value ? copy(value.summary) : undefined;
    },
    async deleteSession(scope) {
      for (const [key, value] of values)
        if (sameScope(value.summary, scope)) values.delete(key);
    },
    async close() {
      values.clear();
    },
  };
}
