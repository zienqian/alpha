import { vi } from "vitest";
import { demoFolders } from "./demo-data";
import type { ProjectInfo, SessionInfo, SessionView } from "@/features/sessions/api";
import type {
  BotDetailStateView,
  BotsGlobalConfigView,
  BotsIndexSnapshot,
  BotSummaryView,
  BotTaskDiffView,
  BotWorkerSessionSnapshot,
} from "@/features/bots/api";

export function mockSessionApi() {
  const projects: ProjectInfo[] = [];
  const removedProjects = new Set<string>();
  const botDetails = new Map<string, BotDetailStateView>();
  const botDiffs = new Map<string, BotTaskDiffView>();
  const botTaskSessions = new Map<string, BotWorkerSessionSnapshot>();
  let botSequence = 1;
  const botsDefaults: BotsGlobalConfigView = {
    maxConcurrentWorkers: 4,
    perBotMaxWorkers: 2,
    worktreeRoot: "/tmp/alphacode-worktrees",
    globalModelId: "offline-model",
    router: { modelId: "offline-model", baseURL: "http://127.0.0.1:4000/v1", apiKeyEnv: "OPENAI_API_KEY", noAuth: false, source: "inherited" },
    worker: { modelId: "offline-model", baseURL: "http://127.0.0.1:4000/v1", apiKeyEnv: "OPENAI_API_KEY", noAuth: false, source: "inherited" },
  };
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
  function openSse(path: string, initial: unknown, signal?: AbortSignal | null) {
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const finish = () => {
      if (!streams.get(path)?.delete(controller)) return;
      signal?.removeEventListener("abort", finish);
      controller.close();
    };
    return new Response(new ReadableStream<Uint8Array>({
      start(target) {
        controller = target;
        const set = streams.get(path) ?? new Set();
        set.add(controller); streams.set(path, set);
        controller.enqueue(encode(initial));
        signal?.addEventListener("abort", finish, { once: true });
        if (signal?.aborted) finish();
      },
      cancel() { streams.get(path)?.delete(controller); signal?.removeEventListener("abort", finish); },
    }), { headers: { "Content-Type": "text/event-stream" } });
  }
  function botsSnapshot(includeArchived = false): BotsIndexSnapshot {
    const bots = [...botDetails.values()]
      .map(item => item.bot)
      .filter(bot => includeArchived || !bot.archivedAt)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    return {
      instanceId: "test-server",
      sequence: botSequence,
      bots,
      approvals: [...botDetails.values()].flatMap(item => item.approvals),
      defaults: { ...botsDefaults },
    };
  }
  function publishBots(botId?: string) {
    botSequence++;
    if (botId) {
      const detail = botDetails.get(botId);
      if (detail) {
        detail.sequence = botSequence;
        emit(`/api/bots/${encodeURIComponent(botId)}/events`, detail);
      }
    }
    emit("/api/bots/events", botsSnapshot(false));
    emit("/api/bots/events?includeArchived=1", botsSnapshot(true));
  }
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
    const parsedUrl = new URL(path, "http://localhost");
    const pathname = parsedUrl.pathname;
    if (pathname === "/api/bots" || pathname.startsWith("/api/bots/")) {
      if (pathname === "/api/bots" && (init.method ?? "GET") === "GET") {
        const includeArchived = parsedUrl.searchParams.get("includeArchived") === "1";
        return Response.json(botsSnapshot(includeArchived));
      }
      if (pathname === "/api/bots" && init.method === "POST") {
        const body = JSON.parse(String(init.body));
        const id = `bot_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
        const project = projects.find(p => p.projectId === body.projectId);
        const folder = demoFolders.find(f => f.id === body.projectId);
        const now = new Date().toISOString();
        const bot: BotSummaryView = {
          id,
          name: body.name,
          instructions: body.instructions ?? "",
          projectId: body.projectId,
          projectName: project?.name ?? folder?.name ?? body.projectId,
          workspaceRoot: project?.workspaceRoot ?? folder?.path,
          projectMissing: false,
          appearance: { shape: body.appearance?.shape ?? "orbit", color: body.appearance?.color ?? "blue" },
          permissionMode: body.permissionMode ?? undefined,
          maxConcurrentWorkers: body.maxConcurrentWorkers ?? undefined,
          routerModel: body.routerModel ?? undefined,
          workerModel: body.workerModel ?? undefined,
          sortOrder: botDetails.size + 1,
          memoryMode: "alphacode",
          lastVisitedAt: now,
          createdAt: now,
          updatedAt: now,
          status: "idle",
          activeTaskCount: 0,
          queuedTaskCount: 0,
          pendingApprovalCount: 0,
          readyDiffCount: 0,
          routerBusy: false,
          effectiveRouterModel: body.routerModel?.modelId
            ? { modelId: body.routerModel.modelId, baseURL: body.routerModel.baseURL ?? "http://127.0.0.1:4000/v1", apiKeyEnv: body.routerModel.apiKeyEnv ?? "OPENAI_API_KEY", noAuth: Boolean(body.routerModel.noAuth), source: "bot" }
            : botsDefaults.router,
          effectiveWorkerModel: body.workerModel?.modelId
            ? { modelId: body.workerModel.modelId, baseURL: body.workerModel.baseURL ?? "http://127.0.0.1:4000/v1", apiKeyEnv: body.workerModel.apiKeyEnv ?? "OPENAI_API_KEY", noAuth: Boolean(body.workerModel.noAuth), source: "bot" }
            : botsDefaults.worker,
        };
        botDetails.set(id, {
          instanceId: "test-server",
          sequence: ++botSequence,
          bot,
          router: { sessionId: "main", modelId: bot.effectiveRouterModel?.modelId, phase: "idle", busy: false, canSend: true, canSteer: false, pendingTriggerCount: 0, messages: [] },
          tasks: [],
          approvals: [],
        });
        publishBots(id);
        return Response.json({ bot }, { status: 201 });
      }
      if (pathname === "/api/bots/events") {
        const includeArchived = parsedUrl.searchParams.get("includeArchived") === "1";
        return openSse(path, botsSnapshot(includeArchived), init.signal);
      }
      if (pathname === "/api/bots/order" && init.method === "PATCH") {
        const { botIds } = JSON.parse(String(init.body)) as { botIds: string[] };
        botIds.forEach((id, idx) => {
          const detail = botDetails.get(id);
          if (detail) detail.bot = { ...detail.bot, sortOrder: idx + 1 };
        });
        publishBots();
        return Response.json(botsSnapshot(true));
      }
      if (pathname === "/api/bots/defaults") {
        if (init.method === "PATCH") {
          const body = JSON.parse(String(init.body));
          if (typeof body.maxConcurrentWorkers === "number") botsDefaults.maxConcurrentWorkers = body.maxConcurrentWorkers;
          if (typeof body.perBotMaxWorkers === "number") botsDefaults.perBotMaxWorkers = body.perBotMaxWorkers;
          if (body.router?.modelId) botsDefaults.router = { ...(botsDefaults.router ?? { baseURL: "http://127.0.0.1:4000/v1", apiKeyEnv: "OPENAI_API_KEY", noAuth: false }), modelId: body.router.modelId, source: "global_bots" };
          if (body.worker?.modelId) botsDefaults.worker = { ...(botsDefaults.worker ?? { baseURL: "http://127.0.0.1:4000/v1", apiKeyEnv: "OPENAI_API_KEY", noAuth: false }), modelId: body.worker.modelId, source: "global_bots" };
          publishBots();
        }
        return Response.json({ defaults: { ...botsDefaults } });
      }
      const botRoot = /^\/api\/bots\/([^/]+)$/.exec(pathname);
      if (botRoot?.[1]) {
        const botId = decodeURIComponent(botRoot[1]);
        const detail = botDetails.get(botId);
        if (!detail) return Response.json({ code: "BOT_NOT_FOUND" }, { status: 404 });
        if (init.method === "PATCH") {
          const patch = JSON.parse(String(init.body));
          const project = patch.projectId ? projects.find(p => p.projectId === patch.projectId) ?? demoFolders.find(f => f.id === patch.projectId) : undefined;
          detail.bot = {
            ...detail.bot,
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.instructions !== undefined ? { instructions: patch.instructions } : {}),
            ...(patch.projectId !== undefined ? { projectId: patch.projectId, projectName: (project && "name" in project ? project.name : undefined) ?? patch.projectId, projectMissing: false } : {}),
            ...(patch.appearance ? { appearance: { ...detail.bot.appearance, ...patch.appearance } } : {}),
            ...(patch.permissionMode !== undefined ? { permissionMode: patch.permissionMode ?? undefined } : {}),
            ...(patch.maxConcurrentWorkers !== undefined ? { maxConcurrentWorkers: patch.maxConcurrentWorkers ?? undefined } : {}),
            ...(patch.routerModel !== undefined ? { routerModel: patch.routerModel ?? undefined } : {}),
            ...(patch.workerModel !== undefined ? { workerModel: patch.workerModel ?? undefined } : {}),
            updatedAt: new Date().toISOString(),
          };
          publishBots(botId);
          return Response.json({ bot: detail.bot });
        }
        if (init.method === "DELETE") {
          const force = parsedUrl.searchParams.get("forceCleanupWorktrees") === "1";
          const unmerged = detail.tasks.filter(t => t.worktreeState === "ready_for_review" || t.worktreeState === "active");
          if (unmerged.length > 0 && !force) {
            return Response.json({ code: "UNMERGED_WORKTREES", deleted: false, cleanedWorktrees: 0, unmergedWorktreeTaskIds: unmerged.map(t => t.id) }, { status: 409 });
          }
          botDetails.delete(botId);
          publishBots();
          return Response.json({ deleted: true, cleanedWorktrees: force ? unmerged.length : 0 });
        }
        return Response.json(detail);
      }
      const botAction = /^\/api\/bots\/([^/]+)\/(state|events|messages|cancel|visit|archive)$/.exec(pathname);
      if (botAction?.[1] && botAction[2]) {
        const botId = decodeURIComponent(botAction[1]);
        const detail = botDetails.get(botId);
        if (!detail) return Response.json({ code: "BOT_NOT_FOUND" }, { status: 404 });
        if (botAction[2] === "state") return Response.json(detail);
        if (botAction[2] === "events") return openSse(path, detail, init.signal);
        if (botAction[2] === "messages") {
          const body = JSON.parse(String(init.body));
          detail.router = {
            ...detail.router,
            messages: [...detail.router.messages, { id: body.requestId, role: "user", text: body.input }],
          };
          publishBots(botId);
          return Response.json({ requestId: body.requestId, triggerId: `trg_${body.requestId}`, status: "accepted" }, { status: 202 });
        }
        if (botAction[2] === "cancel") {
          detail.router = { ...detail.router, busy: false, phase: "idle" };
          publishBots(botId);
          return Response.json({ ok: true });
        }
        if (botAction[2] === "visit") {
          detail.bot = { ...detail.bot, lastVisitedAt: new Date().toISOString(), status: detail.bot.status === "done" ? "idle" : detail.bot.status };
          publishBots(botId);
          return Response.json({ bot: detail.bot });
        }
        if (botAction[2] === "archive") {
          const body = JSON.parse(String(init.body));
          detail.bot = { ...detail.bot, archivedAt: body.archived ? new Date().toISOString() : undefined };
          publishBots(botId);
          return Response.json({ bot: detail.bot });
        }
      }
      const approvalMatch = /^\/api\/bots\/([^/]+)\/approvals\/([^/]+)$/.exec(pathname);
      if (approvalMatch?.[1] && approvalMatch[2]) {
        const botId = decodeURIComponent(approvalMatch[1]);
        const approvalId = decodeURIComponent(approvalMatch[2]);
        const detail = botDetails.get(botId);
        if (!detail) return Response.json({ code: "BOT_NOT_FOUND" }, { status: 404 });
        detail.approvals = detail.approvals.filter(item => item.approvalId !== approvalId);
        detail.bot = {
          ...detail.bot,
          pendingApprovalCount: detail.approvals.length,
          status: detail.approvals.length > 0 ? "approval" : detail.bot.activeTaskCount > 0 ? "working" : "idle",
        };
        publishBots(botId);
        return Response.json({ ok: true });
      }
      const taskMatch = /^\/api\/bots\/([^/]+)\/tasks\/([^/]+)\/(steer|cancel|diff|apply|discard|session)$/.exec(pathname);
      if (taskMatch?.[1] && taskMatch[2] && taskMatch[3]) {
        const botId = decodeURIComponent(taskMatch[1]);
        const taskId = decodeURIComponent(taskMatch[2]);
        const detail = botDetails.get(botId);
        if (!detail) return Response.json({ code: "BOT_NOT_FOUND" }, { status: 404 });
        const task = detail.tasks.find(t => t.id === taskId);
        if (!task) return Response.json({ code: "TASK_NOT_FOUND" }, { status: 404 });
        if (taskMatch[3] === "diff") {
          return Response.json(botDiffs.get(taskId) ?? {
            taskId, shortId: task.shortId, isolationMode: task.isolationMode, worktreeBranch: task.worktreeBranch,
            worktreeState: task.worktreeState, hasChanges: false, files: [], stat: "", patch: "", truncated: false,
          });
        }
        if (taskMatch[3] === "session") {
          return Response.json(botTaskSessions.get(taskId) ?? {
            taskId, shortId: task.shortId, status: task.status, live: task.status === "running", messages: [],
          });
        }
        if (taskMatch[3] === "steer") return Response.json({ ok: true });
        if (taskMatch[3] === "cancel") {
          detail.tasks = detail.tasks.map(t => t.id === taskId ? { ...t, status: "cancelled" } : t);
          publishBots(botId);
          return Response.json({ task: detail.tasks.find(t => t.id === taskId) });
        }
        if (taskMatch[3] === "apply") {
          const body = JSON.parse(String(init.body));
          detail.tasks = detail.tasks.map(t => t.id === taskId ? { ...t, worktreeState: "merged" } : t);
          detail.bot = { ...detail.bot, readyDiffCount: detail.tasks.filter(t => t.worktreeState === "ready_for_review").length };
          publishBots(botId);
          return Response.json({ applied: true, strategy: body.strategy, worktreeState: "merged", cleaned: true });
        }
        if (taskMatch[3] === "discard") {
          detail.tasks = detail.tasks.map(t => t.id === taskId ? { ...t, worktreeState: "cleaned" } : t);
          detail.bot = { ...detail.bot, readyDiffCount: detail.tasks.filter(t => t.worktreeState === "ready_for_review").length };
          publishBots(botId);
          return Response.json({ task: detail.tasks.find(t => t.id === taskId) });
        }
      }
      return Response.json({ code: "NOT_FOUND" }, { status: 404 });
    }
    if (path === "/api/projects" && init.method === "POST") {
      const body = JSON.parse(String(init.body));
      const projectId = infos.find(info => info.workspaceRoot === body.workspaceRoot)?.projectId ?? crypto.randomUUID();
      const project = { projectId, workspaceRoot: body.workspaceRoot, name: body.name };
      removedProjects.delete(projectId);
      projects.splice(0, projects.length, ...projects.filter(item => item.projectId !== projectId), project);
      return Response.json({ project }, { status: 201 });
    }
    if (path === "/api/projects") return Response.json({ projects: projects.filter(project => !removedProjects.has(project.projectId)) });
    if (path.startsWith("/api/projects/") && init.method === "DELETE") {
      removedProjects.add(decodeURIComponent(path.slice("/api/projects/".length)));
      return Response.json({ ok: true });
    }
    if (path.endsWith("/events")) {
      const id = path.slice("/api/sessions/".length, -"/events".length);
      const initial = path === "/api/events" ? { instanceId: "test-server", sequence: 1 } : views.get(id);
      if (!initial) return Response.json({ code: "SESSION_NOT_FOUND" }, { status: 404 });
      return openSse(path, initial, init.signal);
    }
    if (path === "/api/sessions" && init.method === "POST") {
      const { projectId } = JSON.parse(String(init.body));
      const template = projectId === undefined ? undefined : infos.find(item => item.projectId === projectId);
      if (projectId !== undefined && !template) throw new Error("Missing project fixture");
      const created: SessionView = template
        ? { ...view(template.id), session: { ...template, id: crypto.randomUUID(), title: "" }, state: { ...view(template.id).state, messages: [] } }
        : { instanceId: "test-server", sequence: 1, modelId: "offline-model",
          session: { id: crypto.randomUUID(), projectId: "default-project", workspaceRoot: "/home/test/.alphacode/workspace", title: "", updatedAt: "2026-11-14T01:00:00.000Z", status: "ready" },
          state: { busy: false, canSend: true, closing: false, settingsSaving: false, phase: "idle", permissionMode: "ask", status: "Ready", messages: [] } };
      infos.push(created.session); views.set(created.session.id, created);
      if (projectId === undefined && !projects.some(project => project.projectId === created.session.projectId)) projects.push({
        projectId: created.session.projectId, workspaceRoot: created.session.workspaceRoot, name: "workspace", isDefaultWorkspace: true,
      });
      return Response.json(created, { status: 201 });
    }
    const action = /^\/api\/sessions\/([^/]+)\/(requests|cancel|approval|permission|queue)$/.exec(path);
    if (action?.[1]) {
      const current = view(action[1]);
      const body = JSON.parse(String(init.body));
      if (action[2] === "queue") {
        const queue = [...(current.state.queuedRequests ?? [])];
        const index = queue.findIndex(item => item.requestId === body.requestId);
        const item = queue[index];
        if (!item) return Response.json({ code: "STALE_REQUEST" }, { status: 409 });
        if (body.action === "edit") queue[index] = { ...item, input: body.input };
        if (body.action === "move") {
          queue.splice(index, 1);
          queue.splice(body.beforeRequestId === null ? queue.length : queue.findIndex(item => item.requestId === body.beforeRequestId), 0, item);
        }
        if (body.action === "steer") queue[index] = { ...item, steering: true };
        current.state = { ...current.state, queuedRequests: queue };
        publish(current.session.id);
        return Response.json(current);
      }
      if (action[2] === "permission") {
        if (current.state.busy || current.state.settingsSaving || !current.state.canSend) return Response.json({ code: "SESSION_BUSY" }, { status: 409 });
        current.state = { ...current.state, permissionMode: body.mode };
        publish(current.session.id);
        return Response.json(current);
      }
      if (action[2] === "requests") {
        if (current.state.busy) {
          current.state = { ...current.state, queuedRequests: [...(current.state.queuedRequests ?? []), { requestId: body.requestId, input: body.input }] };
          publish(current.session.id);
          return Response.json({ requestId: body.requestId, status: "accepted" }, { status: 202 });
        }
        current.requestId = body.requestId;
        current.state = { ...current.state, busy: true, canSend: false, canQueue: true, canSteer: true, phase: "thinking",
          messages: [...current.state.messages, { id: body.requestId, role: "user", text: body.input }] };
        publish(current.session.id);
        return Response.json({ requestId: body.requestId, status: "accepted" }, { status: 202 });
      }
      if (action[2] === "cancel" && body.queuedOnly) {
        current.state = { ...current.state, queuedRequests: current.state.queuedRequests?.filter(item => item.requestId !== body.requestId) };
        publish(current.session.id);
        return Response.json({ ok: true });
      }
      current.state = { ...current.state, approval: undefined,
        ...(action[2] === "cancel" ? { busy: false, canSend: true, phase: "idle" } : {}) };
      current.approvalId = undefined;
      publish(current.session.id);
      return Response.json({ ok: true });
    }
    if (path === "/api/sessions") return Response.json({ sessions: infos.filter(info => !removedProjects.has(info.projectId)) });
    if (path.startsWith("/api/sessions/search?")) {
      const query = (new URL(path, "http://localhost").searchParams.get("q") ?? "").toLowerCase();
      const results = infos.filter(info => !removedProjects.has(info.projectId)).flatMap(session => {
        const snippets = (views.get(session.id)?.state.messages ?? []).filter(message => message.text.toLowerCase().includes(query))
          .map(message => ({ messageId: message.id, role: message.role, text: message.text }));
        return snippets.length || `${session.title}\n${session.workspaceRoot}`.toLowerCase().includes(query)
          ? [{ session, snippets: snippets.slice(0, 3), matchCount: snippets.length }] : [];
      });
      return Response.json({ results });
    }
    const id = decodeURIComponent(path.slice("/api/sessions/".length));
    const currentView = views.get(id);
    if (currentView && removedProjects.has(currentView.session.projectId)) return Response.json({ code: "SESSION_NOT_FOUND" }, { status: 404 });
    if (currentView && init.method === "PATCH") {
      currentView.session.title = JSON.parse(String(init.body)).title;
      currentView.session.titleStatus = "ready";
      publish(id);
      return Response.json({ session: currentView.session });
    }
    if (init.method === "DELETE") {
      views.delete(id);
      const index = infos.findIndex(info => info.id === id);
      if (index >= 0) infos.splice(index, 1);
      return Response.json({ ok: true });
    }
    return currentView ? Response.json(currentView) : Response.json({ code: "SESSION_NOT_FOUND" }, { status: 404 });
  });
  vi.stubGlobal("fetch", fetch);
  function view(id: string) {
    const result = views.get(id);
    if (!result) throw new Error(`Missing fixture view: ${id}`);
    return result;
  }
  return {
    fetch, infos, views, projects, overrides, info, view, emit, publish, streams,
    botDetails, botDiffs, botTaskSessions, botsDefaults, publishBots,
  };
}
