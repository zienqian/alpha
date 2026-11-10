import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type {
  TracePage,
  TraceView,
  TraceSnapshot,
  TraceStepDetail,
} from "@alpha/adk-trace/contracts";
import type { AppConfig } from "../src/config";
import type { SessionView } from "../src/server/protocol";
import { startServer } from "../src/server/server";
import { createClient } from "../src/server/transport";
import { textResponse, toolResponse, waitFor } from "./helpers";
function verifyCleanup(root: string) {
  if (
    dirname(resolve(root)) !== resolve(tmpdir()) ||
    !basename(root).startsWith("alphacode-trace-integration-")
  )
    throw Error("Unsafe cleanup");
}

test("daemon Trace captures real tools, isolates sessions, redacts details and reads history without restarting agents", async () => {
  const root = await mkdtemp(join(tmpdir(), "alphacode-trace-integration-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  await writeFile(
    join(workspace, "sample.txt"),
    "searchable-output\napi_key=super-secret-value",
  );
  let calls = 0;
  const provider = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as { stream?: boolean };
      if (!body.stream)
        return Response.json({
          choices: [
            {
              message: { content: "Trace verification" },
              finish_reason: "stop",
            },
          ],
        });
      calls++;
      return calls === 1
        ? toolResponse("read_file", { path: "sample.txt" })
        : calls === 2
          ? toolResponse("read_file", { path: "missing.txt" })
          : textResponse("Finished **checking** the files.");
    },
  });
  const config: AppConfig = {
    workspaceRoot: workspace,
    databasePath: join(root, "sessions.db"),
    configDirectory: join(root, "config"),
    modelId: "trace-test-model",
    baseURL: `http://127.0.0.1:${provider.port}/v1`,
    apiKeyEnv: "UNUSED_TRACE_TEST",
    noAuth: true,
    permissionMode: "full",
    skills: {
      sharedDirectories: false,
      claudeDirectories: false,
      trustedProjects: [],
      disabledNames: [],
    },
  };
  const options = {
    databasePath: config.databasePath,
    directory: join(root, "daemon"),
    idleMs: 60000,
  };
  let server = await startServer(options);
  let client = createClient(server);
  try {
    const first = await client.request<SessionView>("/api/connect", { config });
    const path = `/api/sessions/${first.session.id}`;
    await client.request(`${path}/requests`, {
      input: "Check files",
      requestId: "trace-request",
    });
    await waitFor(
      async () => !(await client.request<SessionView>(path)).requestId,
    );
    const page = await client.request<TracePage>(`${path}/traces`);
    expect(page.items).toHaveLength(1);
    const id = page.items[0]!.traceId;
    const view = await client.request<TraceView>(`${path}/traces/${id}/view`);
    const paged = await client.request<{
      items: { stepId: string }[];
      cursor: string;
    }>(`${path}/traces/${id}/steps?limit=1`);
    expect(paged.items).toHaveLength(1);
    const next = await client.request<{ items: { stepId: string }[] }>(
      `${path}/traces/${id}/steps?limit=1&cursor=${encodeURIComponent(paged.cursor)}`,
    );
    expect(next.items[0]?.stepId).not.toBe(paged.items[0]?.stepId);
    await expect(
      client.request(
        `${path}/traces/${id}/steps?limit=1&q=changed&cursor=${encodeURIComponent(paged.cursor)}`,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(view.summary).toMatchObject({
      runStatus: "completed",
      sessionPersistence: "saved",
      captureStatus: "complete",
      totalModelCalls: 3,
    });
    expect(view.steps.filter((s) => s.kind === "call")).toHaveLength(2);
    expect(
      view.steps.some((s) => s.kind === "call" && s.status === "error"),
    ).toBe(true);
    expect(view.lanes?.model.length).toBeGreaterThan(0);
    expect(view.lanes?.tool.length).toBeGreaterThan(0);
    const step = view.steps.find((s) => s.summary === "sample.txt")!;
    const detail = await client.request<TraceStepDetail>(
      `${path}/traces/${id}/steps/${step.stepId}/detail`,
    );
    expect(detail.output).toContain("searchable-output");
    expect(detail.output).not.toContain("super-secret-value");
    const search = await client.request<{ stepIds: string[] }>(
      `${path}/traces/${id}/search?q=searchable-output`,
    );
    expect(search.stepIds).toEqual([step.stepId]);
    const copied = await client.request<{ text: string }>(
      `${path}/traces/${id}/copy`,
      { stepIds: [step.stepId] },
    );
    expect(copied.text).toContain("searchable-output");
    expect(copied.text).not.toContain("super-secret-value");
    const metadata = await client.request<TraceSnapshot>(
      `${path}/traces/${id}/export`,
    );
    expect(JSON.stringify(metadata)).not.toContain("searchable-output");
    const model = metadata.spans.findLast((span) => span.kind === "model");
    const resolveReply = (replyId: string, sessionPath = path) =>
      client.request<{ traceId: string | null }>(
        `${sessionPath}/traces/by-reply?replyId=${encodeURIComponent(replyId)}`,
      );
    expect((await resolveReply(model?.modelCallId ?? "")).traceId).toBe(id);
    expect((await resolveReply(model?.assistantId ?? "")).traceId).toBe(id);
    expect((await resolveReply("missing-reply")).traceId).toBeNull();
    await expect(
      client.request(`${path}/traces/${id}/view?revision=-1`),
    ).rejects.toMatchObject({ status: 409 });
    const other = await client.request<SessionView>("/api/connect", { config });
    expect(
      (
        await resolveReply(
          model?.assistantId ?? "",
          `/api/sessions/${other.session.id}`,
        )
      ).traceId,
    ).toBeNull();
    await expect(
      client.request(`/api/sessions/${other.session.id}/traces/${id}/view`),
    ).rejects.toMatchObject({ status: 404 });
    await client.request(`${path}/requests`, {
      input: "Check files",
      requestId: "trace-request",
    });
    expect(calls).toBe(3);
    await client.request(`${path}/requests`, {
      input: "Another reply",
      requestId: "next-trace-request",
    });
    await waitFor(
      async () => !(await client.request<SessionView>(path)).requestId,
    );
    expect((await resolveReply(model?.modelCallId ?? "")).traceId).toBe(id);
    await server.close();
    provider.stop(true);
    server = await startServer(options);
    client = createClient(server);
    const history = await client.request<TraceView>(
      `${path}/traces/${id}/view`,
    );
    expect(history.steps).toEqual(view.steps);
    expect(calls).toBe(4);
    expect((await resolveReply(model?.modelCallId ?? "")).traceId).toBe(id);
    expect((await resolveReply(model?.assistantId ?? "")).traceId).toBe(id);
    await expect(
      client.request(`${path}/traces?limit=0`),
    ).rejects.toMatchObject({ status: 400 });
  } finally {
    await server.close();
    provider.stop(true);
    verifyCleanup(root);
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});
