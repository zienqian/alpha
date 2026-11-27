import type { ApprovalRequest, ChatMessage, ChatPhase, ContextUsage, PermissionMode } from "../chat/contracts";
import type { BotRoleModelDefaults, BotRoleModelPatch, BotsGlobalSettingsPatch } from "../global-config";

export const botColorIds = [
  "blue",
  "emerald",
  "violet",
  "amber",
  "rose",
  "cyan",
  "indigo",
  "teal",
  "orange",
  "pink",
  "slate",
  "neutral",
] as const;
export type BotColorId = (typeof botColorIds)[number];

export const botShapeIds = [
  "orbit",
  "hex",
  "diamond",
  "cube",
  "rings",
  "spark",
  "capsule",
  "prism",
] as const;
export type BotShapeId = (typeof botShapeIds)[number];

export interface BotAppearance {
  shape: BotShapeId;
  color: BotColorId;
}

export type BotStatusKind = "approval" | "working" | "waiting" | "attention_error" | "done" | "idle";
export type BotMemoryMode = "alphacode" | "off";

export type BotTriggerSource = "user_chat" | "worker_event" | "watchdog" | "bot_mention" | "schedule" | "external_channel";
export type BotTriggerPriority = "urgent" | "normal" | "low";
export type BotTriggerStatus = "pending" | "routed_fast" | "batched" | "processed" | "dropped";

export type BotTaskAccessMode = "readonly" | "write";
export type BotTaskIsolationMode = "shared_readonly" | "git_worktree" | "serial_lock";
export type BotWorktreeState = "none" | "active" | "ready_for_review" | "merged" | "cleaned";
export type BotTaskStatus =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export type BotModelOverride = BotRoleModelDefaults;
export type BotModelOverridePatch = BotRoleModelPatch;

export interface BotRecord {
  id: string;
  name: string;
  instructions: string;
  projectId: string;
  appearance: BotAppearance;
  permissionMode?: PermissionMode;
  maxConcurrentWorkers?: number;
  routerModel?: BotModelOverride;
  workerModel?: BotModelOverride;
  routerSessionId: string;
  sortOrder: number;
  memoryMode: BotMemoryMode;
  lastVisitedAt?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BotThreadRecord {
  id: string;
  botId: string;
  channel: string;
  externalKey?: string;
  title: string;
  status: "active" | "archived";
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface BotTriggerRecord {
  id: string;
  botId: string;
  threadId: string;
  source: BotTriggerSource;
  kind: string;
  priority: BotTriggerPriority;
  idempotencyKey?: string;
  actor: string;
  summary: string;
  payloadRef?: string;
  status: BotTriggerStatus;
  createdAt: string;
  processedAt?: string;
}

export interface BotTaskRecord {
  id: string;
  botId: string;
  shortId: string;
  title: string;
  goal: string;
  projectId: string;
  workspaceRoot: string;
  accessMode: BotTaskAccessMode;
  isolationMode: BotTaskIsolationMode;
  worktreePath?: string;
  worktreeBranch?: string;
  baseCommit?: string;
  mainRepoDirtyAtStart: boolean;
  worktreeState: BotWorktreeState;
  diffArtifactRef?: string;
  workerSessionId: string;
  workerModelId: string;
  status: BotTaskStatus;
  resultSummary?: string;
  originTriggerId?: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
}

export interface BotLinkRecord {
  botId: string;
  fromId: string;
  toId: string;
  relation: string;
  createdAt: string;
}

export interface BotApprovalView {
  approvalId: string;
  botId: string;
  botName: string;
  taskId: string;
  taskShortId: string;
  taskTitle: string;
  projectId: string;
  workspaceRoot: string;
  request: ApprovalRequest;
  createdAt: string;
}

export interface BotRoleModelView {
  modelId: string;
  baseURL: string;
  apiKeyEnv: string;
  noAuth: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
  source: "bot" | "global_bots" | "inherited";
}

export interface BotsGlobalConfigView {
  maxConcurrentWorkers: number;
  perBotMaxWorkers: number;
  worktreeRoot: string;
  globalModelId?: string;
  router?: BotRoleModelView;
  worker?: BotRoleModelView;
}

export type BotsGlobalConfigUpdate = BotsGlobalSettingsPatch;

export interface BotDiffFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
  additions: number;
  deletions: number;
}

export interface BotTaskDiffView {
  taskId: string;
  shortId: string;
  isolationMode: BotTaskIsolationMode;
  worktreePath?: string;
  worktreeBranch?: string;
  baseCommit?: string;
  worktreeState: BotWorktreeState;
  hasChanges: boolean;
  files: readonly BotDiffFile[];
  stat: string;
  patch: string;
  truncated: boolean;
  diffArtifactRef?: string;
}

export interface BotTaskApplyResult {
  applied: boolean;
  strategy: "merge" | "apply_patch";
  worktreeState: BotWorktreeState;
  cleaned: boolean;
  conflictFiles?: readonly string[];
  reason?: string;
}

export interface BotRouterStateView {
  sessionId: string;
  modelId?: string;
  phase: ChatPhase;
  busy: boolean;
  canSend: boolean;
  canSteer: boolean;
  pendingTriggerCount: number;
  contextUsage?: ContextUsage;
  messages: readonly ChatMessage[];
  error?: string;
}

export interface BotSummaryView {
  id: string;
  name: string;
  instructions: string;
  projectId: string;
  projectName: string;
  workspaceRoot?: string;
  projectMissing: boolean;
  appearance: BotAppearance;
  permissionMode?: PermissionMode;
  maxConcurrentWorkers?: number;
  routerModel?: BotModelOverride;
  workerModel?: BotModelOverride;
  sortOrder: number;
  memoryMode: BotMemoryMode;
  lastVisitedAt?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
  status: BotStatusKind;
  statusDetail?: string;
  activeTaskCount: number;
  queuedTaskCount: number;
  pendingApprovalCount: number;
  readyDiffCount: number;
  routerBusy: boolean;
  effectiveRouterModel?: BotRoleModelView;
  effectiveWorkerModel?: BotRoleModelView;
}

export interface BotsIndexSnapshot {
  instanceId: string;
  sequence: number;
  bots: readonly BotSummaryView[];
  approvals: readonly BotApprovalView[];
  defaults: BotsGlobalConfigView;
}

export interface BotDetailStateView {
  instanceId: string;
  sequence: number;
  bot: BotSummaryView;
  router: BotRouterStateView;
  tasks: readonly BotTaskRecord[];
  approvals: readonly BotApprovalView[];
}

export interface BotMessageReceipt {
  requestId: string;
  triggerId: string;
  status: "accepted" | "duplicate";
}

export interface CreateBotInput {
  name: string;
  instructions?: string;
  projectId: string;
  appearance?: Partial<BotAppearance>;
  permissionMode?: PermissionMode | null;
  maxConcurrentWorkers?: number | null;
  routerModel?: BotModelOverride | null;
  workerModel?: BotModelOverride | null;
}

export interface UpdateBotInput {
  name?: string;
  instructions?: string;
  projectId?: string;
  appearance?: Partial<BotAppearance>;
  permissionMode?: PermissionMode | null;
  maxConcurrentWorkers?: number | null;
  routerModel?: BotModelOverridePatch | null;
  workerModel?: BotModelOverridePatch | null;
}

export interface BotDeleteResult {
  deleted: boolean;
  cleanedWorktrees: number;
  unmergedWorktreeTaskIds?: readonly string[];
}

export function defaultBotAppearance(id: string): BotAppearance {
  let hash = 2166136261;
  for (const ch of id) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  return {
    shape: botShapeIds[hash % botShapeIds.length] ?? "orbit",
    color: botColorIds[(hash >>> 3) % botColorIds.length] ?? "blue",
  };
}
