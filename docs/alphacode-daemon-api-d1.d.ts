export type ApiVersion = "v1";
export type EventCursor = `${string}:${number}`;
export type PermissionMode = "ask" | "auto" | "full";
export type RunOutcome = "completed" | "refused" | "incomplete" | "unknown" | "limited" | "cancelled" | "failed";
export type ExecutionState = "accepted" | "running" | "awaiting_approval" | "completed" | "cancelled" | "failed" | "interrupted";
export type SessionEligibility = "ready" | "busy" | "unsaved" | "recovery_required";
export type PersistenceState =
  | { status: "pending" }
  | { status: "saved"; revision: number }
  | { status: "unsaved"; code: "STORE_UNAVAILABLE" | "COMMIT_CONFLICT" }
  | { status: "recovery_required" };

export interface SessionRef { workspaceId: string; sessionId: string }
export interface DaemonInfo {
  instanceId: string;
  apiVersion: ApiVersion;
  state: "running" | "draining" | "stop_failed";
  startedAt: string;
  capabilities: readonly ("sessions" | "requests" | "approvals" | "sse-replay" | "persistence-flush")[];
}
export interface Workspace { id: string; root: string; label: string }
export interface PutWorkspaceInput { root: string }
export interface PutSessionInput { title: string }
export interface CreateRequestInput { requestId: string; input: string }
export interface RequestSnapshot {
  requestId: string;
  runId?: string;
  execution: ExecutionState;
  outcome?: RunOutcome;
  persistence: PersistenceState;
  acceptedAt: string;
  finishedAt?: string;
}
export interface RequestReceipt { request: RequestSnapshot; replayed: boolean }
export interface CancelReceipt {
  requestId: string;
  cancellation: "requested" | "already_requested" | "already_settled";
}
export interface Approval {
  approvalId: string;
  requestId: string;
  runId: string;
  toolCallId: string;
  status: "pending" | "resolved" | "expired";
  decision?: "allow" | "deny";
  preview: { type: "command"; shell: string; cwd: string; command: string } | { type: "tool"; name: string; description: string };
  createdAt: string;
  expiresAt: string;
}
export interface ApprovalDecisionInput { requestId: string; runId: string; decision: "allow" | "deny" }
export interface ApprovalReceipt { approval: Approval; replayed: boolean }
export interface WireMessage {
  id: string;
  requestId: string;
  role: "user" | "assistant";
  text: string;
  streaming: boolean;
}
export interface WireTool {
  id: string;
  requestId: string;
  name: string;
  command?: string;
  status: "awaiting_approval" | "running" | "succeeded" | "denied" | "not_executed" | "outcome_unknown";
  output?: string;
}
export interface Page<Result> { items: readonly Result[]; nextCursor: string | null }
export interface SessionSummary extends SessionRef {
  title: string;
  revision: number;
  eligibility: SessionEligibility;
}
export interface SessionSnapshot extends SessionSummary {
  cursor: EventCursor;
  permissionMode: PermissionMode;
  request: RequestSnapshot | null;
  messages: Page<WireMessage>;
  tools: readonly WireTool[];
  approvals: readonly Approval[];
}
export interface ChangeSettingsInput { expectedRevision: number; permissionMode: PermissionMode }
export interface SettingsReceipt { revision: number; permissionMode: PermissionMode }
export interface FlushReceipt { requestId: string; persistence: { status: "saved"; revision: number } }
export interface ExchangeLaunchCodeInput { launchCode: string }
export interface BrowserSession { csrfToken: string; expiresAt: string; target: SessionRef }
export interface StopDaemonInput { expectedInstanceId: string }
export interface StopDaemonReceipt { instanceId: string; state: "draining" }
export type ApiErrorCode =
  | "INVALID_REQUEST" | "UNAUTHENTICATED" | "ORIGIN_FORBIDDEN" | "FORBIDDEN"
  | "NOT_FOUND" | "SESSION_BUSY" | "REQUEST_MISMATCH" | "RESOURCE_MISMATCH"
  | "REVISION_CONFLICT" | "APPROVAL_CONFLICT" | "APPROVAL_EXPIRED"
  | "SESSION_UNSAVED" | "RECOVERY_REQUIRED" | "CURSOR_INVALID"
  | "DAEMON_DRAINING" | "INSTANCE_MISMATCH" | "RATE_LIMITED" | "STORE_UNAVAILABLE";
export interface ApiError {
  error: { code: ApiErrorCode; message: string; traceId: string; retryable: boolean };
}
export interface EventPayloads {
  "state.snapshot": SessionSnapshot;
  "stream.reset": { reason: "cursor_expired" | "instance_changed" | "cursor_ahead"; snapshot: SessionSnapshot };
  "request.accepted": { request: RequestSnapshot; message: WireMessage };
  "request.started": { request: RequestSnapshot };
  "message.started": { message: WireMessage };
  "message.delta": { messageId: string; text: string };
  "message.committed": { message: WireMessage };
  "approval.requested": { approval: Approval; request: RequestSnapshot; tool: WireTool };
  "approval.resolved": { approval: Approval; request: RequestSnapshot; tool: WireTool };
  "tool.updated": { tool: WireTool };
  "request.finished": { request: RequestSnapshot };
  "session.saved": { requestId: string; revision: number };
  "session.unsaved": { requestId: string; code: "STORE_UNAVAILABLE" | "COMMIT_CONFLICT" };
  "session.settings_changed": SettingsReceipt;
}
export type DaemonEvent = {
  [EventType in keyof EventPayloads]: SessionRef & {
    apiVersion: ApiVersion;
    instanceId: string;
    sequence: number;
    cursor: EventCursor;
    timestamp: string;
    type: EventType;
    payload: EventPayloads[EventType];
  }
}[keyof EventPayloads];

export interface DaemonApi {
  exchangeLaunchCode(input: ExchangeLaunchCodeInput): Promise<BrowserSession>;
  getDaemon(): Promise<DaemonInfo>;
  stopDaemon(input: StopDaemonInput): Promise<StopDaemonReceipt>;
  listWorkspaces(): Promise<Page<Workspace>>;
  putWorkspace(workspaceId: string, input: PutWorkspaceInput): Promise<Workspace>;
  listSessions(workspaceId: string, cursor?: string): Promise<Page<SessionSummary>>;
  putSession(ref: SessionRef, input: PutSessionInput): Promise<SessionSnapshot>;
  getSession(ref: SessionRef): Promise<SessionSnapshot>;
  listMessages(ref: SessionRef, before?: string): Promise<Page<WireMessage>>;
  createRequest(ref: SessionRef, input: CreateRequestInput): Promise<RequestReceipt>;
  getRequest(ref: SessionRef, requestId: string): Promise<RequestSnapshot>;
  cancelRequest(ref: SessionRef, requestId: string): Promise<CancelReceipt>;
  decideApproval(ref: SessionRef, approvalId: string, input: ApprovalDecisionInput): Promise<ApprovalReceipt>;
  changeSettings(ref: SessionRef, input: ChangeSettingsInput): Promise<SettingsReceipt>;
  flushPersistence(ref: SessionRef): Promise<FlushReceipt>;
  subscribe(ref: SessionRef, options: { after?: EventCursor; signal: AbortSignal }): AsyncIterable<DaemonEvent>;
}
