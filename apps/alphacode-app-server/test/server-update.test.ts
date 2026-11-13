import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { startSupervisor } from "../src/server/supervisor";
import { codeRevision, serverLayout } from "../src/server/revision";
import { serverPaths, writeJson } from "../src/server/storage";
import { createNativeClient } from "../src/server/http";
import { startServer } from "../src/server/server";
import { ensureServer } from "../src/server/lifecycle";
import { connectApplication } from "../src/server/client";
import type { SessionView } from "../src/server/protocol";
import type { AppConfig } from "../src/config";
import { controlledStream, textResponse, waitFor } from "./helpers";

async function temporary() {
  const root = await mkdtemp(join(tmpdir(), "alphacode-update-test-"));
  return { root, async dispose() {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("alphacode-update-test-")) throw new Error("Unsafe cleanup");
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  } };
}

test("managed updates wait for generation, preserve credentials and drafts, and reconnect on the same address", async () => {
  const temporaryFiles = await temporary();
  const { root } = temporaryFiles;
  const paths = await serverPaths(join(root, "sessions.db"));
  const workspaceRoot = join(root, "workspace");
  await mkdir(workspaceRoot);
  const response = controlledStream();
  let calls = 0;
  const authorizations: (string | null)[] = [];
  const model = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body = await request.json() as { stream?: boolean };
    authorizations.push(request.headers.get("Authorization"));
    if (!body.stream) return Response.json({ choices: [{ message: { content: "Update test" }, finish_reason: "stop" }] });
    return ++calls === 1 ? response.response : textResponse("after update");
  } });
  let revision = "before";
  const supervisor = await startSupervisor({ databasePath: paths.database, directory: paths.directory, descriptorPath: paths.descriptor,
    layout: await serverLayout(), getRevision: async () => revision, pollMs: 60000 });
  const client = createNativeClient(supervisor.descriptor);
  const original = { ...supervisor.descriptor };
  const config: AppConfig = { workspaceRoot, databasePath: paths.database, configDirectory: join(root, "config"),
    modelId: "test-model", baseURL: `http://127.0.0.1:${model.port}/v1`, apiKeyEnv: "UPDATE_TEST_KEY", noAuth: false,
    skills: { sharedDirectories: false, claudeDirectories: false, trustedProjects: [], disabledNames: [] } };
  const streamAbort = new AbortController();
  let subscription: Promise<void> | undefined;
  try {
    const draft = await client.request<SessionView>("/api/connect", { config, credential: "test-memory-only" });
    const path = `/api/sessions/${draft.session.id}`;
    await client.request(`${path}/permission`, { mode: "full" });
    await client.request(`${path}/requests`, { input: "/skills", requestId: "local" });
    await waitFor(async () => !(await client.request<SessionView>(path)).requestId);
    const local = await client.request<SessionView>(path);
    await client.request("/api/web", { sessionId: draft.session.id });
    const htmlBefore = await (await fetch(original.origin, { proxy: false })).text();
    expect(htmlBefore).toContain('name="alphacode-revision" content="before"');
    const views: SessionView[] = [];
    subscription = client.subscribe<SessionView>(`${path}/events`, value => views.push(value), streamAbort.signal);
    const second = await client.request<SessionView>("/api/sessions", { projectId: draft.session.projectId });
    const secondPath = `/api/sessions/${second.session.id}`;
    await client.request(`${secondPath}/requests`, { input: "Keep running during update", requestId: "long" });
    await waitFor(() => calls === 1);
    revision = "after";
    await supervisor.check();
    await supervisor.check();
    expect(supervisor.descriptor.instanceId).toBe(original.instanceId);
    expect((await client.request<SessionView>(secondPath)).state.busy).toBe(true);
    expect(await client.request("/api/info")).toMatchObject({ updateStatus: "pending", revision: "before" });
    response.text("finished before update"); response.end();
    await waitFor(async () => { const view = await client.request<SessionView>(secondPath); return !view.requestId && view.state.titleStatus !== "pending"; });
    const completed = await client.request<SessionView>(secondPath);
    await supervisor.check();
    expect(supervisor.descriptor.origin).toBe(original.origin);
    expect(supervisor.descriptor.token).toBe(original.token);
    expect(supervisor.descriptor.instanceId).not.toBe(original.instanceId);
    const restored = await client.request<SessionView>(path);
    expect(restored.session.updatedAt).toBe(local.session.updatedAt);
    expect(restored.state.permissionMode).toBe("full");
    expect(restored.state.messages).toEqual(local.state.messages);
    expect(restored.state.canSend).toBe(true);
    expect((await client.request<SessionView>(secondPath)).state.messages.some(message => message.text === "finished before update")).toBe(true);
    expect((await client.request<SessionView>(secondPath)).session.updatedAt).toBe(completed.session.updatedAt);
    await waitFor(() => views.some(view => view.instanceId === supervisor.descriptor.instanceId));
    expect(await (await fetch(original.origin, { proxy: false })).text()).toContain('name="alphacode-revision" content="after"');
    const asset = /src="(\/assets\/[^"]+)"/.exec(htmlBefore)?.[1];
    expect(asset).toBeDefined();
    expect((await fetch(`${original.origin}${asset}`, { proxy: false })).status).toBe(200);
    await client.request(`${path}/requests`, { input: "Use the restored credential", requestId: "post-update" });
    await waitFor(async () => !(await client.request<SessionView>(path)).requestId);
    expect(calls).toBe(2);
    expect(authorizations.every(value => value === "Bearer test-memory-only")).toBe(true);
    for (const file of ["projects.json", "server.json"]) expect(await readFile(join(paths.directory, file), "utf8")).not.toContain("test-memory-only");
  } finally {
    response.end(); streamAbort.abort(); await subscription;
    await supervisor.close(); await model.stop(true); await temporaryFiles.dispose();
  }
}, 60000);

test("an invalid replacement rolls back and automatically retries without a page action", async () => {
  const temporaryFiles = await temporary();
  const paths = await serverPaths(join(temporaryFiles.root, "sessions.db"));
  const layout = await serverLayout();
  const worker = join(temporaryFiles.root, "worker.ts");
  await writeFile(worker, `import ${JSON.stringify(pathToFileURL(layout.worker).href)};`);
  let revision = "valid";
  const supervisor = await startSupervisor({ databasePath: paths.database, directory: paths.directory, descriptorPath: paths.descriptor,
    layout: { ...layout, worker }, getRevision: async () => revision, pollMs: 60000, retryMs: 0 });
  try {
    const client = createNativeClient(supervisor.descriptor);
    const instanceId = supervisor.descriptor.instanceId;
    const draft = await client.request<SessionView>("/api/connect", { config: {
      workspaceRoot: temporaryFiles.root, databasePath: paths.database, configDirectory: join(temporaryFiles.root, "config"),
      modelId: "offline-model", baseURL: "https://offline.invalid/v1", apiKeyEnv: "UNUSED", noAuth: true,
      skills: { sharedDirectories: false, claudeDirectories: false, trustedProjects: [], disabledNames: [] },
    } });
    await writeFile(worker, "throw new Error('INVALID_TEST_BUILD');");
    revision = "invalid";
    await supervisor.check(); await supervisor.check();
    expect(supervisor.descriptor.instanceId).toBe(instanceId);
    expect(await client.request("/api/info")).toMatchObject({ revision: "valid", updateStatus: "failed" });
    // A replacement can load successfully but fail after the old port closes.
    // Simulate that boundary to verify rollback uses the cached old worker.
    await writeFile(worker, `process.on("message", m => process.send({ id: m.id, ...(m.method === "start" ? { error: "RESTORE_TEST_FAILURE" } : { value: null }) })); process.send({ event: "loaded", protocolVersion: 2 });`);
    revision = "restore-failed";
    await supervisor.check(); await supervisor.check();
    expect(supervisor.descriptor.instanceId).not.toBe(instanceId);
    expect(await client.request("/api/info")).toMatchObject({ revision: "valid", updateStatus: "failed" });
    expect((await client.request<SessionView>(`/api/sessions/${draft.session.id}`)).state.canSend).toBe(true);
    await writeFile(worker, `import ${JSON.stringify(pathToFileURL(layout.worker).href)};`);
    // The same revision can succeed after a transient load/restore failure.
    // No POST /api/server/update or new revision is needed to retry it.
    await supervisor.check();
    expect(await client.request("/api/info")).toMatchObject({ revision: "restore-failed", updateStatus: "current" });
  } finally { await supervisor.close(); await temporaryFiles.dispose(); }
}, 60000);

test("a compatible legacy daemon allows CLI startup and chatting without requiring all clients to close", async () => {
  const temporaryFiles = await temporary();
  const paths = await serverPaths(join(temporaryFiles.root, "sessions.db"));
  const server = await startServer({ databasePath: paths.database, directory: paths.directory });
  try {
    await writeJson(paths.descriptor, { protocolVersion: 2, instanceId: server.instanceId, origin: server.origin,
      token: server.token, pid: process.pid, databasePath: paths.database });
    expect(await ensureServer(paths.database)).toMatchObject({ origin: server.origin, instanceId: server.instanceId });
    const chat = await connectApplication({ workspaceRoot: temporaryFiles.root, databasePath: paths.database,
      configDirectory: join(temporaryFiles.root, "config"), modelId: "offline-model", baseURL: "https://offline.invalid/v1",
      apiKeyEnv: "UNUSED", noAuth: true,
      skills: { sharedDirectories: false, claudeDirectories: false, trustedProjects: [], disabledNames: [] },
    });
    try {
      await waitFor(() => chat.state.canSend);
      await chat.send("/skills");
      await waitFor(() => chat.state.messages.some(message => message.localResult?.kind === "skills"));
      expect(chat.state.notice).toBeUndefined();
    } finally { await chat.close(); }
    expect(await createNativeClient(server).request("/api/info")).toMatchObject({ instanceId: server.instanceId });
  } finally { await server.close(); await temporaryFiles.dispose(); }
});

test("code revisions are stable and include local source plus the built web entry", async () => {
  const temporaryFiles = await temporary();
  const { root } = temporaryFiles;
  const app = join(root, "apps/alphacode-app-server");
  const web = join(root, "apps/alphacode-web/dist");
  await mkdir(join(app, "src"), { recursive: true });
  await mkdir(join(root, "packages"), { recursive: true });
  await mkdir(web, { recursive: true });
  await writeFile(join(app, "src/main.ts"), "first");
  for (const file of [join(app, "package.json"), join(root, "bun.lock"), join(root, "bunfig.toml"), join(web, "index.html")]) await writeFile(file, "initial");
  try {
    const layout = await serverLayout(join(app, "src/server"));
    const original = await codeRevision(layout);
    expect(await codeRevision(layout)).toBe(original);
    await writeFile(join(app, "src/main.ts"), "second");
    const sourceChange = await codeRevision(layout);
    expect(sourceChange).not.toBe(original);
    await writeFile(join(web, "index.html"), "new build");
    expect(await codeRevision(layout)).not.toBe(sourceChange);
  } finally { await temporaryFiles.dispose(); }
});

test("pre-extraction worker entry supports safe handoff into the extracted server", async () => {
  const temporaryFiles = await temporary();
  const paths = await serverPaths(join(temporaryFiles.root, "sessions.db"));
  const layout = await serverLayout();
  let revision = "legacy-entry";
  const supervisor = await startSupervisor({ databasePath: paths.database, directory: paths.directory, descriptorPath: paths.descriptor,
    layout: { ...layout, worker: join(layout.root, "apps/alphacode/src/server/worker.ts") },
    getRevision: async () => revision, pollMs: 60000 });
  const client = createNativeClient(supervisor.descriptor);
  try {
    const draft = await client.request<SessionView>("/api/connect", { config: {
      workspaceRoot: temporaryFiles.root, databasePath: paths.database, configDirectory: join(temporaryFiles.root, "config"),
      modelId: "codex/gpt-6.1-sol", baseURL: "https://offline.invalid/v1", apiKeyEnv: "UNUSED", noAuth: true,
      skills: { sharedDirectories: false, claudeDirectories: false, trustedProjects: [], disabledNames: [] },
    } });
    const path = `/api/sessions/${draft.session.id}`;
    await client.request(`${path}/requests`, { input: "/skills", requestId: "local" });
    await waitFor(async () => !(await client.request<SessionView>(path)).requestId);
    const before = await client.request<SessionView>(path);
    revision = "new-server";
    await supervisor.check();
    await supervisor.check();
    const after = await client.request<SessionView>(path);
    expect(after.instanceId).not.toBe(before.instanceId);
    expect(after.state.messages).toEqual(before.state.messages);
    expect(after.state.contextUsage?.contextWindow).toBe(500000);
    expect(await client.request("/api/info")).toMatchObject({ updateStatus: "current", revision });
  } finally { await supervisor.close(); await temporaryFiles.dispose(); }
});
