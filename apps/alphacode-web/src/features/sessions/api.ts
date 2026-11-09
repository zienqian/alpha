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

export function actionErrorMessage(error: unknown) {
  if (error instanceof SessionApiError) {
    if (error.code === "SESSION_BUSY") return "会话正在处理其他操作，请稍后重试。";
    if (error.code === "STALE_APPROVAL" || error.code === "STALE_REQUEST") return "操作已过期或已在另一端处理，正在刷新会话。";
    if (error.status === 403) return "无法访问本地服务，请从 CLI 重新运行 /web。";
    if (error.status === 413 || error.code === "INVALID_INPUT") return "消息过长或为空，请修改后再发送。";
    if (error.code === "SESSION_NOT_FOUND" || error.code === "PROJECT_NOT_FOUND") return "会话或项目不存在，请刷新列表。";
    if (error.status < 500) return `操作失败（${error.code}），请刷新后重试。`;
  }
  return "未能确认操作结果，请检查连接后重试。";
}

export function sessionErrorMessage(error: Error | null, resource: "list" | "history") {
  if (error instanceof SessionApiError && error.code === "SESSION_NOT_FOUND") return "这个会话不存在或已被删除。";
  if (error instanceof SessionApiError && error.status === 403) return "无法访问本地服务，请从 CLI 重新运行 /web。";
  return resource === "list"
    ? "无法加载会话列表，请确认本地服务仍在运行，或从 CLI 重新运行 /web。"
    : "无法加载会话历史，请重试；如果本地服务已重启，请从 CLI 重新运行 /web。";
}
