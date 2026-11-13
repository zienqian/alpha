export type ChatRunStatus = "completed" | "refused" | "incomplete" | "unknown" | "limited" | "cancelled" | "failed";
export type PermissionMode = "ask" | "auto" | "full";
export type ChatPhase = "idle" | "thinking" | "queued" | "running" | "saving" | "stopping";
export type ToolStatus = "queued" | "running" | "awaiting_approval" | "succeeded" | "failed" | "denied" | "not_executed" | "outcome_unknown";

export interface ContextUsage {
  modelId: string;
  contextWindow?: number;
  windowSource: "model" | "codex" | "configuration" | "unknown";
  /** Estimated tokens in the latest model request; excludes draft and its reply. */
  tokens?: { system: number; tools: number; summary?: number; messages: number; total: number };
  inputBudget?: number;
  maxOutputTokens?: number;
  automatic?: boolean;
  compaction?: { status: 'start' | 'end' | 'skip' | 'failed'; reason?: string; before?: number; after?: number };
}

// Optional presentation semantics preserve protocol v2's legacy text fields.
export interface ChatNotice { code: string; params?: Record<string, string | number> }
export interface LocalResult {
  kind: "skills" | "permission" | "compact";
  skills?: readonly { name: string; description: string; argumentHint?: string; userInvocable: boolean; disableModelInvocation?: boolean }[];
  diagnostics?: readonly { severity: string; code: string; path: string; field?: string }[];
}

export interface ToolRecord {
  id: string;
  assistantId: string;
  callId: string;
  name: string;
  description: string;
  descriptionSource: "model" | "fallback";
  command?: string;
  cwd?: string;
  path?: string;
  target: string;
  status: ToolStatus;
  output?: string;
  outputLines?: string[];
  summaryCode?: "FILE_UPDATED" | "FILE_CREATED";
  errorCode?: string;
  error?: string;
  exitCode?: number;
  omittedLines?: number;
  truncated?: boolean;
  outputIncomplete?: boolean;
  startedAt?: number;
  finishedAt?: number;
}

export interface ChatMessage {
  rawText?: string;
  id: string;
  role: "user" | "assistant" | "tool";
  text: string;
  streaming?: boolean;
  note?: string;
  noteCode?: string;
  localResult?: LocalResult;
  tool?: ToolRecord;
  completion?: { durationMs: number; completedAt: number; status: ChatRunStatus };
}

export interface ApprovalRequest {
  name: string;
  assistantId?: string;
  callId?: string;
  preview: { type: "command"; shell: string; cwd: string; command: string } | { type: "tool" };
}

export type RequestApproval = (action: ApprovalRequest, signal: AbortSignal) => Promise<boolean>;

export interface ChatState {
  contextUsage?: ContextUsage;
  sessionTitle: string;
  titleStatus?: "pending" | "ready";
  messages: readonly ChatMessage[];
  busy: boolean;
  closing: boolean;
  canSend: boolean;
  /** The server can accept another message while this turn is running. */
  canQueue?: boolean;
  queuedRequests?: readonly { requestId: string; input: string; steering?: boolean }[];
  canSteer?: boolean;
  status: string;
  phase: ChatPhase;
  lastRunStatus?: ChatRunStatus;
  connection?: "connected" | "reconnecting";
  notice?: ChatNotice;
  /** Monotonic time for the active turn's elapsed indicator. */
  activeRunStartedAt?: number;
  permissionMode: PermissionMode;
  settingsSaving: boolean;
  error?: string;
  approval?: ApprovalRequest;
}

export interface Chat {
  readonly canSteer?: boolean;
  steer?(input: string): Promise<boolean>;
  readonly skills?: readonly ChatSkill[];
  readonly state: ChatState;
  readonly modelId: string;
  readonly workspaceRoot: string;
  readonly sessionId: string;
  subscribe(listener: (state: ChatState) => void): () => void;
  send(input: string, requestId?: string): Promise<void>;
  cancel(): void;
  answerApproval(allow: boolean): void;
  setPermissionMode(mode: PermissionMode): Promise<boolean>;
  setTitle?(title: string): Promise<void>;
  close(): Promise<void>;
}

// The application consumes conversation events, not Agent or Session internals.
export type ChatEvent =
  | { type: "context.usage"; usage: ContextUsage }
  | { type: "user.message"; id: string; text: string }
  | { type: "session.title"; title: string; status: "pending" | "ready" }
  | { type: "assistant.start"; id: string }
  | { type: "assistant.delta"; id: string; text: string }
  | { type: "assistant.commit"; id: string; text: string; tools?: readonly ToolRecord[] }
  | { type: "assistant.end"; id: string; outcome: ChatRunStatus | "tool_calls" | "steered" }
  | { type: "tool.start"; tool: ToolRecord }
  | { type: "tool.end"; tool: ToolRecord }
  | { type: "run.end"; status: ChatRunStatus };

export interface ChatRuntime {
  readonly contextUsage?: ContextUsage;
  readonly canSteer?: boolean;
  steer?(input: string): Promise<boolean>;
  readonly sessionTitle: string;
  readonly skills?: readonly ChatSkill[];
  readonly modelId: string;
  readonly workspaceRoot: string;
  readonly sessionId: string;
  readonly permissionMode: PermissionMode;
  readonly messages: readonly ChatMessage[];
  readonly unsaved: boolean;
  readonly blocked: boolean;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  setTitle?(title: string): Promise<void>;
  subscribe(listener: (event: ChatEvent) => void): () => void;
  send(input: string, requestId?: string): Promise<{ status: ChatRunStatus; error?: string; localText?: string; localResult?: LocalResult; completion?: ChatMessage["completion"] }>;
  cancel(): void;
  /** Drain execution and persist before resolving; a failed close may be retried. */
  close(): Promise<void>;
}

export interface ChatSkill {
  readonly name: string;
  readonly description: string;
  readonly argumentHint?: string;
  readonly userInvocable: boolean;
}
