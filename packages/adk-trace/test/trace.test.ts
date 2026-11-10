import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createAgent, type AgentEvent } from "@alpha/adk/core";
import {
  createTracePlugin,
  createTraceService,
  createMemoryTraceStore,
  type TraceStore,
} from "../src";
import { createSqliteTraceStore } from "../src/sqlite";

const scope = { namespace: "project-a", sessionId: "session-a" };
function verifyCleanup(directory: string) {
  if (
    dirname(resolve(directory)) !== resolve(tmpdir()) ||
    !basename(directory).startsWith("alpha-trace-test-")
  )
    throw Error("Unsafe cleanup");
}
const model = {
  provider: "test",
  modelId: "test-model",
  async generate() {
    throw Error("Use stream");
  },
  async *stream() {
    yield { type: "text-delta" as const, text: "SECRET_CONTENT" };
    yield {
      type: "finish" as const,
      result: {
        outcome: "completed" as const,
        text: "SECRET_CONTENT",
        toolCalls: [],
        finishReason: "stop",
        usage: { inputTokens: 12, outputTokens: 3 },
      },
    };
  },
};
test("observer plugin works without Session and never persists content or double-counts root usage", async () => {
  const service = createTraceService();
  const agent = await createAgent({
    instructions: "",
    model,
    plugins: [createTracePlugin({ service, scope })],
  });
  try {
    const events: AgentEvent[] = [];
    agent.subscribe((e) => events.push(e));
    const result = await agent.prompt("SECRET_PROMPT", {
      requestId: "request-1",
    });
    const page = await service.list(scope),
      snapshot = await service.get(scope, page.items[0].traceId);
    expect(result.status).toBe("completed");
    expect(page.items).toHaveLength(1);
    expect(snapshot?.summary).toMatchObject({
      requestId: "request-1",
      inputTokens: 12,
      outputTokens: 3,
      totalModelCalls: 1,
      meteredModelCalls: 1,
    });
    expect(snapshot?.spans.find((s) => s.kind === "model")).toMatchObject({
      name: "test-model",
      timingQuality: "source",
      status: "ok",
    });
    expect(JSON.stringify(snapshot)).not.toContain("SECRET_");
    expect(
      events.every((e) => e.telemetry && Object.isFrozen(e.telemetry)),
    ).toBe(true);
    expect(
      await service.get(
        { ...scope, namespace: "other" },
        page.items[0].traceId,
      ),
    ).toBeUndefined();
    await agent.close();
    expect(service.health.persistence).toBe("memory");
  } finally {
    await agent.close();
    await service.close();
  }
});

function event(seq: number, payload: object, elapsedMs = seq * 10): AgentEvent {
  return {
    agentId: "a",
    runId: "r",
    seq,
    telemetry: { version: 1, timestampMs: Date.now() + elapsedMs, elapsedMs },
    ...payload,
  } as AgentEvent;
}
test("pairing uses assistant + call identity, tolerates out-of-order end, and preserves unknown execution", async () => {
  const service = createTraceService();
  try {
    service.ingest(scope, event(1, { type: "run.start" }, 0));
    service.ingest(
      scope,
      event(
        3,
        {
          type: "tool.end",
          assistantId: "m1",
          callId: "same",
          execution: "succeeded",
        },
        100,
      ),
    );
    service.ingest(
      scope,
      event(
        2,
        { type: "tool.start", assistantId: "m1", callId: "same", name: "Read" },
        30,
      ),
    );
    service.ingest(
      scope,
      event(
        4,
        {
          type: "tool.end",
          assistantId: "m2",
          callId: "same",
          execution: "denied",
        },
        120,
      ),
    );
    service.ingest(
      scope,
      event(
        4,
        {
          type: "tool.end",
          assistantId: "m2",
          callId: "same",
          execution: "denied",
        },
        120,
      ),
    );
    service.ingest(
      scope,
      event(5, { type: "run.end", status: "completed" }, 150),
    );
    const page = await service.list(scope),
      snapshot = (await service.get(scope, page.items[0].traceId))!;
    const spans = snapshot.spans.filter((s) => s.kind === "tool");
    expect(spans).toHaveLength(2);
    expect(spans[0].durationMs).toBe(70);
    expect(spans[0].status).toBe("ok");
    expect(spans[1]).toMatchObject({
      durationMs: null,
      missingStart: true,
      status: "denied",
    });
  } finally {
    await service.close();
  }
});
test("store failure remains fail-open, isolated from agent outcome", async () => {
  const memory = createMemoryTraceStore();
  const store: TraceStore = {
    ...memory,
    durability: "transactional",
    async write() {
      throw Error("disk full");
    },
  };
  const service = createTraceService({ store });
  const agent = await createAgent({
    instructions: "",
    model,
    plugins: [createTracePlugin({ service, scope })],
  });
  try {
    expect((await agent.prompt("go")).status).toBe("completed");
    expect((await service.flush()).persistence).toBe("degraded");
    expect((await service.list(scope)).items).toHaveLength(1);
  } finally {
    await agent.close();
    await service.close();
  }
});
test("SQLite worker persists history, scopes reads, rejects simultaneous owners and recovers unfinished records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alpha-trace-test-"));
  const filename = join(directory, "trace.db");
  let service: ReturnType<typeof createTraceService> | undefined;
  try {
    const store = await createSqliteTraceStore({ filename });
    await expect(createSqliteTraceStore({ filename })).rejects.toMatchObject({
      code: "TRACE_STORE_IN_USE",
    });
    service = createTraceService({ store });
    service.ingest(scope, event(1, { type: "run.start" }, 0));
    service.ingest(
      scope,
      event(2, { type: "model.start", modelCallId: "m" }, 20),
    );
    const traceId = (await service.list(scope)).items[0].traceId;
    expect((await service.flush()).persistence).toBe("ready");
    await service.close();
    const reopened = await createSqliteTraceStore({ filename });
    service = createTraceService({ store: reopened });
    expect((await service.get(scope, traceId))?.summary).toMatchObject({
      runStatus: "unknown",
      captureStatus: "interrupted",
    });
    expect(
      (await service.list({ ...scope, namespace: "other" })).items,
    ).toEqual([]);
    await service.deleteSession(scope);
    expect((await service.list(scope)).items).toEqual([]);
  } finally {
    await service?.close();
    verifyCleanup(directory);
    await rm(directory, { recursive: true, force: true });
  }
});

test("queue overflow before draining marks the owning trace partial and strips extension payloads", async () => {
  const service = createTraceService({ maxQueue: 2 });
  try {
    service.ingest(
      scope,
      event(1, { type: "run.start", secret: "SHOULD_NOT_BE_RETAINED" }, 0),
    );
    service.ingest(
      scope,
      event(2, { type: "model.start", modelCallId: "m" }, 1),
    );
    service.ingest(
      scope,
      event(3, { type: "run.end", status: "completed" }, 2),
    );
    const summary = (await service.list(scope)).items[0];
    expect(summary.captureStatus).toBe("partial");
    expect(summary.droppedEvents).toBe(1);
    expect(
      JSON.stringify(await service.get(scope, summary.traceId)),
    ).not.toContain("SHOULD_NOT");
  } finally {
    await service.close();
  }
});
