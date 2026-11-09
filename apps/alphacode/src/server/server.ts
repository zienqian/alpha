import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { Chat, ApprovalRequest } from "../chat/contracts";
import { protocolVersion, type SessionView, type RequestReceipt, type SessionSearchResult } from "./protocol";
import { createApplication } from "../application";
import type { AppConfig } from "../config";
import { isPermissionMode } from "../runtime/session-settings";
import { archiveSearchMessages, searchSession } from "./search";
import { createRegistry, digest, readJson, writeJson } from "./storage";
import { createSecurity, fail, jsonBody, requiredString, secret } from "./security";

interface Entry {
  chat: Chat;
  projectId: string;
  updatedAt: string;
  requestId?: string;
  admission: boolean;
  approval?: ApprovalRequest;
  approvalId?: string;
  unsubscribe: () => void;
}

interface Journal extends RequestReceipt { hash: string; instanceId: string }

export interface ServerOptions {
  databasePath: string;
  directory: string;
  token?: string;
  instanceId?: string;
  idleMs?: number;
  createChat?: (config: AppConfig, credential?: string) => Promise<Chat>;
  enableWeb?: () => Promise<string>;
  onIdle?: () => void;
}

export async function startServer(options: ServerOptions) {
  const token = options.token ?? secret();
  const instanceId = options.instanceId ?? randomUUID();
  const registry = await createRegistry(options.databasePath, options.directory);
  const receipts = join(options.directory, "requests");
  await mkdir(receipts, { recursive: true, mode: 0o700 });
  const entries = new Map<string, Entry>();
  const opening = new Map<string, Promise<Entry>>();
  const listeners = new Set<() => void>();
  const streams = new Set<() => void>();
  const running = new Set<Promise<void>>();
  let sequence = 0;
  let connections = 0;
  let operations = 0;
  let lastActivity = Date.now();
  let closed = false;
  let stopping: Promise<void> | undefined;
  let webDirectory: Promise<string> | undefined;
  const changed = () => { sequence++; lastActivity = Date.now(); for (const listener of listeners) listener(); };
  const security = createSecurity(token, () => origin);
  const factory = options.createChat ?? ((config, credential) => createApplication(config, {
    provider: { getEnv: name => name === config.apiKeyEnv && credential !== undefined ? credential : process.env[name] },
  }));

  async function createEntry(projectId: string, sessionId?: string): Promise<Entry> {
    const config = registry.configs.get(projectId);
    if (!config) return fail(404, "PROJECT_NOT_FOUND");
    const chat = await factory({ ...config, sessionId }, registry.credentials.get(projectId));
    const entry: Entry = { chat, projectId, admission: false, updatedAt: new Date().toISOString(), unsubscribe: () => undefined };
    entry.unsubscribe = chat.subscribe(() => {
      if (entry.approval !== chat.state.approval) {
        entry.approval = chat.state.approval;
        entry.approvalId = entry.approval ? randomUUID() : undefined;
      }
      entry.updatedAt = new Date().toISOString();
      changed();
    });
    entries.set(chat.sessionId, entry);
    changed();
    return entry;
  }

  async function open(id: string): Promise<Entry> {
    const existing = entries.get(id);
    if (existing) return existing;
    const pending = opening.get(id);
    if (pending) return pending;
    const work = (async () => {
      const saved = await registry.find(id);
      if (!saved) return fail(404, "SESSION_NOT_FOUND");
      return createEntry(saved.projectId, id);
    })();
    opening.set(id, work);
    try { return await work; } finally { opening.delete(id); }
  }

  function snapshot(entry: Entry): SessionView {
    const { chat } = entry;
    const state = chat.state;
    return {
      instanceId, sequence, modelId: chat.modelId, skills: chat.skills ?? [],
      session: { id: chat.sessionId, projectId: entry.projectId, workspaceRoot: chat.workspaceRoot,
        title: state.sessionTitle, status: state.busy ? "running" : state.canSend ? "ready" : "blocked", updatedAt: entry.updatedAt },
      state: { ...state,
        messages: state.messages.map(message => !message.tool ? message : { ...message, tool: { ...message.tool,
          startedAt: message.tool.startedAt === undefined ? undefined : performance.timeOrigin + message.tool.startedAt,
          finishedAt: message.tool.finishedAt === undefined ? undefined : performance.timeOrigin + message.tool.finishedAt,
        } }),
        activeRunStartedAt: state.activeRunStartedAt === undefined ? undefined : performance.timeOrigin + state.activeRunStartedAt },
      requestId: entry.requestId, approvalId: entry.approvalId,
    };
  }

  function stream(value: () => unknown, signal: AbortSignal) {
    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array>;
    let dirty = true;
    let ended = false;
    const flush = () => {
      if (!ended && dirty && controller.desiredSize !== null && controller.desiredSize > 0) {
        dirty = false;
        controller.enqueue(encoder.encode(`id: ${instanceId}:${sequence}\ndata: ${JSON.stringify(value())}\n\n`));
      }
    };
    const notify = () => { dirty = true; flush(); };
    const heartbeat = setInterval(notify, 15000);
    const finish = () => {
      if (ended) return;
      ended = true;
      clearInterval(heartbeat);
      listeners.delete(notify); streams.delete(finish);
      signal.removeEventListener("abort", finish);
      connections--; lastActivity = Date.now();
      try { controller.close(); } catch { return; }
    };
    connections++;
    listeners.add(notify);
    streams.add(finish);
    const body = new ReadableStream<Uint8Array>({
      start(target) { controller = target; if (signal.aborted) finish(); else { signal.addEventListener("abort", finish, { once: true }); flush(); } },
      pull() { flush(); },
      cancel() { finish(); },
    }, { highWaterMark: 1 });
    return new Response(body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
  }

  async function send(entry: Entry, body: Record<string, unknown>) {
    const requestId = requiredString(body, "requestId", 100);
    const input = requiredString(body, "input");
    if (!/^[a-zA-Z0-9_-]+$/.test(requestId)) fail(400, "INVALID_REQUESTID");
    if (entry.admission) fail(409, "SESSION_BUSY");
    entry.admission = true;
    try {
      const file = join(receipts, `${digest(`${entry.chat.sessionId}:${requestId}`)}.json`);
      const hash = digest(input);
      const previous = await readJson<Journal>(file);
      if (previous) {
        if (previous.hash !== hash) fail(409, "REQUEST_ID_CONFLICT");
        const status = previous.status === "accepted" && previous.instanceId !== instanceId ? "interrupted" : previous.status;
        return Response.json({ requestId, status });
      }
      if (entry.chat.state.busy || entry.chat.state.settingsSaving || !entry.chat.state.canSend) fail(409, "SESSION_BUSY");
      const journal: Journal = { requestId, hash, status: "accepted", instanceId };
      await writeJson(file, journal);
      entry.requestId = requestId;
      const work = entry.chat.send(input, requestId).then(async () => {
        await writeJson(file, { ...journal, status: "settled" });
      }).catch(() => { console.error("REQUEST_FINALIZATION_FAILED"); }).finally(() => {
        if (entry.requestId === requestId) entry.requestId = undefined;
        running.delete(work);
        changed();
      });
      running.add(work);
      changed();
      return Response.json({ requestId, status: "accepted" }, { status: 202 });
    } finally { entry.admission = false; }
  }

  async function route(request: Request, server: Bun.Server<undefined>): Promise<Response> {
    security.checkHost(request);
    if (stopping) fail(503, "SERVER_STOPPING");
    const url = new URL(request.url);
    const path = url.pathname;
    if (path.startsWith("/api/")) {
      security.checkAccess(request, path === "/api/connect" || path === "/api/web");
      if (path === "/api/info" && request.method === "GET") return Response.json({ protocolVersion, instanceId, databasePath: options.databasePath });
      if (path === "/api/events" && request.method === "GET") { server.timeout(request, 0); return stream(() => ({ instanceId, sequence }), request.signal); }
      if (path === "/api/sessions" && request.method === "GET") {
        const sessions = await registry.list();
        return Response.json({ sessions: sessions.map(item => { const entry = entries.get(item.id); return entry ? snapshot(entry).session : item; }) });
      }
      if (path === "/api/sessions/search" && request.method === "GET") {
        const query = (url.searchParams.get("q") ?? "").trim();
        if (query.length > 500) fail(400, "INVALID_QUERY");
        const results: SessionSearchResult[] = [];
        if (!query) return Response.json({ results });
        const sessions = await registry.list();
        for (const info of sessions) {
          request.signal.throwIfAborted();
          const entry = entries.get(info.id);
          const saved = await registry.store.read({ namespace: info.projectId, id: info.id });
          // Read archives without opening a runtime or requiring model credentials.
          const archived = saved ? archiveSearchMessages(saved.data) : [];
          // Live user/assistant IDs differ from their stored IDs. Use one source
          // for conversation text and prefer full archives over clipped live tools.
          const live = entry?.chat.state.messages;
          const archivedTools = archived.filter(message => message.tool);
          const archivedToolCalls = new Set(archivedTools.map(message => message.tool?.callId));
          const messages = live ? [...live.filter(message => !message.tool || !archivedToolCalls.has(message.tool.callId)), ...archivedTools] : archived;
          const result = searchSession(entry ? snapshot(entry).session : info, messages, query);
          if (result) results.push(result);
        }
        return Response.json({ results: results.sort((a, b) => b.session.updatedAt.localeCompare(a.session.updatedAt)) });
      }
      if (path === "/api/connect" && request.method === "POST") {
        const body = await jsonBody(request);
        const config = body.config as AppConfig | undefined;
        if (!config || typeof config.workspaceRoot !== "string" || typeof config.modelId !== "string" || typeof config.baseURL !== "string" || typeof config.apiKeyEnv !== "string" || typeof config.noAuth !== "boolean" || config.databasePath !== options.databasePath) return fail(400, "INVALID_CONFIG");
        if (body.credential !== undefined && typeof body.credential !== "string") fail(400, "INVALID_CREDENTIAL");
        if (!config.noAuth && (typeof body.credential !== "string" || !body.credential)) fail(400, "CREDENTIAL_REQUIRED");
        const projectId = await registry.register(config, body.credential as string | undefined);
        const entry = config.sessionId ? await open(config.sessionId) : await createEntry(projectId);
        if (entry.projectId !== projectId) fail(409, "SESSION_PROJECT_MISMATCH");
        return Response.json(snapshot(entry));
      }
      if (path === "/api/sessions" && request.method === "POST") {
        const body = await jsonBody(request);
        return Response.json(snapshot(await createEntry(requiredString(body, "projectId", 100))), { status: 201 });
      }
      if (path === "/api/web" && request.method === "POST") {
        const body = await jsonBody(request);
        const entry = await open(requiredString(body, "sessionId", 100));
        if (!options.enableWeb) return fail(503, "WEB_UNAVAILABLE");
        webDirectory ??= options.enableWeb().catch(error => { webDirectory = undefined; throw error; });
        await webDirectory;
        return Response.json({ url: `${origin}/?session=${encodeURIComponent(entry.chat.sessionId)}` });
      }
      const match = /^\/api\/sessions\/([^/]+)(?:\/(events|requests|cancel|approval|permission))?$/.exec(path);
      if (match?.[1]) {
        const entry = await open(decodeURIComponent(match[1]));
        const action = match[2];
        if (request.method === "GET" && !action) return Response.json(snapshot(entry));
        if (request.method === "GET" && action === "events") { server.timeout(request, 0); return stream(() => snapshot(entry), request.signal); }
        if (request.method !== "POST") fail(405, "METHOD_NOT_ALLOWED");
        const body = await jsonBody(request);
        if (action === "requests") return send(entry, body);
        if (action === "cancel" || action === "approval") {
          if (requiredString(body, "requestId", 100) !== entry.requestId || !entry.chat.state.busy) fail(409, "STALE_REQUEST");
          if (action === "cancel") entry.chat.cancel();
          else {
            if (!entry.approvalId || body.approvalId !== entry.approvalId || typeof body.allow !== "boolean") fail(409, "STALE_APPROVAL");
            entry.approvalId = undefined;
            entry.chat.answerApproval(body.allow as boolean);
          }
          return Response.json({ ok: true });
        }
        if (action === "permission") {
          if (!isPermissionMode(body.mode)) return fail(400, "INVALID_PERMISSION");
          if (entry.admission || entry.chat.state.busy || entry.chat.state.settingsSaving || !await entry.chat.setPermissionMode(body.mode)) fail(409, "SESSION_BUSY");
          return Response.json(snapshot(entry));
        }
      }
      return fail(404, "NOT_FOUND");
    }
    if (request.method !== "GET" || !webDirectory) return fail(404, "WEB_NOT_STARTED");
    const directory = resolve(await webDirectory);
    const filePath = resolve(directory, path === "/" ? "index.html" : `.${decodeURIComponent(path)}`);
    if (!filePath.startsWith(`${directory}${sep}`)) fail(404, "NOT_FOUND");
    const file = Bun.file(filePath);
    if (!await file.exists()) fail(404, "NOT_FOUND");
    return new Response(file);
  }

  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0, maxRequestBodySize: 256 * 1024,
    async fetch(request, serving) {
      operations++; lastActivity = Date.now();
      try {
        const response = await route(request, serving);
        response.headers.set("Cache-Control", "no-store");
        response.headers.set("X-Content-Type-Options", "nosniff");
        response.headers.set("Referrer-Policy", "no-referrer");
        response.headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
        return response;
      } catch (error) {
        const known = error as { status?: number; code?: string };
        return Response.json({ code: known.status ? known.code : "SERVER_ERROR" }, { status: known.status ?? 500 });
      } finally { operations--; lastActivity = Date.now(); }
    },
  });
  const origin = `http://127.0.0.1:${server.port}`;
  const idleMs = options.idleMs ?? 60000;
  const idle = setInterval(() => {
    if (!closed && !stopping && !connections && !operations && !opening.size && !running.size && Date.now() - lastActivity >= idleMs
      && [...entries.values()].every(entry => !entry.admission && !entry.requestId && !entry.chat.state.busy && !entry.chat.state.settingsSaving && entry.chat.state.canSend)) {
      void close().then(() => options.onIdle?.()).catch(() => { console.error("SERVER_IDLE_CLOSE_FAILED"); });
    }
  }, Math.min(idleMs, 1000));
  async function close() {
    if (closed) return;
    stopping ??= (async () => {
      while (operations > 0) await Bun.sleep(10);
      await Promise.all([...opening.values()].map(work => work.catch(() => undefined)));
      for (const entry of entries.values()) await entry.chat.close();
      await Promise.all([...running]);
      for (const entry of entries.values()) entry.unsubscribe();
      await registry.close();
      clearInterval(idle);
      for (const finish of streams) finish();
      await server.stop(true);
      closed = true;
    })().catch(error => { stopping = undefined; throw error; });
    return stopping;
  }
  return { origin, token, instanceId, close };
}
