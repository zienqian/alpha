import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { request as httpRequest } from "node:http";
import { basename, dirname, join, resolve } from "node:path";
import type { SessionView, RequestReceipt, SessionInfo, SessionSearchResult } from "../src/server/protocol";
import { createClient } from "../src/server/transport";
import { createApplication } from "../src/application";
import { remoteChat } from "../src/server/client";
import { createNativeClient } from "../src/server/http";
import { startServer } from "../src/server/server";
import { digest, serverPaths, writeJson } from "../src/server/storage";
import { openBrowser } from "../src/server/web";
import type { AppConfig } from "../src/config";
import type { Chat } from "../src/chat/contracts";
import { controlledStream, textResponse, toolResponse, waitFor, type RequestBody } from "./helpers";

async function serverFixture(reply: (body: RequestBody, count: number) => Response = () => textResponse("hello"), idleMs = 60000,
  wrap: (chat: Chat) => Chat = chat => chat) {
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
      return wrap(await createApplication(input, { provider: { fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as RequestBody;
        if (!body.stream) return Response.json({ choices: [{ message: { content: "Test conversation" }, finish_reason: "stop" }] });
        calls.push(body);
        return reply(body, calls.length);
      } } }));
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

test("global search finds persisted message contents across projects without resuming runtimes", async () => {
  const fixture = await serverFixture(() => textResponse(`${"前文 ".repeat(100)}全文检索 a+b ${"后文 ".repeat(100)}`));
  try {
    const first = await fixture.connect();
    const otherWorkspace = join(fixture.root, "search-project");
    await mkdir(otherWorkspace);
    const second = await fixture.connect({ ...fixture.config, workspaceRoot: otherWorkspace });
    for (const view of [first, second]) {
      const path = `/api/sessions/${view.session.id}`;
      await fixture.client().request(`${path}/requests`, { input: "保存一条普通消息", requestId: "search-message" });
      await waitFor(async () => !(await fixture.client().request<SessionView>(path)).requestId);
    }
    const search = (query: string) => fixture.browser().request<{ results: SessionSearchResult[] }>(`/api/sessions/search?q=${encodeURIComponent(query)}`);
    const live = await search("全文检索");
    expect(live.results).toHaveLength(2);
    expect(live.results.every(result => result.matchCount === 1)).toBe(true);
    expect((await search("保存一条普通消息")).results.every(result => result.matchCount === 1)).toBe(true);
    await fixture.restart();
    const creations = fixture.creations;
    const found = await search("全文检索");
    expect(found.results).toHaveLength(2);
    expect(found.results.every(result => result.matchCount === 1 && result.snippets[0]?.text.includes("全文检索"))).toBe(true);
    expect(found.results[0]?.snippets[0]?.text.length).toBeLessThan(220);
    expect((await search("A+B")).results).toHaveLength(2);
    expect((await search("search-project")).results.map(result => result.session.id)).toEqual([second.session.id]);
    expect((await search("保存一条普通消息")).results).toHaveLength(2);
    expect((await search("does-not-exist")).results).toHaveLength(0);
    expect((await search("   ")).results).toHaveLength(0);
    await expect(search("x".repeat(501))).rejects.toMatchObject({ code: "INVALID_QUERY" });
    expect(fixture.creations).toBe(creations);
    expect(fixture.calls).toHaveLength(2);
  } finally { await fixture.dispose(); }
});

test("search includes omitted tool output and old turns both live and after restart", async () => {
  const fixture = await serverFixture((_body, count) => count === 1
    ? toolResponse("read_file", { path: "search-fixture.txt" }) : textResponse("读取完成"));
  try {
    const lines = Array.from({ length: 20 }, (_, index) => index === 10 ? "middle-output-needle" : `line ${index}`);
    lines[0] = `${"x".repeat(300)}long-line-needle`;
    await writeFile(join(fixture.config.workspaceRoot, "search-fixture.txt"), lines.join("\n"));
    const view = await fixture.connect({ ...fixture.config, permissionMode: "full" });
    const path = `/api/sessions/${view.session.id}`;
    await fixture.client().request(`${path}/requests`, { input: "读取文件", requestId: "tool-search" });
    await waitFor(async () => !(await fixture.client().request<SessionView>(path)).requestId);
    const current = await fixture.client().request<SessionView>(path);
    expect(current.state.messages.find(message => message.tool)?.tool?.output).not.toContain("middle-output-needle");
    const assertFound = async () => {
      for (const needle of ["middle-output-needle", "long-line-needle"]) {
        const response = await fixture.browser().request<{ results: SessionSearchResult[] }>(`/api/sessions/search?q=${needle}`);
        expect(response.results).toHaveLength(1);
        expect(response.results[0]?.matchCount).toBe(1);
        expect(response.results[0]?.snippets[0]?.text).toContain(needle);
      }
    };
    await assertFound();
    await fixture.client().request(`${path}/requests`, { input: "继续对话", requestId: "next-turn" });
    await waitFor(async () => !(await fixture.client().request<SessionView>(path)).requestId);
    await assertFound();
    await fixture.restart();
    await assertFound();
  } finally { await fixture.dispose(); }
});

test("Web snapshots retain tool steps in each turn during later requests and after a server restart", async () => {
  const nextReply = controlledStream();
  const fixture = await serverFixture((_body, count) => count === 1 || count === 3
    ? toolResponse("read_file", { path: "history.txt" })
    : count === 5 ? nextReply.response : textResponse("文件读取完成"));
  try {
    await writeFile(join(fixture.config.workspaceRoot, "history.txt"), "persisted tool output");
    const initial = await fixture.connect({ ...fixture.config, permissionMode: "full" });
    const id = initial.session.id;
    const path = `/api/sessions/${id}`;
    const web = fixture.subscribe(id);
    for (const turn of [1, 2]) {
      await fixture.client().request(`${path}/requests`, { input: `读取第 ${turn} 轮`, requestId: `history-${turn}` });
      await waitFor(async () => !(await fixture.client().request<SessionView>(path)).requestId);
    }
    const before = await fixture.browser().request<SessionView>(path);
    expect(before.state.error).toBeUndefined();
    expect(fixture.calls).toHaveLength(4);
    const tools = before.state.messages.filter(message => message.tool);
    expect(tools).toHaveLength(2);
    // Both provider replies deliberately reuse the same call ID in different turns.
    expect(tools[0]?.tool?.callId).toBe(tools[1]?.tool?.callId);
    expect(tools[0]?.id).not.toBe(tools[1]?.id);
    await fixture.client().request(`${path}/requests`, { input: "继续总结", requestId: "history-3" });
    await waitFor(() => fixture.calls.length === 5 && web.values.some(view => view.requestId === "history-3" && view.state.busy));
    const during = web.values.findLast(view => view.requestId === "history-3");
    expect(during?.state.messages.filter(message => message.tool).map(message => message.id)).toEqual(tools.map(message => message.id));
    nextReply.text("总结完成"); nextReply.end();
    await waitFor(async () => !(await fixture.client().request<SessionView>(path)).requestId);
    await web.close();
    await fixture.restart();
    const restored = await fixture.browser().request<SessionView>(path);
    const restoredTools = restored.state.messages.filter(message => message.tool);
    expect(restoredTools.map(message => message.id)).toEqual(tools.map(message => message.id));
    expect(restoredTools.every(message => message.tool?.status === "succeeded" && message.tool.output === "persisted tool output")).toBe(true);
    const order = restored.state.messages.filter(message => message.role === "user" || message.tool).map(message => message.role);
    expect(order).toEqual(["user", "tool", "user", "tool", "user"]);
    expect(fixture.calls).toHaveLength(5);
  } finally { nextReply.end(); await fixture.dispose(); }
});

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

test("CLI and Web queue messages in FIFO order, deduplicate admission and preserve prior replies", async () => {
  const first = controlledStream(), second = controlledStream();
  const fixture = await serverFixture((_body, count) => count === 1 ? first.response : count === 2 ? second.response : textResponse("third reply"));
  const initial = await fixture.connect();
  const path = `/api/sessions/${initial.session.id}`;
  const cli = remoteChat(fixture.client(), initial);
  try {
    await waitFor(() => cli.state.canSend);
    await cli.send("first input", "first");
    await waitFor(() => fixture.calls.length === 1 && cli.state.canQueue === true);
    const receipts = await Promise.all([fixture.browser(), fixture.client()].map(client =>
      client.request<RequestReceipt>(`${path}/requests`, { input: "second input", requestId: "second" })));
    expect(receipts.map(receipt => receipt.status)).toEqual(["accepted", "accepted"]);
    await cli.send("third input", "third");
    await waitFor(() => cli.state.queuedRequests?.length === 2);
    const snapshot = await fixture.browser().request<SessionView>(path);
    expect(snapshot.requestId).toBe("first");
    expect(snapshot.state.queuedRequests).toEqual([
      { requestId: "second", input: "second input" }, { requestId: "third", input: "third input" },
    ]);
    expect(snapshot.state.messages.filter(message => message.role === "user").map(message => message.text)).toEqual(["first input"]);
    expect(fixture.calls).toHaveLength(1);
    await expect(fixture.client().request(`${path}/requests`, { input: "changed", requestId: "second" }))
      .rejects.toMatchObject({ code: "REQUEST_ID_CONFLICT" });
    // Detaching every current client does not own or discard the queue.
    await cli.close();
    first.text("first reply"); first.end();
    await waitFor(() => fixture.calls.length === 2);
    expect(fixture.calls[1]?.messages.map(message => message.content)).toContain("first reply");
    const running = await fixture.browser().request<SessionView>(path);
    expect(running.requestId).toBe("second");
    expect(running.state.queuedRequests?.map(item => item.requestId)).toEqual(["third"]);
    // A stale queue-remove action must never stop a request that has started.
    await expect(fixture.browser().request(`${path}/cancel`, { requestId: "second", queuedOnly: true }))
      .rejects.toMatchObject({ code: "STALE_REQUEST" });
    second.text("second reply"); second.end();
    await waitFor(async () => !(await fixture.client().request<SessionView>(path)).requestId);
    const done = await fixture.browser().request<SessionView>(path);
    expect(done.state.messages.map(message => message.text)).toEqual([
      "first input", "first reply", "second input", "second reply", "third input", "third reply",
    ]);
    expect(done.state.queuedRequests).toEqual([]);
    expect(fixture.calls).toHaveLength(3);
    expect((await fixture.client().request<RequestReceipt>(`${path}/requests`, { input: "second input", requestId: "second" })).status).toBe("settled");
  } finally { first.end(); second.end(); await cli.close(); await fixture.dispose(); }
});

test("removing a queued request leaves the current turn and other sessions running; stopping advances the queue", async () => {
  const model = controlledStream();
  const fixture = await serverFixture((_body, count) => count === 1 ? model.response : textResponse("finished"));
  try {
    const initial = await fixture.connect();
    const path = `/api/sessions/${initial.session.id}`;
    await fixture.client().request(`${path}/requests`, { input: "active", requestId: "active" });
    await waitFor(() => fixture.calls.length === 1);
    for (const requestId of ["remove", "keep"]) {
      await fixture.browser().request(`${path}/requests`, { input: requestId, requestId });
    }
    await fixture.browser().request(`${path}/cancel`, { requestId: "remove", queuedOnly: true });
    const view = await fixture.client().request<SessionView>(path);
    expect(view.requestId).toBe("active");
    expect(view.state.busy).toBe(true);
    expect(view.state.queuedRequests?.map(item => item.requestId)).toEqual(["keep"]);
    expect((await fixture.client().request<RequestReceipt>(`${path}/requests`, { input: "remove", requestId: "remove" })).status).toBe("interrupted");
    const other = await fixture.browser().request<SessionView>("/api/sessions", { projectId: initial.session.projectId });
    const otherPath = `/api/sessions/${other.session.id}`;
    await fixture.browser().request(`${otherPath}/requests`, { input: "independent", requestId: "independent" });
    await waitFor(async () => !(await fixture.client().request<SessionView>(otherPath)).requestId);
    expect(fixture.calls).toHaveLength(2);
    await fixture.browser().request(`${path}/cancel`, { requestId: "active" });
    await waitFor(async () => !(await fixture.client().request<SessionView>(path)).requestId);
    const finished = await fixture.client().request<SessionView>(path);
    expect(finished.state.queuedRequests).toEqual([]);
    expect(finished.state.messages.filter(message => message.role === "user").map(message => message.text)).toEqual(["active", "keep"]);
    expect(fixture.calls).toHaveLength(3);
  } finally { model.end(); await fixture.dispose(); }
});

test("queued messages can be edited and reordered without changing admission identity or current history", async () => {
  const model = controlledStream();
  const fixture = await serverFixture((_body, count) => count === 1 ? model.response : textResponse("reply"));
  try {
    const initial = await fixture.connect();
    const path = `/api/sessions/${initial.session.id}`;
    await fixture.client().request(`${path}/requests`, { input: "active", requestId: "active" });
    await waitFor(() => fixture.calls.length === 1);
    for (const requestId of ["one", "two", "three"]) await fixture.client().request(`${path}/requests`, { input: requestId, requestId });
    const edit = { action: "edit", requestId: "two", input: "edited two", expectedInput: "two" };
    await fixture.browser().request(`${path}/queue`, edit);
    await fixture.browser().request(`${path}/queue`, edit); // Lost acknowledgement retry is idempotent.
    await expect(fixture.client().request(`${path}/queue`, { ...edit, input: "stale edit" })).rejects.toMatchObject({ code: "QUEUE_CONFLICT" });
    await fixture.browser().request(`${path}/queue`, { action: "move", requestId: "three", beforeRequestId: "one" });
    await fixture.browser().request(`${path}/queue`, { action: "move", requestId: "one", beforeRequestId: null });
    const view = await fixture.client().request<SessionView>(path);
    expect(view.state.queuedRequests?.map(item => item.input)).toEqual(["three", "edited two", "one"]);
    expect(view.requestId).toBe("active");
    expect(view.state.messages.filter(message => message.role === "user").map(message => message.text)).toEqual(["active"]);
    expect((await fixture.client().request<RequestReceipt>(`${path}/requests`, { input: "two", requestId: "two" })).status).toBe("accepted");
    model.text("done"); model.end();
    await waitFor(async () => !(await fixture.client().request<SessionView>(path)).requestId);
    const done = await fixture.client().request<SessionView>(path);
    expect(done.state.messages.filter(message => message.role === "user").map(message => message.text)).toEqual(["active", "three", "edited two", "one"]);
    await expect(fixture.client().request(`${path}/queue`, edit)).rejects.toMatchObject({ code: "STALE_REQUEST" });
    expect(fixture.calls).toHaveLength(4);
  } finally { model.end(); await fixture.dispose(); }
});

test("steering interrupts an open model stream and persists the continued run without replay", async () => {
  const first = controlledStream(), guided = controlledStream();
  const fixture = await serverFixture((_body, count) => count === 1 ? first.response : count === 2 ? guided.response : textResponse("queued reply"));
  try {
    const initial = await fixture.connect();
    const path = `/api/sessions/${initial.session.id}`;
    await fixture.client().request(`${path}/requests`, { input: "original task", requestId: "active" });
    await waitFor(async () => Boolean((await fixture.client().request<SessionView>(path)).state.canSteer));
    first.text("initial preview");
    await waitFor(async () => (await fixture.client().request<SessionView>(path)).state.messages.some(message => message.text === "initial preview"));
    for (const requestId of ["later", "guide"]) await fixture.client().request(`${path}/requests`, { input: requestId, requestId });
    const steering = await fixture.browser().request<SessionView>(`${path}/queue`, { action: "steer", requestId: "guide" });
    expect(steering.state.queuedRequests?.find(item => item.requestId === "guide")?.steering).toBe(true);
    // Never complete the original stream: steering must close it and resume.
    await waitFor(() => fixture.calls.length === 2);
    const during = await fixture.client().request<SessionView>(path);
    expect(during.requestId).toBe("active");
    expect(during.state.busy).toBe(true);
    expect(during.state.error).toBeUndefined();
    expect(during.state.messages.find(message => message.text === "initial preview")?.noteCode).toBe("RESPONSE_STEERED");
    await expect(fixture.client().request(`${path}/queue`, { action: "edit", requestId: "guide", expectedInput: "guide", input: "changed" }))
      .rejects.toMatchObject({ code: "STALE_REQUEST" });
    expect(during.state.queuedRequests?.map(item => item.requestId)).toEqual(["later"]);
    expect(during.state.messages.filter(message => message.role === "user").map(message => message.text)).toEqual(["original task", "guide"]);
    expect(fixture.calls[1]?.messages.at(-1)?.content).toBe("guide");
    expect((await fixture.client().request<RequestReceipt>(`${path}/requests`, { input: "guide", requestId: "guide" })).status).toBe("accepted");
    guided.text("guided result"); guided.end();
    await waitFor(async () => !(await fixture.client().request<SessionView>(path)).requestId);
    await fixture.restart();
    const restored = await fixture.client().request<SessionView>(path);
    expect(restored.state.messages.map(message => message.text)).toEqual(["original task", "initial preview", "guide", "guided result", "later", "queued reply"]);
    expect(restored.state.messages.find(message => message.text === "initial preview")?.noteCode).toBe("RESPONSE_STEERED");
    expect((await fixture.client().request<RequestReceipt>(`${path}/requests`, { input: "guide", requestId: "guide" })).status).toBe("settled");
    expect(fixture.calls).toHaveLength(3);
  } finally { first.end(); guided.end(); await fixture.dispose(); }
});

test("steering withdraws a pending approval and continues without executing the command", async () => {
  const fixture = await serverFixture((_body, count) => count === 1
    ? toolResponse("run_command", { command: "echo should-not-run" }) : textResponse("updated plan"));
  try {
    const initial = await fixture.connect();
    const path = `/api/sessions/${initial.session.id}`;
    await fixture.client().request(`${path}/requests`, { input: "original", requestId: "active" });
    await waitFor(async () => Boolean((await fixture.client().request<SessionView>(path)).approvalId));
    const approval = await fixture.client().request<SessionView>(path);
    await fixture.client().request(`${path}/requests`, { input: "do not run that command", requestId: "guide" });
    await fixture.client().request(`${path}/queue`, { action: "steer", requestId: "guide" });
    await waitFor(async () => !(await fixture.client().request<SessionView>(path)).requestId);
    const view = await fixture.client().request<SessionView>(path);
    expect(view.state.lastRunStatus).toBe("completed");
    expect(view.approvalId).toBeUndefined();
    expect(view.state.approval).toBeUndefined();
    expect(view.state.messages.find(message => message.tool)?.tool?.status).toBe("not_executed");
    expect(view.state.messages.at(-1)?.text).toBe("updated plan");
    expect(fixture.calls).toHaveLength(2);
    expect(fixture.calls[1]?.messages.at(-1)?.content).toBe("do not run that command");
    await expect(fixture.client().request(`${path}/approval`, {
      requestId: "active", approvalId: approval.approvalId, allow: true,
    })).rejects.toMatchObject({ code: "STALE_REQUEST" });
  } finally { await fixture.dispose(); }
});

test("a blocked runtime keeps queued messages visible without running them or accepting more", async () => {
  const model = controlledStream();
  let blocked = false;
  const fixture = await serverFixture(() => model.response, 60000, chat => ({
    ...chat,
    get state() { return { ...chat.state, canSend: !blocked && chat.state.canSend }; },
    async send(input, requestId) { await chat.send(input, requestId); blocked = true; },
  }));
  try {
    const initial = await fixture.connect();
    const path = `/api/sessions/${initial.session.id}`;
    await fixture.client().request(`${path}/requests`, { input: "active", requestId: "active" });
    await waitFor(() => fixture.calls.length === 1);
    await fixture.client().request(`${path}/requests`, { input: "waiting", requestId: "waiting" });
    model.text("saved state cannot be confirmed"); model.end();
    await waitFor(async () => !(await fixture.client().request<SessionView>(path)).requestId);
    const view = await fixture.client().request<SessionView>(path);
    expect(view.state.canQueue).toBe(false);
    expect(view.state.queuedRequests).toEqual([{ requestId: "waiting", input: "waiting" }]);
    expect(fixture.server.canReload()).toBe(false);
    await expect(fixture.client().request(`${path}/requests`, { input: "extra", requestId: "extra" }))
      .rejects.toMatchObject({ code: "SESSION_BUSY" });
    await fixture.client().request(`${path}/cancel`, { requestId: "waiting", queuedOnly: true });
    expect((await fixture.client().request<SessionView>(path)).state.queuedRequests).toEqual([]);
    expect(fixture.calls).toHaveLength(1);
  } finally { model.end(); await fixture.dispose(); }
});

test("server shutdown interrupts queued receipts without executing them after restart", async () => {
  const model = controlledStream();
  const fixture = await serverFixture(() => model.response);
  try {
    const initial = await fixture.connect();
    const path = `/api/sessions/${initial.session.id}`;
    await fixture.client().request(`${path}/requests`, { input: "active", requestId: "active" });
    await waitFor(() => fixture.calls.length === 1);
    await fixture.client().request(`${path}/requests`, { input: "queued", requestId: "queued" });
    await fixture.restart();
    expect((await fixture.client().request<RequestReceipt>(`${path}/requests`, { input: "queued", requestId: "queued" })).status).toBe("interrupted");
    expect((await fixture.client().request<SessionView>(path)).state.queuedRequests).toEqual([]);
    expect(fixture.calls).toHaveLength(1);
  } finally { model.end(); await fixture.dispose(); }
});

test("Web starts a shared conversation and CLI continues it with the same runtime and history", async () => {
  const model = controlledStream();
  const fixture = await serverFixture((_body, count) => count === 1 ? model.response : textResponse("CLI continuation"));
  const registered = await fixture.connect();
  const initial = await fixture.browser().request<SessionView>("/api/sessions", { projectId: registered.session.projectId });
  const cli = remoteChat(fixture.client(), initial);
  const web = fixture.subscribe(initial.session.id);
  try {
    await waitFor(() => cli.state.canSend && web.values.length > 0);
    const receipt = await fixture.browser().request<RequestReceipt>(`/api/sessions/${initial.session.id}/requests`, {
      requestId: "web-first", input: "来自 Web 的中文消息",
    });
    expect(receipt.status).toBe("accepted");
    await waitFor(() => fixture.calls.length === 1 && cli.state.messages.some(message => message.text === "来自 Web 的中文消息"));
    model.text("同步的部分回复");
    await waitFor(() => cli.state.messages.at(-1)?.text === "同步的部分回复" && web.values.at(-1)?.state.messages.at(-1)?.text === "同步的部分回复");
    expect(cli.state.busy).toBe(true);
    model.text("，已完成。"); model.end();
    await waitFor(() => cli.state.canSend && web.values.at(-1)?.state.busy === false);
    await cli.send("continue from CLI", "cli-next");
    await waitFor(() => web.values.at(-1)?.state.messages.at(-1)?.text === "CLI continuation" && !cli.state.busy);
    expect(fixture.creations).toBe(2); // Registered session plus the one created by Web.
    expect(fixture.calls).toHaveLength(2);
    expect(JSON.stringify(fixture.calls[1])).toContain("来自 Web 的中文消息");
    expect(cli.state.messages.map(message => message.text)).toEqual(web.values.at(-1)?.state.messages.map(message => message.text) ?? []);
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

test("CLI and Web drafts are usable but absent from history and disappear after server restart", async () => {
  const fixture = await serverFixture();
  try {
    const cli = await fixture.connect();
    const web = await fixture.browser().request<SessionView>("/api/sessions", { projectId: cli.session.projectId });
    expect(web.session.id).not.toBe(cli.session.id);
    for (const draft of [cli, web]) {
      const path = `/api/sessions/${draft.session.id}`;
      expect((await fixture.browser().request<SessionView>(path)).state.messages).toHaveLength(0);
      expect((await fixture.browser().request<SessionView>(`${path}/permission`, { mode: "auto" })).state.permissionMode).toBe("auto");
    }
    expect((await fixture.client().request<{ sessions: SessionInfo[] }>("/api/sessions")).sessions).toHaveLength(0);
    await fixture.restart();
    expect((await fixture.client().request<{ sessions: SessionInfo[] }>("/api/sessions")).sessions).toHaveLength(0);
    for (const draft of [cli, web]) {
      await expect(fixture.client().request(`/api/sessions/${draft.session.id}`)).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
    }
    expect(fixture.calls).toHaveLength(0);
  } finally { await fixture.dispose(); }
});

test("global session index includes registered projects and persisted histories, with single-flight resume", async () => {
  const fixture = await serverFixture();
  try {
    const first = await fixture.connect();
    const otherWorkspace = join(fixture.root, "other-project");
    await mkdir(otherWorkspace);
    const second = await fixture.connect({ ...fixture.config, workspaceRoot: otherWorkspace });
    for (const session of [first, second]) {
      const path = `/api/sessions/${session.session.id}`;
      await fixture.client().request(`${path}/requests`, { input: "save history", requestId: "first-message" });
      await waitFor(async () => !(await fixture.client().request<SessionView>(path)).requestId);
    }
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

test("session recency survives reopening history and follows live activity", async () => {
  const fixture = await serverFixture();
  try {
    const first = await fixture.connect();
    const second = await fixture.connect();
    for (const view of [first, second]) {
      const path = `/api/sessions/${view.session.id}`;
      await fixture.client().request(`${path}/requests`, { input: "save history", requestId: "saved-message" });
      await waitFor(async () => {
        const current = await fixture.client().request<SessionView>(path);
        return !current.requestId && current.state.titleStatus !== "pending";
      });
    }
    await fixture.restart();
    const list = async () => (await fixture.browser().request<{ sessions: SessionInfo[] }>("/api/sessions")).sessions;
    const saved = await list();
    expect(saved.map(session => session.id)).toEqual([second.session.id, first.session.id]);
    const path = `/api/sessions/${first.session.id}`;
    const reopened = await fixture.browser().request<SessionView>(path);
    expect(saved[1]?.updatedAt).toBe(reopened.session.updatedAt);
    const stream = fixture.subscribe(first.session.id);
    await waitFor(() => stream.values.length > 0);
    expect(stream.values[0]?.session.updatedAt).toBe(reopened.session.updatedAt);
    expect(await list()).toEqual(saved);

    // Local commands update the live conversation without changing its archive.
    await fixture.browser().request(`${path}/requests`, { input: "/skills", requestId: "live-activity" });
    await waitFor(async () => !(await fixture.browser().request<SessionView>(path)).requestId);
    const updated = await list();
    expect(updated.map(session => session.id)).toEqual([first.session.id, second.session.id]);
    expect(Date.parse(updated[0]?.updatedAt ?? "")).toBeGreaterThan(Date.parse(saved[0]?.updatedAt ?? ""));
    await stream.close();
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

test("/web keeps an empty CLI draft unpersisted until its first Web message", async () => {
  const fixture = await serverFixture();
  const initial = await fixture.connect();
  let opened = "";
  const cli = remoteChat(fixture.client(), initial, async url => { opened = url; });
  try {
    await waitFor(() => cli.state.canSend);
    await cli.send("/web");
    await cli.send("/web");
    expect(opened).toBe(`${fixture.server.origin}/?session=${encodeURIComponent(initial.session.id)}`);
    expect(fixture.creations).toBe(1);
    expect(fixture.calls).toHaveLength(0);
    expect(cli.state.messages).toHaveLength(0);
    expect((await fixture.browser().request<{ sessions: SessionInfo[] }>("/api/sessions")).sessions).toHaveLength(0);

    const path = `/api/sessions/${initial.session.id}`;
    await fixture.browser().request(`${path}/requests`, { input: "first Web message", requestId: "first-web-message" });
    await waitFor(async () => !(await fixture.browser().request<SessionView>(path)).requestId);
    expect((await fixture.browser().request<{ sessions: SessionInfo[] }>("/api/sessions")).sessions.map(session => session.id)).toEqual([initial.session.id]);
    await waitFor(() => cli.state.messages.some(message => message.text === "first Web message"));
    expect(fixture.creations).toBe(1);
  } finally { await cli.close(); await fixture.dispose(); }
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
    const path = `/api/sessions/${initial.session.id}`;
    await fixture.client().request(`${path}/requests`, { input: "saved history", requestId: "saved-request" });
    await waitFor(async () => !(await fixture.client().request<SessionView>(path)).requestId);
    fixture.calls.length = 0;
    const requestId = "crash-after-admission";
    const input = "never repeat unknown side effects";
    const file = join(fixture.paths.directory, "requests", `${digest(`${initial.session.id}:${requestId}`)}.json`);
    await writeJson(file, { requestId, hash: digest(input), status: "accepted", instanceId: fixture.server.instanceId });
    await fixture.restart();
    const receipt = await fixture.client().request<RequestReceipt>(`/api/sessions/${initial.session.id}/requests`, { requestId, input });
    expect(receipt.status).toBe("interrupted");
    expect(fixture.calls).toHaveLength(0);
    expect((await fixture.client().request<SessionView>(`/api/sessions/${initial.session.id}`)).state.messages.map(message => message.text)).toEqual(["saved history", "hello"]);
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
