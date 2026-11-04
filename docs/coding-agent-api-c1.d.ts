/**
 * Alpha Coding Agent C1 — implemented API snapshot, 2026-11-04.
 * Generated from package contracts by packages/coding-agent/scripts/sync-docs.js.
 * Review attachment only. Consumers import the package; examples check its real emitted types.
 */
declare module '@alpha/coding-agent' {
  import type { Agent, AgentOptions, Awaitable, JsonObject, Plugin, ToolContext, ValidatedCall } from '@alpha/adk/core';
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
    readonly workspaceId: string;
    readonly call: ValidatedCall;
    readonly preview: CodingPreview;
    /** Binds workspace, canonical targets, exact arguments, expected version and preview. */
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
    readonly workspace: CodingWorkspace;
    /** Default: read/search/edit/create allow; command ask; custom deny. */
    readonly policy?: CodingPolicy;
    readonly approve?: CodingApproval;
    /** Observation only. No persistence guarantee; callback exceptions do not alter tool facts. */
    readonly onEvent?: (event: CodingEvent) => void;
  }
  export type CodingAgentOptions<C = undefined> = Omit<AgentOptions<C>, 'model' | 'instructions' | 'tools' | 'plugins'> & CodingControls & {
    readonly model: LanguageModel;
    /** Appended to the coding preset's system instructions. */
    readonly instructions?: string;
    /** Root AGENTS.md only in C1. false disables loading; no executable auto-discovery. */
    readonly projectInstructions?: false | { readonly file?: string; readonly maxBytes?: number };
    /** Additional trusted core plugins; conflicts reject instead of silently overriding tools. */
    readonly plugins?: readonly Plugin<NoInfer<C>>[];
  };
  // Adapter-author contract. Business callers normally only create and close a workspace.
  export interface CodingWorkspace {
    /** Stable canonical workspace identity, suitable for inclusion in the host's agentKey. */
    readonly id: string;
    readonly root: string;
    readonly shell: string;
    /** Describes the implementation, never turns a path check into an OS sandbox. */
    readonly isolation: 'none' | 'sandbox';
    /** Exclusive Agent-lifetime ownership. Busy rejects immediately; no implicit queue. */
    acquire(options?: { readonly signal?: AbortSignal }): Promise<WorkspaceLease>;
    /** Scoped reads are available to trusted host/context code without a writer lease. */
    readFile(path: string, options?: { readonly signal?: AbortSignal }): Promise<FileSnapshot | undefined>;
    listFiles(input: { readonly glob?: string; readonly limit?: number }, options?: { readonly signal?: AbortSignal }):
      Promise<{ readonly paths: readonly string[]; readonly truncated: boolean }>;
    search(input: { readonly query: string; readonly glob?: string; readonly limit?: number }, options?: { readonly signal?: AbortSignal }):
      Promise<{ readonly matches: readonly { readonly path: string; readonly line: number; readonly text: string }[]; readonly truncated: boolean }>;
    /** Application-owned; stop new leases and drain existing operations/leases. */
    close(): Promise<void>;
  }
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
        readonly stdout: string; readonly stderr: string; readonly truncated: boolean }
    | { readonly status: 'not_started'; readonly code: string }
    | { readonly status: 'unknown'; readonly code: string };
  export interface WorkspaceLease {
    /** Recheck preconditions under the lease; no cross-file transaction or rollback promise. */
    writeFile(input: FileWrite, options?: { readonly signal?: AbortSignal }): Promise<FileWriteOutcome>;
    runCommand(input: CommandInput, options: { readonly signal: AbortSignal;
      readonly onOutput?: (channel: 'stdout' | 'stderr', text: string) => void }): Promise<CommandOutcome>;
    /** Idempotent; wait for owned operations and process trees. Never release while a child is live. */
    release(): Promise<void>;
  }
  /** Tool results remain core strings. C1 encodes bounded JSON, not a new core message type. */
  export type CodingToolResult =
    | { readonly ok: true; readonly data: JsonObject }
    | { readonly ok: false; readonly code: string; readonly detail?: JsonObject };


  /** Ordinary core Agent, using the same Loop and public contracts. */
  export function createCodingAgent<C = undefined>(options: CodingAgentOptions<C>): Promise<Agent<C>>;
  /** maxResultBytes must match a lower core limit when assembling manually; minimum 4096. */
  export function createWorkspacePlugin<C = undefined>(options: CodingControls & { readonly maxResultBytes?: number }): Plugin<C>;
  export function createProjectInstructionsPlugin<C = undefined>(options: {
    readonly workspace: CodingWorkspace; readonly file?: string; readonly maxBytes?: number;
  }): Plugin<C>;
}

declare module '@alpha/coding-agent/node' {
  import type { CodingWorkspace } from '@alpha/coding-agent';
  export interface LocalWorkspaceOptions {
    readonly root: string;
    /** C1 supports Windows + PowerShell 7; other shells explicitly reject. */
    readonly shell: 'powershell' | 'bash';
    readonly env?: Readonly<Record<string, string>>;
    readonly limits?: { readonly maxFileBytes?: number; readonly maxOutputBytes?: number; readonly commandTimeoutMs?: number };
  }
  export function createLocalWorkspace(options: LocalWorkspaceOptions): Promise<CodingWorkspace>;
}
