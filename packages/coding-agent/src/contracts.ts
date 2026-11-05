import type { Shell } from './process/shell.js';
import type { AgentOptions, AppOption, Awaitable, JsonObject, ToolContext, ValidatedCall } from '@alpha/adk/core';
import type { LanguageModel } from '@alpha/provider';

export type CodingDecision = 'allow' | 'ask' | 'deny';
export type CodingActionKind = 'read' | 'search' | 'edit' | 'create' | 'command' | 'custom';
export type CodingCallContext = Pick<ToolContext<unknown>, 'agentId' | 'runId' | 'assistantId' | 'callId' | 'signal'>;
export type CodingPreview =
  | { readonly type: 'path'; readonly path: string }
  | { readonly type: 'diff'; readonly path: string; readonly beforeRevision: string | null;
      readonly diff: string; readonly truncated: boolean }
  | { readonly type: 'command'; readonly command: string; readonly cwd: string; readonly shell: string }
  | { readonly type: 'custom'; readonly description: string };
export interface CodingAction {
  readonly kind: CodingActionKind;
  readonly cwd: string;
  readonly call: ValidatedCall;
  readonly preview: CodingPreview;
  /** Binds cwd, canonical targets, exact arguments, expected version and preview. */
  readonly digest: string;
}
/** Static implementations use object + satisfies CodingPolicy. No second rule DSL in C1. */
export interface CodingPolicy {
  decide(action: CodingAction, context: CodingCallContext): Awaitable<CodingDecision>;
}
/** One-shot, in-process decision. Missing handler / aborted decision never implies allow. */
export type CodingApproval = (
  action: CodingAction, context: CodingCallContext
) => Awaitable<'allow' | 'deny'>;
export type CodingEvent =
  | { readonly type: 'command.output'; readonly runId: string; readonly callId: string;
      readonly channel: 'stdout' | 'stderr'; readonly text: string }
  | { readonly type: 'file.changed'; readonly runId: string; readonly callId: string;
      readonly path: string; readonly beforeRevision: string | null; readonly afterRevision: string };
export interface CodingControls {
  /** Default: read/search/edit/create allow; command ask; custom deny. */
  readonly policy?: CodingPolicy;
  readonly approve?: CodingApproval;
  /** Observation only. No persistence guarantee; callback exceptions do not alter tool facts. */
  readonly onEvent?: (event: CodingEvent) => void;
}
/** Per-agent execution context. Static tools receive it through ToolContext.app. */
export interface CodingContext<C = unknown> {
  readonly cwd: string;
  readonly shell: Shell | null;
  /** Caller-owned application data, separate from coding execution state. */
  readonly data: C;
  readonly controls: CodingControls;
  readonly state: {
    readonly budget: number;
    readonly plans: Map<string, CodingPlan>;
    readonly observations: Map<string, string>;
    used: boolean;
  };
}
/** A preflight plan retained until the same approved call executes. */
export interface CodingPlan {
  readonly kind: CodingActionKind;
  readonly preview: CodingPreview;
  readonly args: JsonObject;
  readonly write?: FileWrite;
  readonly rejected?: string;
}
export type CodingContextOptions<C = undefined> = CodingControls & AppOption<C> & {
  readonly cwd: string;
  /** Host-selected executable, false disables commands; omitted selects a supported shell. */
  readonly shell?: string | false;
  readonly maxResultBytes?: number;
};
export type CodingAgentOptions<C = undefined> = Omit<AgentOptions<CodingContext<C>>, 'model' | 'instructions' | 'appContext'> & AppOption<C> & CodingControls & {
  readonly cwd: string;
  /** Host-selected executable, false disables commands; omitted selects a supported shell. */
  readonly shell?: string | false;
  readonly model: LanguageModel;
  /** Appended to the coding preset's system instructions. */
  readonly instructions?: string;
  /** Root AGENTS.md only in C1. false disables loading; no executable auto-discovery. */
  readonly projectInstructions?: false | { readonly file?: string; readonly maxBytes?: number };
};
export interface FileSnapshot {
  readonly path: string;
  readonly content: string;
  /** Digest of the exact file bytes, not a Session revision. */
  readonly revision: string;
}
export interface FileWrite {
  readonly path: string;
  readonly content: string;
  /** null = create only; a digest = update only that observed version. */
  readonly expectedRevision: string | null;
}
export type FileWriteOutcome =
  | { readonly status: 'applied'; readonly revision: string }
  | { readonly status: 'rejected'; readonly code: string }
  | { readonly status: 'unknown'; readonly code: string };
export interface CommandInput {
  readonly command: string;
  readonly cwd?: string;
  readonly timeoutMs?: number;
}
export type CommandOutcome =
  | { readonly status: 'exited'; readonly exitCode: number;
      readonly stdout: string; readonly stderr: string; readonly truncated: boolean; readonly outputIncomplete: boolean }
  | { readonly status: 'not_started'; readonly code: string }
  | { readonly status: 'unknown'; readonly code: string };
/** Tool results remain core strings. C1 encodes bounded JSON, not a new core message type. */
export type CodingToolResult =
  | { readonly ok: true; readonly data: JsonObject }
  | { readonly ok: false; readonly code: string; readonly detail?: JsonObject };
