/** Browser-safe telemetry DTOs. No dependency on ADK, Bun, or a storage runtime. */
export interface TraceScope {
  namespace: string;
  sessionId?: string;
}
export type TraceRunStatus =
  | "running"
  | "completed"
  | "refused"
  | "incomplete"
  | "unknown"
  | "limited"
  | "cancelled"
  | "failed";
export type TraceSpanStatus =
  | "running"
  | "ok"
  | "error"
  | "cancelled"
  | "denied"
  | "unknown";
export interface TraceSummary extends TraceScope {
  schemaVersion: 1;
  traceId: string;
  rootSpanId: string;
  agentId: string;
  runId: string;
  requestId?: string;
  startedAtMs: number;
  lastOffsetMs: number;
  durationMs: number | null;
  runStatus: TraceRunStatus;
  captureStatus: "complete" | "partial" | "interrupted";
  sessionPersistence: "not_applicable" | "unknown" | "saved" | "unsaved";
  revision: number;
  droppedEvents: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalModelCalls: number;
  meteredModelCalls: number;
}
export interface TraceSpan {
  spanId: string;
  parentSpanId: string | null;
  kind: "run" | "model" | "tool" | "approval";
  name: string;
  seq: number;
  startOffsetMs: number | null;
  endOffsetMs: number | null;
  durationMs: number | null;
  observedOffsetMs: number;
  timingQuality: "source" | "observed" | "unavailable";
  status: TraceSpanStatus;
  execution?:
    | "succeeded"
    | "failed"
    | "denied"
    | "not_executed"
    | "outcome_unknown";
  businessStatus?: "ok" | "error" | "unknown";
  errorCode?: string;
  modelCallId?: string;
  assistantId?: string;
  callId?: string;
  messageId?: string;
  provider?: string;
  modelId?: string;
  effect?: "read" | "write" | "unknown";
  inputTokens?: number;
  outputTokens?: number;
  firstTextMs?: number;
  missingStart?: boolean;
  incomplete?: boolean;
  links: { spanId: string; relation: "caused_by" | "related" }[];
}
export interface TraceMessageRef {
  messageId: string;
  role: "user" | "assistant" | "toolResult" | "custom";
  seq: number;
  offsetMs: number;
}
export interface TraceSnapshot {
  summary: TraceSummary;
  spans: TraceSpan[];
  messages: TraceMessageRef[];
}
export interface TracePage {
  items: TraceSummary[];
  cursor?: string;
}
export interface TraceListOptions {
  limit?: number;
  cursor?: string;
}
export interface TraceHealth {
  persistence: "memory" | "ready" | "degraded" | "closed";
  droppedEvents: number;
  code?: string;
}
export interface TraceChange {
  traceId?: string;
  scope?: TraceScope;
  revision?: number;
  health: TraceHealth;
}
export interface TraceLaneSegment {
  startMs: number;
  durationMs: number;
  kind: "tool" | "think" | "report" | "error";
}
export interface TraceLanes {
  model: TraceLaneSegment[];
  tool: TraceLaneSegment[];
  totalMs: number;
  modelMs: number;
  toolMs: number;
}
export interface TraceViewStep {
  stepId: string;
  seq: number;
  spanId?: string;
  kind: "call" | "text" | "model" | "error";
  label: string;
  summary: string;
  offsetMs: number;
  durationMs: number | null;
  status: TraceSpanStatus;
  shape: "command" | "write" | "read" | "search" | "other";
  content?: string;
  detailState: "available" | "not_captured" | "missing" | "truncated";
}
export interface TraceView {
  summary: TraceSummary;
  health: TraceHealth;
  agentName: string;
  provider?: string;
  modelId?: string;
  workspace?: string;
  triggerSummary?: string;
  lanes: TraceLanes | null;
  steps: TraceViewStep[];
  searchScope: "input_and_output_preview";
  outcome?: { files: number; added: number; removed: number; commands: number };
}
export interface TraceStepDetail {
  stepId: string;
  state: "available" | "not_captured" | "missing" | "truncated";
  input?: Record<string, unknown>;
  output?: string;
  content?: string;
}
export interface TraceStore {
  readonly durability: "memory" | "transactional";
  write(snapshots: readonly TraceSnapshot[]): Promise<void>;
  read(scope: TraceScope, traceId: string): Promise<TraceSnapshot | undefined>;
  findByReply(
    scope: TraceScope,
    replyId: string,
  ): Promise<TraceSummary | undefined>;
  list(scope: TraceScope, options?: TraceListOptions): Promise<TracePage>;
  deleteSession(scope: TraceScope): Promise<void>;
  close(): Promise<void>;
}
