/** Public contracts for @alpha/adk-memory (zero runtime dependencies). */
import type { Awaitable, Message, Plugin } from "@alpha/adk/core";

export type MemoryScopeType = "user" | "project" | "bot";
export type MemoryType = "user" | "feedback" | "project" | "reference";
export type MemoryOwner = "user" | "agent";
export type MemoryWriteMode = "direct" | "propose_only" | "readonly";
export type MemoryFileKind = "index" | "topic" | "rollout" | "pending";

export const memoryScopeTypes: readonly MemoryScopeType[] = Object.freeze(["user", "project", "bot"]);
export const memoryTypes: readonly MemoryType[] = Object.freeze(["user", "feedback", "project", "reference"]);

export interface MemoryScope {
  readonly type: MemoryScopeType;
  readonly id: string;
}

export function memoryScopeKey(scope: MemoryScope): string {
  return `${scope.type}:${scope.id}`;
}

export interface MemoryTopicMeta {
  readonly scope: MemoryScope;
  readonly slug: string;
  readonly path: string;
  readonly name: string;
  readonly description: string;
  readonly type: MemoryType;
  readonly owner: MemoryOwner;
  readonly updatedAt: string;
  readonly proposedBy?: string;
}

export interface MemoryTopic extends MemoryTopicMeta {
  readonly body: string;
}

export interface MemoryTopicInput {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly type: MemoryType;
  readonly owner?: MemoryOwner;
  readonly body: string;
  readonly proposedBy?: string;
  readonly updatedAt?: string;
}

export interface MemoryRollout {
  readonly scope: MemoryScope;
  readonly slug: string;
  readonly path: string;
  readonly sessionId: string;
  readonly title: string;
  readonly body: string;
  readonly createdAt: string;
}

export interface MemorySearchHit {
  readonly scope: MemoryScope;
  readonly path: string;
  readonly kind: MemoryFileKind;
  readonly name: string;
  readonly description: string;
  readonly memType?: MemoryType;
  readonly owner: MemoryOwner;
  readonly snippet: string;
  readonly score: number;
}

export interface MemoryHistoryHit {
  readonly sessionId: string;
  readonly title: string;
  readonly role: "user" | "assistant" | "tool";
  readonly messageId?: string;
  readonly snippet: string;
  readonly updatedAt: string;
}

export type MemoryHistorySearcher = (
  query: string,
  options: { readonly limit: number; readonly signal: AbortSignal },
) => Awaitable<readonly MemoryHistoryHit[]>;

export interface IndexedMemoryFile {
  readonly path: string;
  readonly scopeKey: string;
  readonly kind: MemoryFileKind;
  readonly memType?: MemoryType;
  readonly owner: MemoryOwner;
  readonly name: string;
  readonly description: string;
  readonly body: string;
  readonly contentSha256: string;
  readonly mtimeMs: number;
  readonly updatedAt: string;
}

export type MemoryJobKind = "stage1_extract" | "stage2_dream";
export type MemoryJobStatus = "idle" | "running" | "done" | "failed";

export interface MemoryJob {
  readonly jobKey: string;
  readonly kind: MemoryJobKind;
  readonly scopeKey: string;
  readonly status: MemoryJobStatus;
  readonly leaseOwner?: string;
  readonly leaseExpiresAt?: string;
  readonly watermark?: string;
  readonly retryCount: number;
  readonly lastRunAt?: string;
  readonly lastError?: string;
  readonly updatedAt: string;
}

export interface Stage1Output {
  readonly sessionKey: string;
  readonly scopeKey: string;
  readonly sessionRevision: number;
  readonly rolloutPath: string;
  readonly rawTakeaways: string;
  readonly skippedReason?: string;
  readonly consumedByDreamAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MemoryStore {
  readonly rootDir: string;
  readIndex(scope: MemoryScope): Promise<string | undefined>;
  writeIndex(scope: MemoryScope, content: string): Promise<void>;
  listTopics(scope: MemoryScope): Promise<readonly MemoryTopicMeta[]>;
  readTopic(scope: MemoryScope, slug: string): Promise<MemoryTopic | undefined>;
  writeTopic(scope: MemoryScope, input: MemoryTopicInput, options?: { readonly actor?: MemoryOwner; readonly allowOverwriteLocked?: boolean }): Promise<MemoryTopic>;
  deleteTopic(scope: MemoryScope, slug: string, options?: { readonly actor?: MemoryOwner; readonly allowDeleteLocked?: boolean }): Promise<boolean>;
  writeProposal(scope: MemoryScope, input: MemoryTopicInput): Promise<MemoryTopic>;
  listProposals(scope: MemoryScope): Promise<readonly MemoryTopicMeta[]>;
  writeRollout(scope: MemoryScope, input: { readonly slug: string; readonly sessionId: string; readonly title: string; readonly body: string; readonly createdAt?: string }): Promise<MemoryRollout>;
  listRollouts(scope: MemoryScope, limit?: number): Promise<readonly { readonly slug: string; readonly path: string; readonly title: string; readonly updatedAt: string }[]>;
  readFile(scope: MemoryScope, relativePath: string, maxBytes?: number): Promise<{ readonly path: string; readonly content: string; readonly truncated: boolean } | undefined>;
  rebuildIndex(scope: MemoryScope, options?: { readonly maxLines?: number; readonly maxBytes?: number }): Promise<string>;
  search(query: string, scopes: readonly MemoryScope[], limit?: number): Promise<readonly MemorySearchHit[]>;
  snapshotScope(scope: MemoryScope): Promise<string>;
  restoreSnapshot(scope: MemoryScope, snapshotId: string): Promise<void>;
  listSnapshots(scope: MemoryScope): Promise<readonly string[]>;
  syncIndex?(scopes?: readonly MemoryScope[]): Promise<void>;
}

export interface MemoryCoordinatorStore {
  claimJob(input: {
    readonly jobKey: string;
    readonly kind: MemoryJobKind;
    readonly scopeKey: string;
    readonly leaseOwner: string;
    readonly leaseTtlMs: number;
    readonly nowIso?: string;
  }): boolean;
  completeJob(jobKey: string, leaseOwner: string, options?: { readonly watermark?: string; readonly nowIso?: string }): void;
  failJob(jobKey: string, leaseOwner: string, error: string, nowIso?: string): void;
  getJob(jobKey: string): MemoryJob | undefined;
  saveStage1Output(output: Omit<Stage1Output, "createdAt" | "updatedAt"> & { readonly nowIso?: string }): Stage1Output;
  getStage1Output(sessionKey: string): Stage1Output | undefined;
  listPendingStage1(scopeKey: string, limit?: number): readonly Stage1Output[];
  markStage1Consumed(sessionKeys: readonly string[], nowIso?: string): void;
  syncScopeFiles(scopeKey: string, files: readonly IndexedMemoryFile[]): void;
  searchFts(query: string, scopeKeys: readonly string[], limit?: number): readonly MemorySearchHit[];
  close(): void;
}

export type MemoryModelRunner = (
  prompt: string,
  options: { readonly maxOutputTokens: number; readonly signal: AbortSignal },
) => Promise<string>;

export interface MemoryPluginOptions {
  readonly store: MemoryStore;
  readonly readScopes: readonly MemoryScope[];
  readonly writeScope?: MemoryScope;
  readonly writableScopes?: readonly MemoryScope[];
  readonly writeMode: MemoryWriteMode;
  readonly maxIndexLines?: number;
  readonly maxIndexBytes?: number;
  readonly proposedBy?: string;
  readonly historySearcher?: MemoryHistorySearcher;
  readonly onWrite?: (event: { readonly scope: MemoryScope; readonly path: string; readonly action: "upsert" | "delete" | "propose" }) => Awaitable<void>;
}

export interface MemoryPluginHandle<C = undefined> {
  readonly plugin: Plugin<C>;
  readonly wroteInLastRun: () => boolean;
  readonly resetRunFlag: () => void;
}

export interface Stage1ExtractInput {
  readonly store: MemoryStore;
  readonly coordinator: MemoryCoordinatorStore;
  readonly scope: MemoryScope;
  readonly sessionKey: string;
  readonly sessionId: string;
  readonly sessionRevision: number;
  readonly messages: readonly Message[];
  readonly leaseOwner: string;
  readonly runModel: MemoryModelRunner;
  readonly alreadyWroteInRun?: boolean;
  readonly signal: AbortSignal;
  readonly nowIso?: string;
}

export interface Stage1ExtractResult {
  readonly status: "extracted" | "skipped" | "busy" | "failed";
  readonly reason?: string;
  readonly rolloutPath?: string;
}

export interface Stage2DreamInput {
  readonly store: MemoryStore;
  readonly coordinator: MemoryCoordinatorStore;
  readonly scope: MemoryScope;
  readonly leaseOwner: string;
  readonly runModel: MemoryModelRunner;
  readonly force?: boolean;
  readonly minIntervalHours?: number;
  readonly minNewRollouts?: number;
  readonly maxIndexLines?: number;
  readonly maxIndexBytes?: number;
  readonly signal: AbortSignal;
  readonly nowIso?: string;
}

export interface Stage2DreamResult {
  readonly status: "completed" | "skipped" | "busy" | "failed";
  readonly reason?: string;
  readonly snapshotId?: string;
  readonly consumedRollouts: number;
  readonly upsertedTopics: readonly string[];
  readonly deletedTopics: readonly string[];
  readonly skippedLockedTopics: readonly string[];
}
