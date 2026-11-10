import type { AgentEvent } from "@alpha/adk/core";
import type {
  TraceScope,
  TraceSnapshot,
  TraceSpan,
  TraceSpanStatus,
} from "./contracts";
import { id } from "./internal";

export interface LiveTrace {
  snapshot: TraceSnapshot;
  models: Map<string, TraceSpan>;
  tools: Map<string, TraceSpan>;
  approvals: Map<string, TraceSpan>;
  seen: Set<number>;
  observedStart: number;
  sourceStart: number;
}
export const callKey = (assistantId: string, callId: string): string =>
  JSON.stringify([assistantId, callId]);
const clean = (text: string | undefined, limit = 256): string | undefined =>
  text?.slice(0, limit);
export function createLive(
  scope: TraceScope,
  event: AgentEvent,
  observed: number,
): LiveTrace {
  const traceId = id(),
    rootSpanId = id(16);
  const quality = event.telemetry ? "source" : "observed";
  const start = event.type === "run.start";
  return {
    models: new Map(),
    tools: new Map(),
    approvals: new Map(),
    seen: new Set(),
    observedStart: observed,
    sourceStart: event.telemetry?.elapsedMs ?? 0,
    snapshot: {
      summary: {
        ...scope,
        schemaVersion: 1,
        traceId,
        rootSpanId,
        agentId: event.agentId,
        runId: event.runId,
        requestId:
          event.type === "run.start" ? event.telemetry?.requestId : undefined,
        startedAtMs: event.telemetry?.timestampMs ?? Date.now(),
        lastOffsetMs: 0,
        durationMs: null,
        runStatus: "running",
        captureStatus: start ? "complete" : "partial",
        droppedEvents: 0,
        sessionPersistence: scope.sessionId ? "unknown" : "not_applicable",
        revision: 0,
        inputTokens: null,
        outputTokens: null,
        totalModelCalls: 0,
        meteredModelCalls: 0,
      },
      spans: [
        {
          spanId: rootSpanId,
          parentSpanId: null,
          kind: "run",
          name: "Agent run",
          seq: 0,
          startOffsetMs: start ? 0 : null,
          endOffsetMs: null,
          durationMs: null,
          observedOffsetMs: 0,
          timingQuality: quality,
          status: "running",
          missingStart: !start,
          links: [],
        },
      ],
      messages: [],
    },
  };
}
export function endSpan(
  span: TraceSpan,
  offset: number,
  status: TraceSpanStatus,
): void {
  span.endOffsetMs = offset;
  span.status = status;
  span.durationMs =
    span.startOffsetMs === null
      ? null
      : Math.max(0, offset - span.startOffsetMs);
}
export function newSpan(
  live: LiveTrace,
  kind: TraceSpan["kind"],
  name: string,
  seq: number,
  offset: number,
): TraceSpan {
  return {
    spanId: id(16),
    parentSpanId: live.snapshot.summary.rootSpanId,
    kind,
    name: clean(name) ?? kind,
    seq,
    startOffsetMs: null,
    endOffsetMs: null,
    durationMs: null,
    observedOffsetMs: offset,
    timingQuality: "unavailable",
    status: "running",
    links: [],
  };
}
export function reduceEvent(
  live: LiveTrace,
  event: AgentEvent,
  observed: number,
  maxSpans: number,
): boolean {
  const { snapshot, models, tools } = live,
    { summary } = snapshot;
  // Delta payloads are never retained; only the first nonempty arrival matters.
  if (event.type === "model.delta") {
    const model = models.get(event.modelCallId);
    if (
      !event.text ||
      !model ||
      model.firstTextMs !== undefined ||
      model.startOffsetMs === null
    )
      return false;
    const offset = event.telemetry
      ? event.telemetry.elapsedMs - live.sourceStart
      : observed - live.observedStart;
    model.firstTextMs = Math.max(0, offset - model.startOffsetMs);
    summary.revision++;
    return true;
  }
  if (live.seen.has(event.seq)) return false;
  if (live.seen.size >= maxSpans * 6 && event.type !== "run.end") {
    summary.captureStatus = "partial";
    summary.droppedEvents++;
    summary.revision++;
    return true;
  }
  live.seen.add(event.seq);
  const offset = Math.max(
    0,
    event.telemetry
      ? event.telemetry.elapsedMs - live.sourceStart
      : observed - live.observedStart,
  );
  const timing = event.telemetry ? "source" : "observed";
  summary.lastOffsetMs = Math.max(summary.lastOffsetMs, offset);
  const allocate = (
    kind: TraceSpan["kind"],
    name: string,
  ): TraceSpan | undefined => {
    if (snapshot.spans.length >= maxSpans) {
      summary.captureStatus = "partial";
      summary.droppedEvents++;
      return;
    }
    const span = newSpan(live, kind, name, event.seq, offset);
    snapshot.spans.push(span);
    return span;
  };
  const start = (span: TraceSpan) => {
    span.startOffsetMs = offset;
    span.observedOffsetMs = offset;
    span.seq = event.seq;
    span.missingStart = false;
    span.timingQuality = timing;
    if (span.endOffsetMs !== null)
      span.durationMs = Math.max(0, span.endOffsetMs - offset);
  };
  if (event.type === "model.start" || event.type === "model.end") {
    let span = models.get(event.modelCallId);
    if (!span) {
      span = allocate("model", event.telemetry?.modelId ?? "Model");
      if (span) {
        span.modelCallId = event.modelCallId;
        models.set(event.modelCallId, span);
      }
    }
    if (span) {
      if (event.type === "model.start") {
        start(span);
        span.provider = clean(event.telemetry?.provider);
        span.modelId = clean(event.telemetry?.modelId);
        span.name = span.modelId ?? "Model";
      } else {
        endSpan(
          span,
          offset,
          event.outcome === "failed"
            ? "error"
            : event.outcome === "cancelled"
              ? "cancelled"
              : "ok",
        );
        span.missingStart = span.startOffsetMs === null;
        span.errorCode = clean(event.telemetry?.errorCode, 80);
        span.assistantId = event.telemetry?.assistantId;
        span.messageId = span.assistantId;
        span.inputTokens = event.telemetry?.usage?.inputTokens;
        span.outputTokens = event.telemetry?.usage?.outputTokens;
        for (const call of event.telemetry?.toolCalls ?? []) {
          if (!span.assistantId) break;
          const key = callKey(span.assistantId, call.callId);
          let tool = tools.get(key);
          if (!tool) {
            tool = allocate("tool", call.name);
            if (tool) {
              tool.assistantId = span.assistantId;
              tool.callId = call.callId;
              tools.set(key, tool);
            }
          }
          if (tool) {
            tool.name = clean(call.name) ?? "Tool";
            tool.links = [{ spanId: span.spanId, relation: "caused_by" }];
          }
        }
      }
      summary.totalModelCalls = models.size;
      const metered = [...models.values()].filter(
        (m) => m.inputTokens !== undefined || m.outputTokens !== undefined,
      );
      summary.meteredModelCalls = metered.length;
      for (const field of ["inputTokens", "outputTokens"] as const) {
        const values = metered.flatMap((m) =>
          m[field] === undefined ? [] : [m[field]!],
        );
        summary[field] = values.length
          ? values.reduce((a, b) => a + b, 0)
          : null;
      }
    }
  } else if (event.type === "tool.start" || event.type === "tool.end") {
    const key = callKey(event.assistantId, event.callId);
    let span = tools.get(key);
    if (!span) {
      span = allocate(
        "tool",
        event.type === "tool.start" ? event.name : "Tool",
      );
      if (span) {
        span.assistantId = event.assistantId;
        span.callId = event.callId;
        tools.set(key, span);
      }
    }
    if (span) {
      if (event.type === "tool.start") {
        start(span);
        span.name = clean(event.name) ?? "Tool";
        span.effect = event.telemetry?.effect;
      } else {
        const status =
          event.execution === "succeeded"
            ? "ok"
            : event.execution === "denied"
              ? "denied"
              : event.execution === "failed"
                ? "error"
                : "unknown";
        endSpan(span, offset, status);
        span.execution = event.execution;
        span.missingStart = span.startOffsetMs === null;
        span.messageId = event.telemetry?.resultMessageId;
      }
    }
  } else if (event.type === "message.commit") {
    if (snapshot.messages.length < maxSpans * 2)
      snapshot.messages.push({
        messageId: event.messageId,
        role: event.role,
        seq: event.seq,
        offsetMs: offset,
      });
    else {
      summary.captureStatus = "partial";
      summary.droppedEvents++;
    }
  } else if (event.type === "run.end") {
    summary.runStatus = event.status;
    const root = snapshot.spans[0];
    endSpan(
      root,
      offset,
      event.status === "failed"
        ? "error"
        : event.status === "cancelled"
          ? "cancelled"
          : event.status === "completed"
            ? "ok"
            : "unknown",
    );
    root.errorCode = clean(event.telemetry?.errorCode, 80);
    summary.durationMs = root.durationMs;
    for (const span of snapshot.spans)
      if (span.status === "running") {
        span.status = "unknown";
        span.incomplete = true;
        summary.captureStatus = "partial";
      }
  }
  summary.revision++;
  return true;
}
