import { ConfigurationError } from "../errors";
import type { BotRoleModelPatch, BotsGlobalSettingsPatch } from "../global-config";
import {
  botColorIds,
  botShapeIds,
  type BotAppearance,
  type BotColorId,
  type BotModelOverride,
  type BotShapeId,
  type CreateBotInput,
  type UpdateBotInput,
} from "../bots/contracts";
import type { BotManager } from "../bots/manager";
import { documentResponse } from "./document-response";
import { fail, jsonBody, requiredString } from "./security";
import {
  botUploadScope,
  botUploadUrl,
  parseAttachmentIds,
  parseUploadRequest,
  toChatAttachment,
  type UploadStore,
} from "../uploads";

function parseRolePatch(raw: unknown): BotRoleModelPatch | null {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail(400, "INVALID_CONFIG");
  const obj = raw as Record<string, unknown>;
  const allowed = new Set(["modelId", "contextWindow", "maxOutputTokens", "baseURL", "apiKeyEnv", "noAuth"]);
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) return fail(400, "INVALID_CONFIG");
  }
  const patch: BotRoleModelPatch = {};
  if (obj.modelId !== undefined) {
    if (obj.modelId === null) patch.modelId = null;
    else if (typeof obj.modelId === "string" && obj.modelId.trim() && obj.modelId.length <= 256) patch.modelId = obj.modelId.trim();
    else return fail(400, "INVALID_CONFIG");
  }
  for (const numKey of ["contextWindow", "maxOutputTokens"] as const) {
    if (obj[numKey] !== undefined) {
      const value = obj[numKey];
      if (value === null) patch[numKey] = null;
      else if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) patch[numKey] = value;
      else return fail(400, "INVALID_CONFIG");
    }
  }
  if (obj.baseURL !== undefined) {
    if (obj.baseURL === null) patch.baseURL = null;
    else if (typeof obj.baseURL === "string" && obj.baseURL.trim()) {
      const trimmed = obj.baseURL.trim();
      try { if (!["https:", "http:"].includes(new URL(trimmed).protocol)) return fail(400, "INVALID_CONFIG"); }
      catch { return fail(400, "INVALID_CONFIG"); }
      patch.baseURL = trimmed;
    } else return fail(400, "INVALID_CONFIG");
  }
  if (obj.apiKeyEnv !== undefined) {
    if (obj.apiKeyEnv === null) patch.apiKeyEnv = null;
    else if (typeof obj.apiKeyEnv === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(obj.apiKeyEnv.trim())) patch.apiKeyEnv = obj.apiKeyEnv.trim();
    else return fail(400, "INVALID_CONFIG");
  }
  if (obj.noAuth !== undefined) {
    if (obj.noAuth === null) patch.noAuth = null;
    else if (typeof obj.noAuth === "boolean") patch.noAuth = obj.noAuth;
    else return fail(400, "INVALID_CONFIG");
  }
  return patch;
}

function toModelOverride(patch: BotRoleModelPatch | null): BotModelOverride | null {
  if (patch === null) return null;
  const out: BotModelOverride = {};
  if (patch.modelId) out.modelId = patch.modelId;
  if (patch.contextWindow) out.contextWindow = patch.contextWindow;
  if (patch.maxOutputTokens) out.maxOutputTokens = patch.maxOutputTokens;
  if (patch.baseURL) out.baseURL = patch.baseURL;
  if (patch.apiKeyEnv) out.apiKeyEnv = patch.apiKeyEnv;
  if (typeof patch.noAuth === "boolean") out.noAuth = patch.noAuth;
  return Object.keys(out).length ? out : null;
}

function parseDefaultsPatch(body: Record<string, unknown>): BotsGlobalSettingsPatch {
  const allowed = new Set(["maxConcurrentWorkers", "perBotMaxWorkers", "worktreeRoot", "router", "worker"]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) return fail(400, "INVALID_CONFIG");
  }
  const patch: BotsGlobalSettingsPatch = {};
  if (body.maxConcurrentWorkers !== undefined) {
    const value = body.maxConcurrentWorkers;
    if (value === null) patch.maxConcurrentWorkers = null;
    else if (typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 12) patch.maxConcurrentWorkers = value;
    else return fail(400, "INVALID_CONFIG");
  }
  if (body.perBotMaxWorkers !== undefined) {
    const value = body.perBotMaxWorkers;
    if (value === null) patch.perBotMaxWorkers = null;
    else if (typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 4) patch.perBotMaxWorkers = value;
    else return fail(400, "INVALID_CONFIG");
  }
  if (body.worktreeRoot !== undefined) {
    const value = body.worktreeRoot;
    if (value === null) patch.worktreeRoot = null;
    else if (typeof value === "string" && value.trim() && !value.includes("\0") && value.length <= 4096) patch.worktreeRoot = value.trim();
    else return fail(400, "INVALID_CONFIG");
  }
  if (body.router !== undefined) patch.router = parseRolePatch(body.router);
  if (body.worker !== undefined) patch.worker = parseRolePatch(body.worker);
  return patch;
}

function parseAppearancePatch(raw: unknown): Partial<BotAppearance> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail(400, "INVALID_APPEARANCE");
  const obj = raw as Record<string, unknown>;
  const out: Partial<BotAppearance> = {};
  if (obj.shape !== undefined) {
    if (typeof obj.shape !== "string" || !botShapeIds.includes(obj.shape as BotShapeId)) return fail(400, "INVALID_APPEARANCE");
    out.shape = obj.shape as BotShapeId;
  }
  if (obj.color !== undefined) {
    if (typeof obj.color !== "string" || !botColorIds.includes(obj.color as BotColorId)) return fail(400, "INVALID_APPEARANCE");
    out.color = obj.color as BotColorId;
  }
  return out;
}

function parsePermissionMode(value: unknown): "ask" | "auto" | "full" | null {
  if (value === null) return null;
  if (value === "ask" || value === "auto" || value === "full") return value;
  return fail(400, "INVALID_PERMISSION_MODE");
}

function parseMemoryMode(value: unknown): "alphacode" | "off" {
  if (value === "alphacode" || value === "off") return value;
  return fail(400, "INVALID_CONFIG");
}

function parseCreateBot(body: Record<string, unknown>): CreateBotInput {
  const name = requiredString(body, "name", 120);
  const projectId = requiredString(body, "projectId", 256);
  const input: CreateBotInput = { name, projectId };
  if (body.instructions !== undefined) {
    if (typeof body.instructions !== "string" || body.instructions.length > 16000) return fail(400, "INVALID_INSTRUCTIONS");
    input.instructions = body.instructions;
  }
  if (body.appearance !== undefined) input.appearance = parseAppearancePatch(body.appearance);
  if (body.permissionMode !== undefined) input.permissionMode = parsePermissionMode(body.permissionMode);
  if (body.maxConcurrentWorkers !== undefined) {
    const value = body.maxConcurrentWorkers;
    if (value === null) input.maxConcurrentWorkers = null;
    else if (typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 4) input.maxConcurrentWorkers = value;
    else return fail(400, "INVALID_CONFIG");
  }
  if (body.routerModel !== undefined) input.routerModel = toModelOverride(parseRolePatch(body.routerModel));
  if (body.workerModel !== undefined) input.workerModel = toModelOverride(parseRolePatch(body.workerModel));
  if (body.memoryMode !== undefined) input.memoryMode = parseMemoryMode(body.memoryMode);
  return input;
}

function parseUpdateBot(body: Record<string, unknown>): UpdateBotInput {
  const allowed = new Set(["name", "instructions", "projectId", "appearance", "permissionMode", "maxConcurrentWorkers", "routerModel", "workerModel", "memoryMode"]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) return fail(400, "INVALID_BOT_UPDATE");
  }
  const patch: UpdateBotInput = {};
  if (body.name !== undefined) patch.name = requiredString(body, "name", 120);
  if (body.instructions !== undefined) {
    if (typeof body.instructions !== "string" || body.instructions.length > 16000) return fail(400, "INVALID_INSTRUCTIONS");
    patch.instructions = body.instructions;
  }
  if (body.projectId !== undefined) patch.projectId = requiredString(body, "projectId", 256);
  if (body.appearance !== undefined) patch.appearance = parseAppearancePatch(body.appearance);
  if (body.permissionMode !== undefined) patch.permissionMode = parsePermissionMode(body.permissionMode);
  if (body.maxConcurrentWorkers !== undefined) {
    const value = body.maxConcurrentWorkers;
    if (value === null) patch.maxConcurrentWorkers = null;
    else if (typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 4) patch.maxConcurrentWorkers = value;
    else return fail(400, "INVALID_CONFIG");
  }
  if (body.routerModel !== undefined) patch.routerModel = parseRolePatch(body.routerModel);
  if (body.workerModel !== undefined) patch.workerModel = parseRolePatch(body.workerModel);
  if (body.memoryMode !== undefined) patch.memoryMode = parseMemoryMode(body.memoryMode);
  return patch;
}

function createSnapshotStream<T extends { sequence: number }>(options: {
  instanceId: string;
  signal: AbortSignal;
  loadSnapshot: () => Promise<T>;
  subscribe: (notify: () => void) => () => void;
  registerStream: (close: () => void) => () => void;
}): Response {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let dirty = true;
  let flushing = false;
  let ended = false;
  let unsubscribe: () => void = () => undefined;
  let unregister: () => void = () => undefined;

  const flush = async () => {
    if (ended || flushing || !dirty) return;
    if (controller.desiredSize === null || controller.desiredSize <= 0) return;
    flushing = true;
    try {
      while (!ended && dirty && controller.desiredSize !== null && controller.desiredSize > 0) {
        dirty = false;
        const snap = await options.loadSnapshot();
        if (ended) break;
        controller.enqueue(encoder.encode(`id: ${options.instanceId}:${snap.sequence}\ndata: ${JSON.stringify(snap)}\n\n`));
      }
    } catch {
      finish();
    } finally {
      flushing = false;
    }
  };

  const notify = () => {
    if (ended) return;
    dirty = true;
    void flush();
  };

  const heartbeat = setInterval(notify, 15000);
  const finish = () => {
    if (ended) return;
    ended = true;
    clearInterval(heartbeat);
    unsubscribe();
    unregister();
    options.signal.removeEventListener("abort", finish);
    try { controller.close(); } catch { return; }
  };

  unsubscribe = options.subscribe(notify);
  unregister = options.registerStream(finish);

  const body = new ReadableStream<Uint8Array>({
    start(target) {
      controller = target;
      if (options.signal.aborted) finish();
      else {
        options.signal.addEventListener("abort", finish, { once: true });
        void flush();
      }
    },
    pull() {
      void flush();
    },
    cancel() {
      finish();
    },
  }, { highWaterMark: 1 });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

export function createBotsRoutes(options: {
  manager: BotManager;
  instanceId: string;
  uploads?: UploadStore;
  registerStream: (close: () => void) => () => void;
}) {
  return async (request: Request, url: URL): Promise<Response> => {
    const path = url.pathname;

    // Collection & global endpoints
    if (path === "/api/bots") {
      if (request.method === "GET") {
        const includeArchived = url.searchParams.get("includeArchived") === "1" || url.searchParams.get("includeArchived") === "true";
        return Response.json(await options.manager.listBots({ includeArchived }));
      }
      if (request.method === "POST") {
        const body = await jsonBody(request);
        const input = parseCreateBot(body);
        const bot = await options.manager.createBot(input);
        return Response.json({ bot }, { status: 201 });
      }
      return fail(405, "METHOD_NOT_ALLOWED");
    }

    if (path === "/api/bots/events") {
      if (request.method !== "GET") return fail(405, "METHOD_NOT_ALLOWED");
      const includeArchived = url.searchParams.get("includeArchived") === "1" || url.searchParams.get("includeArchived") === "true";
      return createSnapshotStream({
        instanceId: options.instanceId,
        signal: request.signal,
        loadSnapshot: () => options.manager.listBots({ includeArchived }),
        subscribe: notify => options.manager.subscribeIndex(notify),
        registerStream: options.registerStream,
      });
    }

    if (path === "/api/bots/order") {
      if (request.method !== "PATCH") return fail(405, "METHOD_NOT_ALLOWED");
      const body = await jsonBody(request);
      if (!Array.isArray(body.botIds) || body.botIds.some(id => typeof id !== "string" || !id.trim())) {
        return fail(400, "INVALID_BOT_ORDER");
      }
      return Response.json(await options.manager.reorderBots(body.botIds as string[]));
    }

    if (path === "/api/bots/defaults") {
      if (request.method === "GET") {
        return Response.json({ defaults: await options.manager.getDefaults() });
      }
      if (request.method === "PATCH") {
        const body = await jsonBody(request);
        const patch = parseDefaultsPatch(body);
        try {
          return Response.json({ defaults: await options.manager.updateDefaults(patch) });
        } catch (error) {
          if (error instanceof ConfigurationError) return fail(400, error.code ?? "INVALID_CONFIG");
          throw error;
        }
      }
      return fail(405, "METHOD_NOT_ALLOWED");
    }

    // Single bot root: /api/bots/:botId
    const botRoot = /^\/api\/bots\/([^/]+)$/.exec(path);
    if (botRoot?.[1]) {
      const botId = decodeURIComponent(botRoot[1]);
      if (request.method === "GET") {
        return Response.json(await options.manager.getBotState(botId));
      }
      if (request.method === "PATCH") {
        const body = await jsonBody(request);
        const patch = parseUpdateBot(body);
        const bot = await options.manager.updateBot(botId, patch);
        return Response.json({ bot });
      }
      if (request.method === "DELETE") {
        const forceCleanup = url.searchParams.get("forceCleanupWorktrees") === "1" || url.searchParams.get("forceCleanupWorktrees") === "true";
        const result = await options.manager.deleteBot(botId, { forceCleanupWorktrees: forceCleanup });
        if (!result.deleted) {
          return Response.json({ code: "UNMERGED_WORKTREES", ...result }, { status: 409 });
        }
        return Response.json(result);
      }
      return fail(405, "METHOD_NOT_ALLOWED");
    }

    // Bot uploads: /api/bots/:botId/uploads[/:uploadId]
    const uploadMatch = /^\/api\/bots\/([^/]+)\/uploads(?:\/([^/]+))?$/.exec(path);
    if (uploadMatch?.[1]) {
      const botId = decodeURIComponent(uploadMatch[1]);
      const uploadId = uploadMatch[2] ? decodeURIComponent(uploadMatch[2]) : undefined;
      if (!options.manager.hasBot(botId)) return fail(404, "BOT_NOT_FOUND");
      if (!options.uploads) return fail(503, "UPLOADS_UNAVAILABLE");
      if (!uploadId) {
        if (request.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED");
        const files = await parseUploadRequest(request);
        const stored = [];
        for (const file of files) {
          stored.push(await options.uploads.save(botUploadScope(botId), file));
        }
        return Response.json({
          attachments: stored.map(item => toChatAttachment(item, botUploadUrl(botId, item.id))),
        }, { status: 201 });
      }
      if (request.method === "GET") {
        const found = await options.uploads.readBytes(botUploadScope(botId), uploadId);
        if (!found) return fail(404, "ATTACHMENT_NOT_FOUND");
        return documentResponse({
          path: found.upload.name,
          name: found.upload.name,
          size: found.upload.size,
          mediaType: found.upload.mediaType,
          body: new Blob([found.bytes]),
          createdAt: found.upload.createdAt,
        }, url);
      }
      if (request.method === "DELETE") {
        await options.uploads.remove(botUploadScope(botId), uploadId);
        return Response.json({ ok: true });
      }
      return fail(405, "METHOD_NOT_ALLOWED");
    }

    // Single bot sub-actions: /api/bots/:botId/(state|events|messages|cancel|visit|archive)
    const botAction = /^\/api\/bots\/([^/]+)\/(state|events|messages|cancel|visit|archive)$/.exec(path);
    if (botAction?.[1] && botAction[2]) {
      const botId = decodeURIComponent(botAction[1]);
      const action = botAction[2];
      if (action === "state") {
        if (request.method !== "GET") return fail(405, "METHOD_NOT_ALLOWED");
        return Response.json(await options.manager.getBotState(botId));
      }
      if (action === "events") {
        if (request.method !== "GET") return fail(405, "METHOD_NOT_ALLOWED");
        // Verify bot exists before opening stream so 404 is returned cleanly.
        await options.manager.getBotState(botId);
        return createSnapshotStream({
          instanceId: options.instanceId,
          signal: request.signal,
          loadSnapshot: () => options.manager.getBotState(botId),
          subscribe: notify => options.manager.subscribeBot(botId, notify),
          registerStream: options.registerStream,
        });
      }
      if (request.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED");
      if (action === "messages") {
        const body = await jsonBody(request);
        const requestId = requiredString(body, "requestId", 100);
        const attachmentIds = parseAttachmentIds(body.attachmentIds);
        const rawInput = body.input === undefined ? "" : body.input;
        if (typeof rawInput !== "string" || rawInput.length > 100000 || (!rawInput.trim() && attachmentIds.length === 0)) {
          return fail(400, "INVALID_INPUT");
        }
        const receipt = await options.manager.sendMessage(botId, requestId, rawInput, attachmentIds.length ? attachmentIds : undefined);
        return Response.json(receipt, { status: 202 });
      }
      if (action === "cancel") {
        options.manager.cancelRouter(botId);
        return Response.json({ ok: true });
      }
      if (action === "visit") {
        const bot = await options.manager.markVisited(botId);
        return Response.json({ bot });
      }
      if (action === "archive") {
        const body = await jsonBody(request);
        if (typeof body.archived !== "boolean") return fail(400, "INVALID_ARCHIVED");
        const bot = await options.manager.setArchived(botId, body.archived);
        return Response.json({ bot });
      }
    }

    // Approvals: /api/bots/:botId/approvals/:approvalId
    const approvalMatch = /^\/api\/bots\/([^/]+)\/approvals\/([^/]+)$/.exec(path);
    if (approvalMatch?.[1] && approvalMatch[2]) {
      if (request.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED");
      const botId = decodeURIComponent(approvalMatch[1]);
      const approvalId = decodeURIComponent(approvalMatch[2]);
      const body = await jsonBody(request);
      const taskId = requiredString(body, "taskId", 128);
      if (typeof body.allow !== "boolean") return fail(400, "INVALID_ALLOW");
      options.manager.answerApproval(botId, approvalId, taskId, body.allow);
      return Response.json({ ok: true });
    }

    // Tasks: /api/bots/:botId/tasks/:taskId/(steer|cancel|diff|apply|discard|session)
    const taskMatch = /^\/api\/bots\/([^/]+)\/tasks\/([^/]+)\/(steer|cancel|diff|apply|discard|session)$/.exec(path);
    if (taskMatch?.[1] && taskMatch[2] && taskMatch[3]) {
      const botId = decodeURIComponent(taskMatch[1]);
      const taskId = decodeURIComponent(taskMatch[2]);
      const action = taskMatch[3];
      if (action === "diff") {
        if (request.method !== "GET") return fail(405, "METHOD_NOT_ALLOWED");
        return Response.json(await options.manager.getTaskDiff(botId, taskId));
      }
      if (action === "session") {
        if (request.method !== "GET") return fail(405, "METHOD_NOT_ALLOWED");
        return Response.json(await options.manager.getTaskSession(botId, taskId));
      }
      if (request.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED");
      const body = await jsonBody(request);
      if (action === "steer") {
        const input = requiredString(body, "input", 20000);
        const result = await options.manager.steerTask(botId, taskId, input);
        if (!result.ok) {
          const status = result.reason === "TASK_NOT_FOUND" ? 404 : 409;
          return fail(status, result.reason ?? "STEER_FAILED");
        }
        return Response.json(result);
      }
      if (action === "cancel") {
        const cleanup = body.cleanupWorktree === true;
        const task = await options.manager.cancelTask(botId, taskId, cleanup);
        return Response.json({ task });
      }
      if (action === "apply") {
        const strategy = body.strategy;
        if (strategy !== "merge" && strategy !== "apply_patch") return fail(400, "INVALID_STRATEGY");
        const cleanup = body.cleanup === undefined ? true : Boolean(body.cleanup);
        const result = await options.manager.applyTask(botId, taskId, { strategy, cleanup });
        return Response.json(result, { status: result.applied ? 200 : 409 });
      }
      if (action === "discard") {
        const task = await options.manager.discardTask(botId, taskId);
        return Response.json({ task });
      }
    }

    return fail(404, "NOT_FOUND");
  };
}
