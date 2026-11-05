export type ChatRunStatus = "completed" | "refused" | "incomplete" | "unknown" | "limited" | "cancelled" | "failed";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  text: string;
  streaming?: boolean;
  note?: string;
}

export interface ApprovalRequest {
  name: string;
  preview: { type: "command"; shell: string; cwd: string; command: string } | { type: "tool" };
}

export type RequestApproval = (action: ApprovalRequest, signal: AbortSignal) => Promise<boolean>;

export interface ChatState {
  messages: readonly ChatMessage[];
  busy: boolean;
  closing: boolean;
  canSend: boolean;
  status: string;
  error?: string;
  approval?: ApprovalRequest;
}

export interface Chat {
  readonly state: ChatState;
  readonly modelId: string;
  readonly workspaceRoot: string;
  readonly sessionId: string;
  subscribe(listener: (state: ChatState) => void): () => void;
  send(input: string): Promise<void>;
  cancel(): void;
  answerApproval(allow: boolean): void;
  close(): Promise<void>;
}

// The application consumes conversation events, not Agent or Session internals.
export type ChatEvent =
  | { type: "assistant.start"; id: string }
  | { type: "assistant.delta"; id: string; text: string }
  | { type: "assistant.commit"; id: string; text: string }
  | { type: "assistant.end"; id: string; outcome: ChatRunStatus | "tool_calls" }
  | { type: "tool.start"; id: string; name: string }
  | { type: "tool.end"; id: string; name: string; execution: string }
  | { type: "run.end" };

export interface ChatRuntime {
  readonly modelId: string;
  readonly workspaceRoot: string;
  readonly sessionId: string;
  readonly unsaved: boolean;
  readonly blocked: boolean;
  subscribe(listener: (event: ChatEvent) => void): () => void;
  send(input: string): Promise<{ status: ChatRunStatus; error?: string }>;
  cancel(): void;
  /** Drain execution and persist before resolving; a failed close may be retried. */
  close(): Promise<void>;
}
