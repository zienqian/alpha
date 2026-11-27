import type { Translate } from "@/i18n/instance";
import {
  SessionApiError,
  type ChatAttachment,
  type ContextUsage,
  type HistoryMessage,
  type PermissionMode,
} from "@/features/sessions/api";

// Browser-owned projections of apps/alphacode-app-server/src/bots/contracts.ts.
// Keep this module free of server, runtime, and Bun imports.

export const botColorIds = [
  "blue",
  "emerald",
  "violet",
  "amber",
  "rose",
  "cyan",
  "indigo",
  "teal",
  "orange",
  "pink",
  "slate",
  "neutral",
] as const;
export type BotColorId = (typeof botColorIds)[number];

export const botShapeIds = [
  "orbit",
  "hex",
  "diamond",
  "cube",
  "rings",
  "spark",
  "capsule",
  "prism",
] as const;
export type BotShapeId = (typeof botShapeIds)[number];

export interface BotAppearance {
  shape: BotShapeId;
  color: BotColorId;
}

export type BotStatusKind = "approval" | "working" | "waiting" | "attention_error" | "done" | "idle";
export type BotTaskAccessMode = "readonly" | "write";
export type BotTaskIsolationMode = "shared_readonly" | "git_worktree" | "serial_lock";
export type BotWorktreeState = "none" | "active" | "ready_for_review" | "merged" | "cleaned";
export type BotTaskStatus =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface BotModelOverride {
  modelId?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  baseURL?: string;
  apiKeyEnv?: string;
  noAuth?: boolean;
}

export interface BotModelOverridePatch {
  modelId?: string | null;
  contextWindow?: number | null;
  maxOutputTokens?: number | null;
  baseURL?: string | null;
  apiKeyEnv?: string | null;
  noAuth?: boolean | null;
}

export interface BotRoleModelView {
  modelId: string;
  baseURL: string;
  apiKeyEnv: string;
  noAuth: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
  source: "bot" | "global_bots" | "inherited";
}

export interface BotsGlobalConfigView {
  maxConcurrentWorkers: number;
  perBotMaxWorkers: number;
  worktreeRoot: string;
  globalModelId?: string;
  router?: BotRoleModelView;
  worker?: BotRoleModelView;
}

export interface BotsGlobalConfigPatch {
  maxConcurrentWorkers?: number | null;
  perBotMaxWorkers?: number | null;
  worktreeRoot?: string | null;
  router?: BotModelOverridePatch | null;
  worker?: BotModelOverridePatch | null;
}

export interface BotTaskRecord {
  id: string;
  botId: string;
  shortId: string;
  title: string;
  goal: string;
  projectId: string;
  workspaceRoot: string;
  accessMode: BotTaskAccessMode;
  isolationMode: BotTaskIsolationMode;
  worktreePath?: string;
  worktreeBranch?: string;
  baseCommit?: string;
  mainRepoDirtyAtStart: boolean;
  worktreeState: BotWorktreeState;
  diffArtifactRef?: string;
  workerSessionId: string;
  workerModelId: string;
  status: BotTaskStatus;
  resultSummary?: string;
  originTriggerId?: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
}

export interface BotApprovalView {
  approvalId: string;
  botId: string;
  botName: string;
  taskId: string;
  taskShortId: string;
  taskTitle: string;
  projectId: string;
  workspaceRoot: string;
  request: {
    name: string;
    preview: { type: "command"; shell: string; cwd: string; command: string } | { type: "tool" };
  };
  createdAt: string;
}

export interface BotDiffFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
  additions: number;
  deletions: number;
}

export interface BotTaskDiffView {
  taskId: string;
  shortId: string;
  isolationMode: BotTaskIsolationMode;
  worktreePath?: string;
  worktreeBranch?: string;
  baseCommit?: string;
  worktreeState: BotWorktreeState;
  hasChanges: boolean;
  files: readonly BotDiffFile[];
  stat: string;
  patch: string;
  truncated: boolean;
  diffArtifactRef?: string;
}

export interface BotTaskApplyResult {
  applied: boolean;
  strategy: "merge" | "apply_patch";
  worktreeState: BotWorktreeState;
  cleaned: boolean;
  conflictFiles?: readonly string[];
  reason?: string;
}

export interface BotRouterStateView {
  sessionId: string;
  modelId?: string;
  phase: string;
  busy: boolean;
  canSend: boolean;
  canSteer: boolean;
  pendingTriggerCount: number;
  contextUsage?: ContextUsage;
  messages: readonly HistoryMessage[];
  error?: string;
}

export interface BotSummaryView {
  id: string;
  name: string;
  instructions: string;
  projectId: string;
  projectName: string;
  workspaceRoot?: string;
  projectMissing: boolean;
  appearance: BotAppearance;
  permissionMode?: PermissionMode;
  maxConcurrentWorkers?: number;
  routerModel?: BotModelOverride;
  workerModel?: BotModelOverride;
  sortOrder: number;
  memoryMode: "alphacode" | "off";
  lastVisitedAt?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
  status: BotStatusKind;
  statusDetail?: string;
  activeTaskCount: number;
  queuedTaskCount: number;
  pendingApprovalCount: number;
  readyDiffCount: number;
  routerBusy: boolean;
  effectiveRouterModel?: BotRoleModelView;
  effectiveWorkerModel?: BotRoleModelView;
}

export interface BotsIndexSnapshot {
  instanceId: string;
  sequence: number;
  bots: readonly BotSummaryView[];
  approvals: readonly BotApprovalView[];
  defaults: BotsGlobalConfigView;
}

export interface BotDetailStateView {
  instanceId: string;
  sequence: number;
  bot: BotSummaryView;
  router: BotRouterStateView;
  tasks: readonly BotTaskRecord[];
  approvals: readonly BotApprovalView[];
}

export interface BotMessageReceipt {
  requestId: string;
  triggerId: string;
  status: "accepted" | "duplicate";
}

export interface BotDeleteResult {
  deleted: boolean;
  cleanedWorktrees: number;
  unmergedWorktreeTaskIds?: readonly string[];
}

export interface BotWorkerSessionSnapshot {
  taskId: string;
  shortId: string;
  status: BotTaskStatus;
  live: boolean;
  messages: readonly HistoryMessage[];
}

export interface CreateBotInput {
  name: string;
  instructions?: string;
  projectId: string;
  appearance?: Partial<BotAppearance>;
  permissionMode?: PermissionMode | null;
  maxConcurrentWorkers?: number | null;
  routerModel?: BotModelOverride | null;
  workerModel?: BotModelOverride | null;
  memoryMode?: "alphacode" | "off";
}

export interface UpdateBotInput {
  name?: string;
  instructions?: string;
  projectId?: string;
  appearance?: Partial<BotAppearance>;
  permissionMode?: PermissionMode | null;
  maxConcurrentWorkers?: number | null;
  routerModel?: BotModelOverridePatch | null;
  workerModel?: BotModelOverridePatch | null;
  memoryMode?: "alphacode" | "off";
}

async function requestJson<T>(
  path: string,
  signal: AbortSignal,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
): Promise<T> {
  const response = await fetch(path, {
    method,
    signal,
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({})) as { code?: string };
    throw new SessionApiError(response.status, errorBody.code ?? `HTTP_${response.status}`);
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new SessionApiError(response.status, "API_UNAVAILABLE");
  }
  return await response.json() as T;
}

export function listBots(signal: AbortSignal, includeArchived = false): Promise<BotsIndexSnapshot> {
  const query = includeArchived ? "?includeArchived=1" : "";
  return requestJson<BotsIndexSnapshot>(`/api/bots${query}`, signal);
}

export function getBotState(botId: string, signal: AbortSignal): Promise<BotDetailStateView> {
  return requestJson<BotDetailStateView>(`/api/bots/${encodeURIComponent(botId)}`, signal);
}

export async function createBot(input: CreateBotInput): Promise<BotSummaryView> {
  const result = await requestJson<{ bot: BotSummaryView }>("/api/bots", AbortSignal.timeout(15_000), input, "POST");
  return result.bot;
}

export async function updateBot(botId: string, patch: UpdateBotInput): Promise<BotSummaryView> {
  const result = await requestJson<{ bot: BotSummaryView }>(
    `/api/bots/${encodeURIComponent(botId)}`,
    AbortSignal.timeout(15_000),
    patch,
    "PATCH",
  );
  return result.bot;
}

export function reorderBots(botIds: readonly string[]): Promise<BotsIndexSnapshot> {
  return requestJson<BotsIndexSnapshot>("/api/bots/order", AbortSignal.timeout(15_000), { botIds }, "PATCH");
}

export async function markBotVisited(botId: string): Promise<BotSummaryView> {
  const result = await requestJson<{ bot: BotSummaryView }>(
    `/api/bots/${encodeURIComponent(botId)}/visit`,
    AbortSignal.timeout(15_000),
    {},
    "POST",
  );
  return result.bot;
}

export async function setBotArchived(botId: string, archived: boolean): Promise<BotSummaryView> {
  const result = await requestJson<{ bot: BotSummaryView }>(
    `/api/bots/${encodeURIComponent(botId)}/archive`,
    AbortSignal.timeout(15_000),
    { archived },
    "POST",
  );
  return result.bot;
}

export async function deleteBot(botId: string, forceCleanupWorktrees = false): Promise<BotDeleteResult> {
  const query = forceCleanupWorktrees ? "?forceCleanupWorktrees=1" : "";
  const response = await fetch(`/api/bots/${encodeURIComponent(botId)}${query}`, {
    method: "DELETE",
    signal: AbortSignal.timeout(30_000),
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({})) as Partial<BotDeleteResult> & { code?: string };
  if (response.status === 409 && payload.code === "UNMERGED_WORKTREES") {
    return {
      deleted: false,
      cleanedWorktrees: payload.cleanedWorktrees ?? 0,
      unmergedWorktreeTaskIds: payload.unmergedWorktreeTaskIds ?? [],
    };
  }
  if (!response.ok) {
    throw new SessionApiError(response.status, payload.code ?? `HTTP_${response.status}`);
  }
  return {
    deleted: Boolean(payload.deleted),
    cleanedWorktrees: payload.cleanedWorktrees ?? 0,
    unmergedWorktreeTaskIds: payload.unmergedWorktreeTaskIds,
  };
}

export async function uploadBotFiles(botId: string, files: readonly File[], signal: AbortSignal = AbortSignal.timeout(60_000)): Promise<ChatAttachment[]> {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  const response = await fetch(`/api/bots/${encodeURIComponent(botId)}/uploads`, {
    method: "POST",
    signal,
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    headers: { Accept: "application/json" },
    body: form,
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({})) as { code?: string };
    throw new SessionApiError(response.status, errorBody.code ?? `HTTP_${response.status}`);
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new SessionApiError(response.status, "API_UNAVAILABLE");
  }
  const result = await response.json() as { attachments?: ChatAttachment[] };
  return result.attachments ?? [];
}

export function sendBotMessage(botId: string, requestId: string, input: string, attachmentIds?: readonly string[]): Promise<BotMessageReceipt> {
  return requestJson<BotMessageReceipt>(
    `/api/bots/${encodeURIComponent(botId)}/messages`,
    AbortSignal.timeout(15_000),
    attachmentIds?.length ? { requestId, input, attachmentIds } : { requestId, input },
    "POST",
  );
}

export function cancelBotRouter(botId: string): Promise<{ ok: true }> {
  return requestJson<{ ok: true }>(
    `/api/bots/${encodeURIComponent(botId)}/cancel`,
    AbortSignal.timeout(15_000),
    {},
    "POST",
  );
}

export function answerBotApproval(
  botId: string,
  approvalId: string,
  taskId: string,
  allow: boolean,
): Promise<{ ok: true }> {
  return requestJson<{ ok: true }>(
    `/api/bots/${encodeURIComponent(botId)}/approvals/${encodeURIComponent(approvalId)}`,
    AbortSignal.timeout(15_000),
    { taskId, allow },
    "POST",
  );
}

export function steerBotTask(botId: string, taskId: string, input: string): Promise<{ ok: boolean; reason?: string }> {
  return requestJson<{ ok: boolean; reason?: string }>(
    `/api/bots/${encodeURIComponent(botId)}/tasks/${encodeURIComponent(taskId)}/steer`,
    AbortSignal.timeout(15_000),
    { input },
    "POST",
  );
}

export async function cancelBotTask(botId: string, taskId: string, cleanupWorktree = false): Promise<BotTaskRecord> {
  const result = await requestJson<{ task: BotTaskRecord }>(
    `/api/bots/${encodeURIComponent(botId)}/tasks/${encodeURIComponent(taskId)}/cancel`,
    AbortSignal.timeout(15_000),
    { cleanupWorktree },
    "POST",
  );
  return result.task;
}

export function getBotTaskDiff(botId: string, taskId: string, signal: AbortSignal): Promise<BotTaskDiffView> {
  return requestJson<BotTaskDiffView>(
    `/api/bots/${encodeURIComponent(botId)}/tasks/${encodeURIComponent(taskId)}/diff`,
    signal,
  );
}

export async function applyBotTask(
  botId: string,
  taskId: string,
  options: { strategy: "merge" | "apply_patch"; cleanup?: boolean },
): Promise<BotTaskApplyResult> {
  const response = await fetch(
    `/api/bots/${encodeURIComponent(botId)}/tasks/${encodeURIComponent(taskId)}/apply`,
    {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(options),
    },
  );
  const payload = await response.json().catch(() => ({})) as Partial<BotTaskApplyResult> & { code?: string };
  if (response.status === 409 && typeof payload.applied === "boolean") {
    return payload as BotTaskApplyResult;
  }
  if (!response.ok) {
    throw new SessionApiError(response.status, payload.code ?? `HTTP_${response.status}`);
  }
  return payload as BotTaskApplyResult;
}

export async function discardBotTask(botId: string, taskId: string): Promise<BotTaskRecord> {
  const result = await requestJson<{ task: BotTaskRecord }>(
    `/api/bots/${encodeURIComponent(botId)}/tasks/${encodeURIComponent(taskId)}/discard`,
    AbortSignal.timeout(30_000),
    {},
    "POST",
  );
  return result.task;
}

export function getBotTaskSession(
  botId: string,
  taskId: string,
  signal: AbortSignal,
): Promise<BotWorkerSessionSnapshot> {
  return requestJson<BotWorkerSessionSnapshot>(
    `/api/bots/${encodeURIComponent(botId)}/tasks/${encodeURIComponent(taskId)}/session`,
    signal,
  );
}

export async function getBotsDefaults(signal: AbortSignal): Promise<BotsGlobalConfigView> {
  const result = await requestJson<{ defaults: BotsGlobalConfigView }>("/api/bots/defaults", signal);
  return result.defaults;
}

export async function updateBotsDefaults(patch: BotsGlobalConfigPatch): Promise<BotsGlobalConfigView> {
  const result = await requestJson<{ defaults: BotsGlobalConfigView }>(
    "/api/bots/defaults",
    AbortSignal.timeout(15_000),
    patch,
    "PATCH",
  );
  return result.defaults;
}

export function botErrorMessage(t: Translate, error: unknown): string {
  if (error instanceof SessionApiError) {
    if (error.code === "BOT_BUSY") return t("bots:errors.busy");
    if (error.code === "BOT_ARCHIVED") return t("bots:errors.archived");
    if (error.code === "BOT_PROJECT_UNAVAILABLE") return t("bots:errors.projectUnavailable");
    if (error.code === "BOT_NOT_FOUND" || error.code === "TASK_NOT_FOUND") return t("bots:errors.notFound");
    if (error.code === "PROJECT_NOT_FOUND") return t("bots:errors.projectNotFound");
    if (error.code === "INVALID_BOT_NAME") return t("bots:errors.invalidName");
    if (error.code === "INVALID_CONFIG") return t("bots:errors.invalidConfig");
    if (error.code === "MAIN_REPO_DIRTY") return t("bots:errors.mainRepoDirty");
    if (error.code === "MERGE_CONFLICT") return t("bots:errors.mergeConflict");
    if (error.code === "UPLOAD_TOO_LARGE" || error.code === "UPLOAD_QUOTA_EXCEEDED") return t("errors:uploadTooLarge");
    if (error.code === "TOO_MANY_ATTACHMENTS") return t("errors:tooManyAttachments");
    if (error.code === "ATTACHMENT_NOT_FOUND" || error.code === "INVALID_ATTACHMENT" || error.code === "UPLOAD_FILE_REQUIRED") return t("errors:uploadFailed");
    return t("bots:errors.generic", { code: error.code });
  }
  return t("errors:uncertain");
}
