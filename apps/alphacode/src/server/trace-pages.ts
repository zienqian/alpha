import { createHash } from "node:crypto";
import type { Message } from "@alpha/adk/core";
import type { TraceSnapshot, TraceViewStep } from "@alpha/adk-trace/contracts";
import { buildTraceView, searchTraceSteps } from "./trace-view";
import { fail } from "./security";

/** Revision-bound paging for clients that do not load the bounded metadata view. */
export function traceStepPage(
  snapshot: TraceSnapshot,
  messages: readonly Message[],
  query: URLSearchParams,
) {
  const limit = Number(query.get("limit") ?? 100),
    search = query.get("q") ?? "",
    kind = query.get("kind") ?? "",
    tool = query.get("tool") ?? "",
    direction = query.get("direction") ?? "oldest";
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 200 ||
    search.length > 500 ||
    tool.length > 256 ||
    !["", "call", "text", "model", "error"].includes(kind) ||
    !["oldest", "newest"].includes(direction)
  )
    return fail(400, "INVALID_QUERY");
  const digest = createHash("sha256")
    .update(JSON.stringify([search, kind, tool, direction]))
    .digest("hex");
  let offset = 0;
  const encoded = query.get("cursor");
  if (encoded) {
    let cursor: unknown;
    try {
      cursor = JSON.parse(decodeURIComponent(encoded));
    } catch {
      return fail(400, "INVALID_QUERY");
    }
    if (
      !Array.isArray(cursor) ||
      cursor.length !== 4 ||
      cursor[0] !== snapshot.summary.traceId ||
      cursor[2] !== digest ||
      !Number.isSafeInteger(cursor[3]) ||
      cursor[3] < 0
    )
      return fail(400, "INVALID_QUERY");
    if (cursor[1] !== snapshot.summary.revision)
      return fail(409, "TRACE_REVISION_CHANGED");
    offset = cursor[3];
  }
  const view = buildTraceView(snapshot, messages, {
    persistence: "ready",
    droppedEvents: 0,
  });
  const matches = search.trim()
    ? new Set(searchTraceSteps(snapshot, messages, search))
    : undefined;
  const steps = view.steps.filter(
    (step) =>
      (!kind || step.kind === kind) &&
      (!tool || (step.kind === "call" && step.label === tool)) &&
      (!matches || matches.has(step.stepId)),
  );
  const groups = new Map<string, { groupId: string; groupCount: number }>();
  let run: TraceViewStep[] = [];
  const flush = () => {
    if (run.length >= 3) {
      const groupId = run[0]?.stepId ?? "";
      for (const step of run)
        groups.set(step.stepId, { groupId, groupCount: run.length });
    }
    run = [];
  };
  for (const step of steps) {
    if (step.kind === "call" && step.shape !== "command") {
      if (run[0]?.label !== step.label) flush();
      run.push(step);
    } else flush();
  }
  flush();
  if (direction === "newest") steps.reverse();
  return {
    items: steps
      .slice(offset, offset + limit)
      .map((step) => ({ ...step, ...groups.get(step.stepId) })),
    total: steps.length,
    revision: snapshot.summary.revision,
    searchScope: view.searchScope,
    cursor:
      offset + limit < steps.length
        ? encodeURIComponent(
            JSON.stringify([
              snapshot.summary.traceId,
              snapshot.summary.revision,
              digest,
              offset + limit,
            ]),
          )
        : undefined,
  };
}
