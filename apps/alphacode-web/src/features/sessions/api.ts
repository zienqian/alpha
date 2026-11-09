import type { Translate } from "@/i18n/instance";
import type { Notice, LocalResult } from "@/i18n/presentation";

// Browser-owned projections of server/protocol.ts and chat/contracts.ts.
// Keep this module free of CLI, runtime and Bun imports.
export interface SessionInfo {
  id: string;
  projectId: string;
  workspaceRoot: string;
  title: string;
  updatedAt: string;
  status: string;
}

export interface ToolRecord {
  name: string;
  description: string;
  descriptionSource?: "model" | "fallback";
  target?: string;
  summaryCode?: string;
  outputLines?: string[];
  errorCode?: string;
  status: string;
  command?: string;
  cwd?: string;
  path?: string;
  output?: string;
  error?: string;
  exitCode?: number;
  omittedLines?: number;
  truncated?: boolean;
  outputIncomplete?: boolean;
}

export interface HistoryMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  text: string;
  note?: string;
  noteCode?: string;
  localResult?: LocalResult;
  streaming?: boolean;
  tool?: ToolRecord;
  completion?: { durationMs: number; completedAt: number; status: string };
}

export interface SessionView {
  instanceId: string;
  sequence: number;
  session: SessionInfo;
  modelId: string;
  requestId?: string;
  approvalId?: string;
  state: {
    messages: readonly HistoryMessage[];
    busy: boolean;
    status: string;
    canSend: boolean;
    closing: boolean;
    settingsSaving: boolean;
    phase: string;
    permissionMode: "ask" | "auto" | "full";
    approval?: {
      name: string;
      preview: { type: "command"; shell: string; cwd: string; command: string } | { type: "tool" };
    };
    error?: string;
    notice?: Notice;
    lastRunStatus?: string;
  };
}

export class SessionApiError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

async function requestJson<T>(path: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    signal, credentials: "omit", redirect: "error", cache: "no-store",
    headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { code?: string };
    throw new SessionApiError(response.status, body.code ?? `HTTP_${response.status}`);
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new SessionApiError(response.status, "API_UNAVAILABLE");
  }
  return await response.json() as T;
}

export async function listSessions(signal: AbortSignal) {
  const result = await requestJson<{ sessions: SessionInfo[] }>("/api/sessions", signal);
  return result.sessions;
}

export function getSession(id: string, signal: AbortSignal) {
  return requestJson<SessionView>(sessionPath(id), signal);
}

export interface SessionSearchResult {
  session: SessionInfo;
  snippets: { messageId: string; role: HistoryMessage["role"]; text: string }[];
  matchCount: number;
}

export async function searchSessions(query: string, signal: AbortSignal) {
  const result = await requestJson<{ results: SessionSearchResult[] }>(`/api/sessions/search?q=${encodeURIComponent(query)}`, signal);
  return result.results;
}

export const sessionPath = (id: string) => `/api/sessions/${encodeURIComponent(id)}`;
export interface RequestReceipt { requestId: string; status: "accepted" | "settled" | "interrupted" }
export const createSession = (projectId: string) =>
  requestJson<SessionView>("/api/sessions", AbortSignal.timeout(15_000), { projectId });
export const sendRequest = (id: string, requestId: string, input: string) =>
  requestJson<RequestReceipt>(`${sessionPath(id)}/requests`, AbortSignal.timeout(15_000), { requestId, input });
export const cancelRequest = (id: string, requestId: string) =>
  requestJson(`${sessionPath(id)}/cancel`, AbortSignal.timeout(15_000), { requestId });
export const answerApproval = (id: string, requestId: string, approvalId: string, allow: boolean) =>
  requestJson(`${sessionPath(id)}/approval`, AbortSignal.timeout(15_000), { requestId, approvalId, allow });

export function actionErrorMessage(t: Translate, error: unknown) {
  if (error instanceof SessionApiError) {
    if (error.code === "SESSION_BUSY") return t("errors:busy");
    if (error.code === "STALE_APPROVAL" || error.code === "STALE_REQUEST") return t("errors:stale");
    if (error.status === 403) return t("errors:access");
    if (error.status === 413 || error.code === "INVALID_INPUT") return t("errors:input");
    if (error.code === "SESSION_NOT_FOUND" || error.code === "PROJECT_NOT_FOUND") return t("errors:missing");
    if (error.status < 500) return t("errors:operation", { code: error.code });
  }
  return t("errors:uncertain");
}

export function sessionErrorMessage(t: Translate, error: Error | null, resource: "list" | "history") {
  if (error instanceof SessionApiError && error.code === "SESSION_NOT_FOUND") return t("errors:sessionNotFound");
  if (error instanceof SessionApiError && error.status === 403) return t("errors:access");
  return resource === "list"
    ? t("errors:list")
    : t("errors:history");
}
