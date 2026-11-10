import type {
  TraceScope,
  TraceSnapshot,
  TraceSummary,
  TraceListOptions,
  TracePage,
} from "./contracts";

export const id = (length = 32): string =>
  crypto.randomUUID().replaceAll("-", "").slice(0, length);
export const sameScope = (a: TraceScope, b: TraceScope): boolean =>
  a.namespace === b.namespace && a.sessionId === b.sessionId;
export const scopedKey = (scope: TraceScope): string =>
  JSON.stringify([scope.namespace, scope.sessionId ?? null]);
export const failure = (code: string): Error & { code: string } =>
  Object.assign(new Error(code), { code });
export function validateScope(scope: TraceScope): void {
  if (
    !scope.namespace ||
    scope.namespace.length > 1024 ||
    (scope.sessionId !== undefined &&
      (!scope.sessionId || scope.sessionId.length > 512))
  )
    throw failure("TRACE_SCOPE_INVALID");
}
export const copy = <T>(value: T): T => structuredClone(value);
// Live chat rows use modelCallId; restored rows use the committed message ID.
export function matchesReply(
  snapshot: TraceSnapshot,
  replyId: string,
): boolean {
  return (
    snapshot.spans.some(
      (span) =>
        span.kind === "model" &&
        (span.modelCallId === replyId || span.assistantId === replyId),
    ) ||
    snapshot.messages.some(
      (message) =>
        message.role === "assistant" && message.messageId === replyId,
    )
  );
}
export function paginate(
  items: TraceSummary[],
  options: TraceListOptions = {},
): TracePage {
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200)
    throw failure("TRACE_LIMIT_INVALID");
  let cursor: [number, string] | undefined;
  if (options.cursor) {
    try {
      const parsed: unknown = JSON.parse(decodeURIComponent(options.cursor));
      if (
        !Array.isArray(parsed) ||
        parsed.length !== 2 ||
        !Number.isFinite(parsed[0]) ||
        typeof parsed[1] !== "string"
      )
        throw Error();
      cursor = parsed as [number, string];
    } catch {
      throw failure("TRACE_CURSOR_INVALID");
    }
  }
  const sorted = items
    .filter(
      (s) =>
        !cursor ||
        s.startedAtMs < cursor[0] ||
        (s.startedAtMs === cursor[0] && s.traceId < cursor[1]),
    )
    .sort(
      (a, b) =>
        b.startedAtMs - a.startedAtMs || b.traceId.localeCompare(a.traceId),
    );
  const selected = sorted.slice(0, limit),
    last = selected.at(-1);
  return {
    items: copy(selected),
    ...(last && sorted.length > limit
      ? {
          cursor: encodeURIComponent(
            JSON.stringify([last.startedAtMs, last.traceId]),
          ),
        }
      : {}),
  };
}
export function interrupt(snapshot: TraceSnapshot): TraceSnapshot {
  if (snapshot.summary.runStatus !== "running") return snapshot;
  snapshot.summary.runStatus = "unknown";
  snapshot.summary.captureStatus = "interrupted";
  snapshot.summary.revision++;
  for (const span of snapshot.spans)
    if (span.status === "running") {
      span.status = "unknown";
      span.incomplete = true;
    }
  return snapshot;
}
