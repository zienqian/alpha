/**
 * ADK Session S1 — implemented API, 2026-11-04.
 * Normative semantics: docs/adk-session-s1-spec.md.
 * Source: packages/adk-session/src/contracts.ts and package exports.
 * The session package composes the existing public core API; core is unchanged.
 */
declare module '@alpha/adk-session' {
  import type { AdkError, Agent, AgentEvent, Awaitable, DeepReadonly, JsonObject, Message, RunResult } from '@alpha/adk/core';

  export interface SessionKey { readonly namespace: string; readonly id: string }
  export interface SessionTurn {
    readonly requestId: string;
    readonly inputHash: string;
    readonly run: DeepReadonly<RunResult>;
    /** Only messages appended by this run, including finalized tool outcomes. */
    readonly messages: readonly Message[];
    readonly historyStatus: 'ready' | 'blocked';
    readonly committedAt: string;
    /** Revision of this turn's atomic commit; reused in idempotent receipts. */
    readonly committedRevision: number;
  }
  export interface PendingRequest {
    readonly requestId: string;
    readonly inputHash: string;
    /** Unique admission token; never reused or automatically taken over. */
    readonly token: string;
    readonly startedAt: string;
  }
  export interface SessionData {
    readonly formatVersion: 1;
    readonly id: string;
    /** Application-managed compatibility identity for model, tools and instructions. */
    readonly agentKey: string;
    readonly title: string;
    readonly metadata: JsonObject;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly turns: readonly SessionTurn[];
    readonly pending: PendingRequest | null;
  }
  export interface SessionSnapshot {
    readonly revision: number;
    readonly data: SessionData;
  }
  export interface SessionSummary {
    readonly id: string;
    readonly revision: number;
    readonly title: string;
    readonly updatedAt: string;
    readonly status: 'ready' | 'pending' | 'blocked';
  }
  export interface Page<T> { readonly items: readonly T[]; readonly cursor?: string }
  export interface ListOptions { readonly cursor?: string; readonly limit?: number }
  export interface SessionError extends Error {
    readonly code: string;
    /** Present when a create acknowledgement was lost and the ID needs inspection. */
    readonly sessionId?: string;
    readonly cleanupErrors?: readonly Readonly<AdkError>[];
  }
  export interface SessionLimits {
    readonly maxTurns: number; // default 1000; admission limit
    /** default 64 MiB; admission threshold, not a reason to discard a finalized turn */
    readonly maxArchiveBytes: number;
  }
  export type CasResult =
    | { readonly applied: true; readonly revision: number }
    | { readonly applied: false };

  /** Adapter-author API. Every operation is scoped; CAS MUST be atomic. */
  export interface SessionStore {
    /** memory is intentionally volatile; transactional promises survive process restart. */
    readonly durability: 'memory' | 'transactional';
    create(key: SessionKey, data: SessionData): Promise<SessionSnapshot>;
    read(key: SessionKey): Promise<SessionSnapshot | undefined>;
    list(namespace: string, options?: ListOptions): Promise<Page<SessionSummary>>;
    /** next=null tombstones the ID. Applied writes increment revision; IDs cannot be reused. */
    compareAndSet(key: SessionKey, expectedRevision: number, next: SessionData | null): Promise<CasResult>;
    close(): Promise<void>;
  }

  export type SaveResult =
    | { readonly status: 'saved'; readonly revision: number }
    | { readonly status: 'pending'; readonly code: 'STORE_UNAVAILABLE' | 'COMMIT_CONFLICT' };
  export interface SessionResult {
    readonly requestId: string;
    /** Unchanged core outcome; storage failure must not rewrite execution facts. */
    readonly run: DeepReadonly<RunResult>;
    readonly persistence: SaveResult;
  }
  export type SessionEvent =
    | { readonly type: 'agent'; readonly sessionId: string; readonly event: AgentEvent }
    | { readonly type: 'session.saved'; readonly sessionId: string; readonly requestId: string; readonly revision: number }
    | { readonly type: 'session.unsaved'; readonly sessionId: string; readonly requestId: string; readonly code: 'STORE_UNAVAILABLE' | 'COMMIT_CONFLICT' };
  export interface SessionState {
    readonly status: 'idle' | 'running' | 'saving' | 'unsaved' | 'closed';
    /** Eligibility follows the stored archive, even when context omits old turns. */
    readonly historyStatus: 'ready' | 'pending' | 'blocked';
    readonly revision: number;
  }
  export interface Session {
    readonly id: string;
    readonly state: SessionState;
    /** requestId must remain stable for retries of the same logical input. */
    prompt(input: string, options: { readonly requestId: string; readonly signal?: AbortSignal }): Promise<SessionResult>;
    subscribe(listener: (event: SessionEvent) => void): () => void;
    abort(reason?: string): void;
    /** Retry only the captured storage commit. Unknown persisted pending rejects. */
    flush(): Promise<SaveResult>;
    /** Abort/drain core, flush once, then close its Agent. May reject if unsaved. */
    close(): Promise<void>;
  }
  export interface SessionManagerOptions<C = undefined> {
    readonly namespace: string;
    readonly agentKey: string;
    readonly store: SessionStore;
    readonly limits?: Partial<SessionLimits>;
    /** Observer errors do not affect execution or saving; no raw error payloads. */
    readonly onObserverError?: (error: Readonly<AdkError>) => void;
    /** Return a fresh, idle Agent with empty history; ownership transfers to Session. */
    readonly createAgent: (context: { readonly sessionId: string; readonly signal?: AbortSignal }) => Promise<Agent<C>>;
    /** Select complete turns, in original order. Default selects all turns. */
    readonly selectContext?: (context: {
      readonly turns: readonly SessionTurn[];
      readonly signal?: AbortSignal;
    }) => Awaitable<readonly string[]>; // selected core runIds
  }
  export interface SessionManager {
    createSession(input?: { readonly id?: string; readonly title?: string; readonly metadata?: JsonObject }): Promise<Session>;
    openSession(id: string): Promise<Session>;
    getSession(id: string): Promise<SessionSnapshot | undefined>;
    listSessions(options?: ListOptions): Promise<Page<SessionSummary>>;
    updateSession(id: string, patch: { readonly title?: string; readonly metadata?: JsonObject }, options: { readonly expectedRevision: number }): Promise<SessionSnapshot>;
    deleteSession(id: string, options: { readonly expectedRevision: number }): Promise<void>;
    /** Closes owned Session handles; the borrowed store remains application-owned. */
    close(): Promise<void>;
  }
  export function createSessionManager<C = undefined>(options: SessionManagerOptions<C>): SessionManager;
  export function createMemorySessionStore(): SessionStore;
}

declare module '@alpha/adk-session/sqlite' {
  import type { SessionStore } from '@alpha/adk-session';
  /** Optional Node adapter. No SQLite driver is imported by the package root. */
  export function createSqliteSessionStore(options: { readonly filename: string }): Promise<SessionStore>;
}
