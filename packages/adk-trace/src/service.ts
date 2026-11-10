import type { AgentEvent } from "@alpha/adk/core";
import type {
  TraceChange,
  TraceHealth,
  TraceScope,
  TraceSnapshot,
  TraceStore,
  TraceListOptions,
} from "./contracts";
import { createMemoryTraceStore } from "./memory";
import {
  callKey,
  createLive,
  endSpan,
  newSpan,
  reduceEvent,
  type LiveTrace,
} from "./reducer";
import {
  copy,
  failure,
  matchesReply,
  paginate,
  sameScope,
  scopedKey,
  validateScope,
} from "./internal";
import { sanitizeEvent } from "./sanitize";

export interface TraceServiceOptions {
  store?: TraceStore;
  flushIntervalMs?: number;
  maxQueue?: number;
  maxQueueBytes?: number;
  maxLiveTraces?: number;
  maxSpans?: number;
}
type Queued =
  | {
      scope: TraceScope;
      event: AgentEvent;
      observed: number;
      truncated: boolean;
      bytes: number;
    }
  | { action: () => void };
export function createTraceService(options: TraceServiceOptions = {}) {
  const store = options.store ?? createMemoryTraceStore();
  const maxQueue = options.maxQueue ?? 4096,
    maxLive = options.maxLiveTraces ?? 128,
    maxSpans = options.maxSpans ?? 10000;
  const intervalMs = options.flushIntervalMs ?? 250;
  const maxQueueBytes = options.maxQueueBytes ?? 8 * 1024 * 1024;
  if (
    ![maxQueue, maxQueueBytes, maxLive, maxSpans, intervalMs].every(
      (n) => Number.isInteger(n) && n > 0,
    )
  )
    throw failure("TRACE_CONFIG_INVALID");
  const live = new Map<string, LiveTrace>(),
    dirty = new Set<string>(),
    listeners = new Set<(change: TraceChange) => void>();
  const queue: Queued[] = [];
  const pendingDrops = new Map<string, number>();
  let queueBytes = 0,
    overflowed = false;
  let queued = false,
    stopped = false,
    writing: Promise<void> | undefined;
  let health: TraceHealth = {
    persistence: store.durability === "memory" ? "memory" : "ready",
    droppedEvents: 0,
  };
  const keyFor = (scope: TraceScope, agentId: string, runId: string) =>
    JSON.stringify([scopedKey(scope), agentId, runId]);
  function notify(trace?: LiveTrace) {
    const summary = trace?.snapshot.summary;
    const change: TraceChange = {
      traceId: summary?.traceId,
      scope: summary && {
        namespace: summary.namespace,
        sessionId: summary.sessionId,
      },
      revision: summary?.revision,
      health: { ...health },
    };
    for (const listener of listeners) {
      try {
        listener(change);
      } catch {
        /* Observers never change execution. */
      }
    }
  }
  function changed(key: string, trace: LiveTrace) {
    dirty.add(key);
    notify(trace);
  }
  function dropped(trace?: LiveTrace) {
    health = { ...health, droppedEvents: health.droppedEvents + 1 };
    if (trace) {
      trace.snapshot.summary.captureStatus = "partial";
      trace.snapshot.summary.droppedEvents++;
      trace.snapshot.summary.revision++;
    }
  }
  function drain() {
    queued = false;
    const batch = queue.splice(0);
    queueBytes = 0;
    for (const item of batch) {
      try {
        if ("action" in item) {
          item.action();
          continue;
        }
        const { scope, event, observed } = item,
          key = keyFor(scope, event.agentId, event.runId);
        let trace = live.get(key);
        if (!trace) {
          if (live.size >= maxLive) {
            const old = [...live].find(
              ([k, v]) =>
                v.snapshot.summary.runStatus !== "running" && !dirty.has(k),
            );
            if (old) live.delete(old[0]);
            else {
              dropped();
              continue;
            }
          }
          trace = createLive(scope, event, observed);
          live.set(key, trace);
          const missed = pendingDrops.get(key) ?? (overflowed ? 1 : 0);
          pendingDrops.delete(key);
          if (missed) {
            trace.snapshot.summary.captureStatus = "partial";
            trace.snapshot.summary.droppedEvents += missed;
          }
        }
        if (item.truncated) dropped(trace);
        if (reduceEvent(trace, event, observed, maxSpans)) changed(key, trace);
      } catch {
        health = { ...health, code: "TRACE_EVENT_INVALID" };
      }
    }
    overflowed = false;
  }
  function enqueue(item: Queued) {
    if (stopped) return;
    const bytes = "bytes" in item ? item.bytes : 1024;
    if (queue.length >= maxQueue || queueBytes + bytes > maxQueueBytes) {
      const key =
        "event" in item
          ? keyFor(item.scope, item.event.agentId, item.event.runId)
          : undefined;
      const trace = key ? live.get(key) : undefined;
      dropped(trace);
      if (key && trace) changed(key, trace);
      else if (key) {
        if (pendingDrops.size < maxLive * 2)
          pendingDrops.set(key, (pendingDrops.get(key) ?? 0) + 1);
        else overflowed = true;
      }
      notify();
      return;
    }
    queue.push(item);
    queueBytes += bytes;
    if (!queued) {
      queued = true;
      queueMicrotask(drain);
    }
  }
  async function persist() {
    drain();
    if (writing) return writing;
    if (!dirty.size || stopped) return;
    const pending = [...dirty].flatMap((key) => {
      const trace = live.get(key);
      return trace ? [{ key, snapshot: copy(trace.snapshot) }] : [];
    });
    writing = store
      .write(pending.map((p) => p.snapshot))
      .then(() => {
        health = {
          ...health,
          persistence: store.durability === "memory" ? "memory" : "ready",
          code: undefined,
        };
        for (const { key, snapshot } of pending)
          if (
            live.get(key)?.snapshot.summary.revision ===
            snapshot.summary.revision
          )
            dirty.delete(key);
      })
      .catch(() => {
        health = {
          ...health,
          persistence: "degraded",
          code: "TRACE_STORE_UNAVAILABLE",
        };
        notify();
      })
      .finally(() => {
        writing = undefined;
      });
    return writing;
  }
  const timer = setInterval(() => {
    void persist();
  }, intervalMs);
  timer.unref?.();
  function find(
    scope: TraceScope,
    runId: string,
  ): [string, LiveTrace] | undefined {
    return [...live].find(
      ([, value]) =>
        value.snapshot.summary.runId === runId &&
        sameScope(scope, value.snapshot.summary),
    );
  }
  const service = {
    get health(): TraceHealth {
      return { ...health };
    },
    ingest(scope: TraceScope, event: AgentEvent) {
      // Copy only the public metadata envelope. Delta text becomes a boolean marker.
      // A producer retaining its event cannot mutate a queued observation.
      const observed = performance.now();
      const safe = sanitizeEvent(event);
      enqueue({ scope: { ...scope }, ...safe, observed });
    },
    subscribe(listener: (change: TraceChange) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    recordSession(
      scope: TraceScope,
      requestId: string,
      status: "saved" | "unsaved",
    ) {
      enqueue({
        action() {
          for (const [key, trace] of live)
            if (
              sameScope(trace.snapshot.summary, scope) &&
              trace.snapshot.summary.requestId === requestId
            ) {
              trace.snapshot.summary.sessionPersistence = status;
              trace.snapshot.summary.revision++;
              changed(key, trace);
            }
        },
      });
    },
    recordApproval(
      scope: TraceScope,
      runId: string,
      assistantId: string,
      callId: string,
      phase: "start" | "end",
      allowed?: boolean,
    ) {
      const observed = performance.now();
      enqueue({
        action() {
          const entry = find(scope, runId);
          if (!entry) return;
          const [key, trace] = entry,
            toolKey = callKey(assistantId, callId),
            offset = Math.max(0, observed - trace.observedStart);
          let span = trace.approvals.get(toolKey);
          if (
            !span &&
            phase === "start" &&
            trace.snapshot.spans.length < maxSpans
          ) {
            span = newSpan(
              trace,
              "approval",
              "Approval",
              trace.snapshot.summary.revision,
              offset,
            );
            span.startOffsetMs = offset;
            span.timingQuality = "observed";
            span.assistantId = assistantId;
            span.callId = callId;
            const tool = trace.tools.get(toolKey);
            if (tool)
              span.links.push({ spanId: tool.spanId, relation: "related" });
            trace.approvals.set(toolKey, span);
            trace.snapshot.spans.push(span);
          }
          if (span && phase === "end")
            endSpan(
              span,
              offset,
              allowed === undefined ? "cancelled" : allowed ? "ok" : "denied",
            );
          trace.snapshot.summary.revision++;
          changed(key, trace);
        },
      });
    },
    recordToolResult(
      scope: TraceScope,
      runId: string,
      assistantId: string,
      callId: string,
      status: "ok" | "error" | "unknown",
      errorCode?: string,
    ) {
      enqueue({
        action() {
          const entry = find(scope, runId);
          if (!entry) return;
          const [key, trace] = entry,
            span = trace.tools.get(callKey(assistantId, callId));
          if (!span) return;
          span.businessStatus = status;
          if (status === "error") span.status = "error";
          if (errorCode && /^[A-Z0-9_]{1,80}$/.test(errorCode))
            span.errorCode = errorCode;
          trace.snapshot.summary.revision++;
          changed(key, trace);
        },
      });
    },
    async get(
      scope: TraceScope,
      traceId: string,
    ): Promise<TraceSnapshot | undefined> {
      validateScope(scope);
      drain();
      const found = [...live.values()].find(
        (v) =>
          v.snapshot.summary.traceId === traceId &&
          sameScope(scope, v.snapshot.summary),
      );
      return found ? copy(found.snapshot) : store.read(scope, traceId);
    },
    async findByReply(scope: TraceScope, replyId: string) {
      validateScope(scope);
      if (!replyId || replyId.length > 512)
        throw failure("TRACE_REPLY_INVALID");
      drain();
      const value = [...live.values()].find(
        (trace) =>
          sameScope(trace.snapshot.summary, scope) &&
          matchesReply(trace.snapshot, replyId),
      );
      return value
        ? copy(value.snapshot.summary)
        : store.findByReply(scope, replyId);
    },
    async list(scope: TraceScope, opts: TraceListOptions = {}) {
      validateScope(scope);
      drain();
      // Validate even when the durable reader is unavailable; live records remain usable.
      paginate([], opts);
      const stored = await store
        .list(scope, { ...opts, limit: 200 })
        .catch(() => {
          health = {
            ...health,
            persistence: "degraded",
            code: "TRACE_STORE_UNAVAILABLE",
          };
          return { items: [] as TraceSnapshot["summary"][], cursor: undefined };
        });
      const merged = new Map(stored.items.map((s) => [s.traceId, s]));
      for (const value of live.values())
        if (sameScope(value.snapshot.summary, scope))
          merged.set(value.snapshot.summary.traceId, value.snapshot.summary);
      const page = paginate([...merged.values()], opts);
      if (!page.cursor && stored.cursor && page.items.length) {
        const last = page.items.at(-1)!;
        page.cursor = encodeURIComponent(
          JSON.stringify([last.startedAtMs, last.traceId]),
        );
      }
      return page;
    },
    async deleteSession(scope: TraceScope) {
      drain();
      await writing;
      for (const [key, value] of live)
        if (sameScope(value.snapshot.summary, scope)) {
          live.delete(key);
          dirty.delete(key);
        }
      await store.deleteSession(scope);
    },
    async flush({
      timeoutMs = 2000,
    }: { timeoutMs?: number } = {}): Promise<TraceHealth> {
      const deadline = performance.now() + timeoutMs;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const work = (async () => {
        do {
          await persist();
        } while (
          dirty.size &&
          health.persistence !== "degraded" &&
          performance.now() < deadline
        );
      })();
      await Promise.race([
        work,
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, timeoutMs);
        }),
      ]);
      if (timeout) clearTimeout(timeout);
      if (dirty.size && health.persistence !== "degraded")
        health = {
          ...health,
          persistence: "degraded",
          code: "TRACE_FLUSH_TIMEOUT",
        };
      return { ...health };
    },
    async close() {
      if (stopped) return;
      clearInterval(timer);
      await service.flush();
      stopped = true;
      listeners.clear();
      let closingTimer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        store.close().catch(() => undefined),
        new Promise<void>((resolve) => {
          closingTimer = setTimeout(resolve, 2000);
        }),
      ]);
      clearTimeout(closingTimer);
      health = { ...health, persistence: "closed" };
      live.clear();
      pendingDrops.clear();
    },
  };
  return service;
}
export type TraceService = ReturnType<typeof createTraceService>;
