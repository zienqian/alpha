import { vi } from "vitest";
import { demoFolders } from "./demo-data";
import type { SessionInfo, SessionView } from "@/features/sessions/api";

export function mockSessionApi() {
  const infos: SessionInfo[] = demoFolders.flatMap((folder) => folder.sessions.map((session) => ({
    id: session.id, projectId: folder.id, workspaceRoot: folder.path, title: session.title,
    updatedAt: "2026-11-09T01:00:00.000Z", status: "ready",
  })));
  function info(id: string) {
    const result = infos.find((item) => item.id === id);
    if (!result) throw new Error(`Missing fixture info: ${id}`);
    return result;
  }
  const views = new Map<string, SessionView>(demoFolders.flatMap((folder) => folder.sessions.map((session) => [session.id, {
    instanceId: "test-server", sequence: 1, session: info(session.id), modelId: "offline-model",
    state: { busy: false, canSend: true, closing: false, settingsSaving: false, phase: "idle", permissionMode: "ask", status: "Ready", messages: session.messages.map(({ content, ...message }) => ({ ...message, text: content })) },
  }])));
  const overrides = new Map<string, (init: RequestInit) => Response | Promise<Response>>();
  const streams = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>();
  const encoder = new TextEncoder();
  const encode = (value: unknown) => encoder.encode(`data: ${JSON.stringify(value)}\n\n`);
  function emit(path: string, value: unknown) { for (const stream of streams.get(path) ?? []) stream.enqueue(encode(value)); }
  function publish(id: string) {
    const current = views.get(id);
    if (!current) throw new Error(`Missing fixture: ${id}`);
    current.sequence++;
    emit(`/api/sessions/${id}/events`, current);
    emit("/api/events", { instanceId: "test-server", sequence: current.sequence });
  }
  const fetch = vi.fn(async (path: string, init: RequestInit) => {
    const override = overrides.get(path);
    if (override) return override(init);
    if (path.endsWith("/events")) {
      const id = path.slice("/api/sessions/".length, -"/events".length);
      const initial = path === "/api/events" ? { instanceId: "test-server", sequence: 1 } : views.get(id);
      if (!initial) return Response.json({ code: "SESSION_NOT_FOUND" }, { status: 404 });
      let controller: ReadableStreamDefaultController<Uint8Array>;
      const finish = () => {
        if (!streams.get(path)?.delete(controller)) return;
        init.signal?.removeEventListener("abort", finish);
        controller.close();
      };
      return new Response(new ReadableStream<Uint8Array>({
        start(target) {
          controller = target;
          const set = streams.get(path) ?? new Set();
          set.add(controller); streams.set(path, set);
          controller.enqueue(encode(initial));
          init.signal?.addEventListener("abort", finish, { once: true });
          if (init.signal?.aborted) finish();
        },
        cancel() { streams.get(path)?.delete(controller); init.signal?.removeEventListener("abort", finish); },
      }), { headers: { "Content-Type": "text/event-stream" } });
    }
    if (path === "/api/sessions" && init.method === "POST") {
      const { projectId } = JSON.parse(String(init.body));
      const template = infos.find(item => item.projectId === projectId);
      if (!template) throw new Error("Missing project fixture");
      const created: SessionView = { ...view(template.id), session: { ...template, id: crypto.randomUUID(), title: "新会话" },
        state: { ...view(template.id).state, messages: [] } };
      infos.push(created.session); views.set(created.session.id, created);
      return Response.json(created, { status: 201 });
    }
    const action = /^\/api\/sessions\/([^/]+)\/(requests|cancel|approval)$/.exec(path);
    if (action?.[1]) {
      const current = view(action[1]);
      const body = JSON.parse(String(init.body));
      if (action[2] === "requests") {
        current.requestId = body.requestId;
        current.state = { ...current.state, busy: true, canSend: false, phase: "thinking",
          messages: [...current.state.messages, { id: body.requestId, role: "user", text: body.input }] };
        publish(current.session.id);
        return Response.json({ requestId: body.requestId, status: "accepted" }, { status: 202 });
      }
      current.state = { ...current.state, approval: undefined,
        ...(action[2] === "cancel" ? { busy: false, canSend: true, phase: "idle" } : {}) };
      current.approvalId = undefined;
      publish(current.session.id);
      return Response.json({ ok: true });
    }
    if (path === "/api/sessions") return Response.json({ sessions: infos });
    if (path.startsWith("/api/sessions/search?")) {
      const query = (new URL(path, "http://localhost").searchParams.get("q") ?? "").toLowerCase();
      const results = infos.flatMap(session => {
        const snippets = (views.get(session.id)?.state.messages ?? []).filter(message => message.text.toLowerCase().includes(query))
          .map(message => ({ messageId: message.id, role: message.role, text: message.text }));
        return snippets.length || `${session.title}\n${session.workspaceRoot}`.toLowerCase().includes(query)
          ? [{ session, snippets: snippets.slice(0, 3), matchCount: snippets.length }] : [];
      });
      return Response.json({ results });
    }
    const currentView = views.get(decodeURIComponent(path.slice("/api/sessions/".length)));
    return currentView ? Response.json(currentView) : Response.json({ code: "SESSION_NOT_FOUND" }, { status: 404 });
  });
  vi.stubGlobal("fetch", fetch);
  function view(id: string) {
    const result = views.get(id);
    if (!result) throw new Error(`Missing fixture view: ${id}`);
    return result;
  }
  return { fetch, infos, views, overrides, info, view, emit, publish, streams };
}
