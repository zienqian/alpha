import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { request as httpRequest } from "node:http";
import { basename, dirname, join, resolve } from "node:path";
import type { SessionView, RequestReceipt, SessionInfo } from "../src/server/protocol";
import { createClient } from "../src/server/transport";
import { createApplication } from "../src/application";
import { remoteChat } from "../src/server/client";
import { createNativeClient } from "../src/server/http";
import { startServer } from "../src/server/server";
import { digest, serverPaths, writeJson } from "../src/server/storage";
import { openBrowser } from "../src/server/web";
import type { AppConfig } from "../src/config";
import { controlledStream, textResponse, toolResponse, waitFor, type RequestBody } from "./helpers";

async function serverFixture(reply: (body: RequestBody, count: number) => Response = () => textResponse("hello"), idleMs = 60000) {
  const root = await mkdtemp(join(tmpdir(), "alphacode-server-test-"));
  const workspaceRoot = join(root, "workspace");
  const webRoot = join(root, "web");
  await mkdir(workspaceRoot);
  await mkdir(webRoot);
  await writeFile(join(webRoot, "index.html"), "<!doctype html><title>AlphaCode</title>");
  const paths = await serverPaths(join(root, "sessions.db"));
  const config: AppConfig = {
    workspaceRoot, databasePath: paths.database, configDirectory: join(root, "config"),
    modelId: "offline-model", baseURL: "https://offline.invalid/v1", apiKeyEnv: "UNUSED", noAuth: true,
    skills: { sharedDirectories: false, claudeDirectories: false, trustedProjects: [], disabledNames: [] },
  };
  const calls: RequestBody[] = [];
  let creations = 0;
  let webBuilds = 0;
  const options = { databasePath: paths.database, directory: paths.directory, idleMs,
    createChat: async (input: AppConfig) => {
      creations++;
      return createApplication(input, { provider: { fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as RequestBody;
        calls.push(body);
        return reply(body, calls.length);
      } } });
    },
    enableWeb: async () => { webBuilds++; return webRoot; },
  };
  let server = await startServer(options);
  const client = () => createClient(server);
  const browser = () => createClient({ origin: server.origin, fetch: (url, init) => {
    const headers = new Headers(init.headers);
    headers.set("Origin", server.origin);
    headers.set("Sec-Fetch-Site", "same-origin");
    return fetch(url, { ...init, headers, proxy: false });
  } });
  const aborts: AbortController[] = [];
  return {
    root, paths, config, calls, client, browser,
    get server() { return server; },
    get creations() { return creations; },
    get webBuilds() { return webBuilds; },
    async connect(input = config) { return client().request<SessionView>("/api/connect", { config: input }); },
    subscribe(id: string) {
      const abort = new AbortController();
      aborts.push(abort);
      const values: SessionView[] = [];
      const finished = browser().subscribe<SessionView>(`/api/sessions/${id}/events`, view => values.push(view), abort.signal);
      return { values, close: async () => { abort.abort(); await finished; } };
    },
    async restart() { for (const abort of aborts) abort.abort(); await server.close(); server = await startServer(options); },
    async dispose() {
      for (const abort of aborts) abort.abort();
      await server.close();
      if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("alphacode-server-test-")) throw new Error("Unsafe fixture cleanup");
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

test("one runtime streams to CLI and Web; detach does not cancel; duplicate requests do not rerun", async () => {
  const model = controlledStream();
  const fixture = await serverFixture(() => model.response);
  const initial = await fixture.connect();
  const id = initial.session.id;
  const cli = remoteChat(fixture.client(), initial);
  const web = fixture.subscribe(id);
  try {
    const again = await fixture.connect({ ...fixture.config, sessionId: id });
    expect(again.session.id).toBe(id);
    expect(fixture.creations).toBe(1);
    await waitFor(() => cli.state.canSend && web.values.length > 0);
    await cli.send("shared request", "same-request");
    await waitFor(() => fixture.calls.length === 1);
    model.text("live draft");
    await waitFor(() => cli.state.messages.some(message => message.text === "live draft") && web.values.at(-1)?.state.messages.some(message => message.text === "live draft") === true);
    expect(cli.state.activeRunStartedAt).toBeLessThanOrEqual(performance.now());
    expect(web.values.at(-1)?.state.activeRunStartedAt).toBeGreaterThan(Date.now() - 10000);
    await cli.close();
    const duplicate = await fixture.browser().request<RequestReceipt>(`/api/sessions/${id}/requests`, { input: "shared request", requestId: "same-request" });
    expect(duplicate.status).toBe("accepted");
    await expect(fixture.client().request(`/api/sessions/${id}/requests`, { input: "different", requestId: "same-request" })).rejects.toMatchObject({ status: 409, code: "REQUEST_ID_CONFLICT" });
    await expect(fixture.client().request(`/api/sessions/${id}/requests`, { input: "concurrent", requestId: "other-request" })).rejects.toMatchObject({ status: 409 });
    model.text(" final"); model.end();
    await waitFor(() => web.values.at(-1)?.state.busy === false && web.values.at(-1)?.state.messages.at(-1)?.text === "live draft final");
    expect(fixture.calls).toHaveLength(1);
    await web.close();
    const reconnected = fixture.subscribe(id);
    await waitFor(() => reconnected.values.length > 0);
    expect(reconnected.values[0]?.state.messages.at(-1)?.text).toBe("live draft final");
    await reconnected.close();
    await fixture.restart();
    const restored = await fixture.client().request<SessionView>(`/api/sessions/${id}`);
    expect(restored.state.messages.at(-1)?.text).toBe("live draft final");
    expect((await fixture.client().request<RequestReceipt>(`/api/sessions/${id}/requests`, { input: "shared request", requestId: "same-request" })).status).toBe("settled");
    expect(fixture.calls).toHaveLength(1);
  } finally { model.end(); await cli.close(); await fixture.dispose(); }
});

test("approval is shared and exactly one client can decide; cancellation is scoped to its request", async () => {
  const fixture = await serverFixture((_body, count) => count === 1 ? toolResponse("run_command", { command: "echo approval-test" }) : textResponse("denied safely"));
  try {
    const initial = await fixture.connect();
    const path = `/api/sessions/${initial.session.id}`;
    const first = fixture.subscribe(initial.session.id);
    const second = fixture.subscribe(initial.session.id);
    await fixture.client().request(`${path}/requests`, { input: "ask", requestId: "approval-request" });
    await waitFor(() => Boolean(first.values.at(-1)?.approvalId) && Boolean(second.values.at(-1)?.approvalId));
    const decision = first.values.at(-1);
    if (!decision) throw new Error("Missing approval snapshot");
    expect(second.values.at(-1)?.approvalId).toBe(decision.approvalId);
    await expect(fixture.client().request(`${path}/permission`, { mode: "full" })).rejects.toMatchObject({ status: 409 });
    await expect(fixture.client().request(`${path}/cancel`, { requestId: "old-request" })).rejects.toMatchObject({ code: "STALE_REQUEST" });
    const answers = await Promise.allSettled([fixture.client(), fixture.browser()].map(client => client.request(`${path}/approval`, {
      requestId: decision.requestId, approvalId: decision.approvalId, allow: false,
    })));
    expect(answers.filter(answer => answer.status === "fulfilled")).toHaveLength(1);
    expect(answers.filter(answer => answer.status === "rejected")).toHaveLength(1);
    await waitFor(() => first.values.at(-1)?.state.busy === false);
    expect(fixture.calls).toHaveLength(2);
    expect(JSON.stringify(fixture.calls[1])).toContain("denied");
    expect((await fixture.client().request<SessionView>(`${path}/permission`, { mode: "auto" })).state.permissionMode).toBe("auto");
    await waitFor(() => second.values.at(-1)?.state.permissionMode === "auto");
  } finally { await fixture.dispose(); }
});

test("global session index includes registered projects and persisted histories, with single-flight resume", async () => {
  const fixture = await serverFixture();
  try {
    const first = await fixture.connect();
    const otherWorkspace = join(fixture.root, "other-project");
    await mkdir(otherWorkspace);
    const second = await fixture.connect({ ...fixture.config, workspaceRoot: otherWorkspace });
    const listed = await fixture.client().request<{ sessions: SessionInfo[] }>("/api/sessions");
    expect(new Set(listed.sessions.map(session => session.workspaceRoot)).size).toBe(2);
    await fixture.restart();
    const resumed = await Promise.all(Array.from({ length: 5 }, () => fixture.client().request<SessionView>(`/api/sessions/${first.session.id}`)));
    expect(new Set(resumed.map(view => view.session.id)).size).toBe(1);
    expect(fixture.creations).toBe(3);
    const saved = await fixture.client().request<{ sessions: SessionInfo[] }>("/api/sessions");
    expect(saved.sessions.map(session => session.id).sort()).toEqual([first.session.id, second.session.id].sort());
    expect(await readFile(join(fixture.paths.directory, "projects.json"), "utf8")).not.toContain(fixture.server.token);
  } finally { await fixture.dispose(); }
});

test("Web is lazy and opens a reusable session URL without browser authentication", async () => {
  const fixture = await serverFixture();
  try {
    const session = await fixture.connect();
    const origin = fixture.server.origin;
    expect((await fetch(origin)).status).toBe(404);
    expect((await fetch(`${origin}/api/sessions`)).status).toBe(200);
    const launch = await fixture.client().request<{ url: string }>("/api/web", { sessionId: session.session.id });
    expect(fixture.webBuilds).toBe(1);
    expect(launch.url).toBe(`${origin}/?session=${encodeURIComponent(session.session.id)}`);
    expect(new URL(launch.url).hash).toBe("");
    expect(launch.url).not.toContain(fixture.server.token);
    const page = await fetch(launch.url);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(page.headers.get("set-cookie")).toBeNull();
    expect((await fetch(launch.url)).status).toBe(200);
    const browser = fixture.browser();
    expect((await browser.request<SessionView>(`/api/sessions/${session.session.id}`)).session.id).toBe(session.session.id);
    expect((await browser.request<SessionView>(`/api/sessions/${session.session.id}/permission`, { mode: "auto" })).state.permissionMode).toBe("auto");
    await expect(browser.request("/api/browser")).rejects.toMatchObject({ status: 404 });
    await expect(browser.request("/api/browser/exchange", { code: "removed" })).rejects.toMatchObject({ status: 404 });
    expect(await fixture.client().request("/api/web", { sessionId: session.session.id })).toEqual(launch);
    expect(fixture.webBuilds).toBe(1);
  } finally { await fixture.dispose(); }
});

test("local API retains Host, Origin, JSON, cross-site and native-only boundaries", async () => {
  const fixture = await serverFixture();
  try {
    const session = await fixture.connect();
    const origin = fixture.server.origin;
    const path = `/api/sessions/${session.session.id}/permission`;
    for (const source of [undefined, "null", "https://attacker.invalid", "http://127.0.0.1:1", `${origin}.attacker.invalid`]) {
      const headers = new Headers({ "Content-Type": "application/json" });
      if (source !== undefined) headers.set("Origin", source);
      const response = await fetch(`${origin}${path}`, { method: "POST", headers, body: JSON.stringify({ mode: "full" }) });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ code: "INVALID_ORIGIN" });
    }
    const blocked: Record<string, string>[] = [
      { Origin: "https://attacker.invalid" },
      { "Sec-Fetch-Site": "cross-site" },
      { Origin: origin, "Sec-Fetch-Site": "cross-site" },
      { Authorization: `Bearer ${fixture.server.token}`, Origin: "https://attacker.invalid" },
    ];
    for (const headers of blocked) expect((await fetch(`${origin}/api/sessions`, { headers })).status).toBe(403);
    const invalidHost = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(`${origin}/api/info`, { headers: { Host: "attacker.invalid" } }, response => {
        response.resume(); resolve(response.statusCode);
      });
      request.once("error", reject); request.end();
    });
    expect(invalidHost).toBe(403);
    const preflight = await fetch(`${origin}${path}`, { method: "OPTIONS", headers: {
      Origin: "https://attacker.invalid", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type",
    } });
    expect(preflight.status).toBe(403);
    expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
    for (const contentType of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=test"]) {
      const response = await fetch(`${origin}${path}`, { method: "POST", headers: { Origin: origin, "Content-Type": contentType }, body: JSON.stringify({ mode: "full" }) });
      expect(response.status).toBe(415);
      expect(await response.json()).toEqual({ code: "JSON_REQUIRED" });
    }
    const browser = fixture.browser();
    await expect(browser.request("/api/connect", { config: fixture.config })).rejects.toMatchObject({ status: 401, code: "NATIVE_CLIENT_REQUIRED" });
    await expect(browser.request("/api/web", { sessionId: session.session.id })).rejects.toMatchObject({ status: 401, code: "NATIVE_CLIENT_REQUIRED" });
    expect(fixture.webBuilds).toBe(0);
    expect((await browser.request<SessionView>(`/api/sessions/${session.session.id}`)).state.permissionMode).toBe("ask");
    const changed = await browser.request<SessionView>(path, { mode: "auto" });
    expect(changed.state.permissionMode).toBe("auto");
    expect((await fixture.client().request<SessionView>(path, { mode: "ask" })).state.permissionMode).toBe("ask");
  } finally { await fixture.dispose(); }
});

test("native RPC and SSE bypass proxy environment variables without forwarding credentials", async () => {
  const fixture = await serverFixture();
  let intercepted = 0;
  const proxy = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { intercepted++; return new Response("unexpected proxy", { status: 502 }); } });
  const names = ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy"];
  const previous = names.map(name => process.env[name]);
  const abort = new AbortController();
  try {
    const initial = await fixture.connect();
    for (const name of names) process.env[name] = name.toLowerCase() === "no_proxy" ? "" : `http://127.0.0.1:${proxy.port}`;
    const client = createNativeClient(fixture.server);
    expect((await client.request<{ instanceId: string }>("/api/info")).instanceId).toBe(fixture.server.instanceId);
    let snapshot: SessionView | undefined;
    const subscribed = client.subscribe<SessionView>(`/api/sessions/${initial.session.id}/events`, view => { snapshot = view; }, abort.signal);
    await waitFor(() => Boolean(snapshot));
    abort.abort(); await subscribed;
    expect(intercepted).toBe(0);
    expect(() => createNativeClient({ origin: "https://external.invalid", token: "private" })).toThrow("INVALID_LOCAL_ORIGIN");
  } finally {
    abort.abort();
    names.forEach((name, index) => { const value = previous[index]; if (value === undefined) delete process.env[name]; else process.env[name] = value; });
    await proxy.stop(true); await fixture.dispose();
  }
});

test("/web opens the current busy session without creating or prompting another agent", async () => {
  const model = controlledStream();
  const fixture = await serverFixture(() => model.response);
  const initial = await fixture.connect();
  let opened = "";
  const cli = remoteChat(fixture.client(), initial, async url => { opened = url; });
  try {
    await waitFor(() => cli.state.canSend);
    await cli.send("keep running", "web-request");
    await waitFor(() => cli.state.busy && fixture.calls.length === 1);
    await cli.send("/web");
    expect(opened).toBe(`${fixture.server.origin}/?session=${encodeURIComponent(initial.session.id)}`);
    expect(cli.sessionId).toBe(initial.session.id);
    expect(fixture.creations).toBe(1);
    expect(cli.state.messages.filter(message => message.role === "user")).toHaveLength(1);
    cli.cancel();
    await waitFor(() => !cli.state.busy);
    expect(cli.state.status).toBe("Stopped");
  } finally { model.end(); await cli.close(); await fixture.dispose(); }
});

test("failed browser opening shows a reusable session link without an authorization deadline", async () => {
  const fixture = await serverFixture();
  const initial = await fixture.connect();
  const cli = remoteChat(fixture.client(), initial, async () => { throw new Error("NO_BROWSER"); });
  try {
    await waitFor(() => cli.state.canSend);
    await cli.send("/web");
    expect(cli.state.error).toBe(`Open this URL in your browser: ${fixture.server.origin}/?session=${encodeURIComponent(initial.session.id)}`);
    expect(fixture.calls).toHaveLength(0);
  } finally { await cli.close(); await fixture.dispose(); }
});

test("browser launcher rejects remote URLs and shell metacharacters", async () => {
  for (const url of ["https://attacker.invalid/?session=test", "http://127.0.0.1:1234/?session=test'", "http://127.0.0.1:1234/?session=test;calc", "http://127.0.0.1:1234/?session=test\n", "http://127.0.0.1:1234/#code=old"]) {
    await expect(openBrowser(url)).rejects.toThrow("INVALID_WEB_URL");
  }
});

test("an admitted but unconfirmed request after restart is not automatically executed again", async () => {
  const fixture = await serverFixture();
  try {
    const initial = await fixture.connect();
    const requestId = "crash-after-admission";
    const input = "never repeat unknown side effects";
    const file = join(fixture.paths.directory, "requests", `${digest(`${initial.session.id}:${requestId}`)}.json`);
    await writeJson(file, { requestId, hash: digest(input), status: "accepted", instanceId: fixture.server.instanceId });
    await fixture.restart();
    const receipt = await fixture.client().request<RequestReceipt>(`/api/sessions/${initial.session.id}/requests`, { requestId, input });
    expect(receipt.status).toBe("interrupted");
    expect(fixture.calls).toHaveLength(0);
    expect((await fixture.client().request<SessionView>(`/api/sessions/${initial.session.id}`)).state.messages).toHaveLength(0);
  } finally { await fixture.dispose(); }
});

test("idle server keeps a disconnected running task alive, then exits once saved", async () => {
  const model = controlledStream();
  const fixture = await serverFixture(() => model.response, 100);
  try {
    const initial = await fixture.connect();
    await fixture.client().request(`/api/sessions/${initial.session.id}/requests`, { input: "finish without clients", requestId: "detached-request" });
    await waitFor(() => fixture.calls.length === 1);
    await Bun.sleep(350);
    expect((await fixture.client().request<SessionView>(`/api/sessions/${initial.session.id}`)).state.busy).toBe(true);
    model.text("saved"); model.end();
    await Bun.sleep(700);
    await expect(fixture.client().request("/api/info", undefined, AbortSignal.timeout(100))).rejects.toBeDefined();
  } finally { model.end(); await fixture.dispose(); }
});
