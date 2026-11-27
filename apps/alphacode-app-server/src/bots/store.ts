import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { PermissionMode } from "../chat/contracts";
import {
  botColorIds,
  botShapeIds,
  defaultBotAppearance,
  type BotAppearance,
  type BotColorId,
  type BotLinkRecord,
  type BotMemoryMode,
  type BotModelOverride,
  type BotRecord,
  type BotShapeId,
  type BotTaskAccessMode,
  type BotTaskIsolationMode,
  type BotTaskRecord,
  type BotTaskStatus,
  type BotThreadRecord,
  type BotTriggerPriority,
  type BotTriggerRecord,
  type BotTriggerSource,
  type BotTriggerStatus,
  type BotWorktreeState,
} from "./contracts";

interface BotRow {
  id: string;
  name: string;
  instructions: string;
  project_id: string;
  appearance_json: string;
  permission_mode: string | null;
  max_concurrent_workers: number | null;
  router_model_json: string | null;
  worker_model_json: string | null;
  router_session_id: string;
  sort_order: number;
  memory_mode: string;
  last_visited_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ThreadRow {
  id: string;
  bot_id: string;
  channel: string;
  external_key: string | null;
  title: string;
  status: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

interface TriggerRow {
  id: string;
  bot_id: string;
  thread_id: string;
  source: string;
  kind: string;
  priority: string;
  idempotency_key: string | null;
  actor: string;
  summary: string;
  payload_ref: string | null;
  status: string;
  created_at: string;
  processed_at: string | null;
}

interface TaskRow {
  id: string;
  bot_id: string;
  short_id: string;
  title: string;
  goal: string;
  project_id: string;
  workspace_root: string;
  access_mode: string;
  isolation_mode: string;
  worktree_path: string | null;
  worktree_branch: string | null;
  base_commit: string | null;
  main_repo_dirty_at_start: number;
  worktree_state: string;
  diff_artifact_ref: string | null;
  worker_session_id: string;
  worker_model_id: string;
  status: string;
  result_summary: string | null;
  origin_trigger_id: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

interface LinkRow {
  bot_id: string;
  from_id: string;
  to_id: string;
  relation: string;
  created_at: string;
}

function parseAppearance(id: string, raw: string): BotAppearance {
  const fallback = defaultBotAppearance(id);
  try {
    const parsed = JSON.parse(raw) as Partial<BotAppearance> | null;
    if (!parsed || typeof parsed !== "object") return fallback;
    const shape = botShapeIds.includes(parsed.shape as BotShapeId) ? (parsed.shape as BotShapeId) : fallback.shape;
    const color = botColorIds.includes(parsed.color as BotColorId) ? (parsed.color as BotColorId) : fallback.color;
    return { shape, color };
  } catch {
    return fallback;
  }
}

function parseModelOverride(raw: string | null): BotModelOverride | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as BotModelOverride | null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const out: BotModelOverride = {};
    if (typeof parsed.modelId === "string" && parsed.modelId.trim()) out.modelId = parsed.modelId.trim();
    if (typeof parsed.contextWindow === "number" && Number.isSafeInteger(parsed.contextWindow) && parsed.contextWindow > 0) out.contextWindow = parsed.contextWindow;
    if (typeof parsed.maxOutputTokens === "number" && Number.isSafeInteger(parsed.maxOutputTokens) && parsed.maxOutputTokens > 0) out.maxOutputTokens = parsed.maxOutputTokens;
    if (typeof parsed.baseURL === "string" && parsed.baseURL.trim()) out.baseURL = parsed.baseURL.trim();
    if (typeof parsed.apiKeyEnv === "string" && parsed.apiKeyEnv.trim()) out.apiKeyEnv = parsed.apiKeyEnv.trim();
    if (typeof parsed.noAuth === "boolean") out.noAuth = parsed.noAuth;
    return Object.keys(out).length ? out : undefined;
  } catch {
    return undefined;
  }
}

function mapBot(row: BotRow): BotRecord {
  const routerModel = parseModelOverride(row.router_model_json);
  const workerModel = parseModelOverride(row.worker_model_json);
  const permissionMode = row.permission_mode === "ask" || row.permission_mode === "auto" || row.permission_mode === "full"
    ? (row.permission_mode as PermissionMode)
    : undefined;
  return {
    id: row.id,
    name: row.name,
    instructions: row.instructions,
    projectId: row.project_id,
    appearance: parseAppearance(row.id, row.appearance_json),
    ...(permissionMode ? { permissionMode } : {}),
    ...(row.max_concurrent_workers !== null ? { maxConcurrentWorkers: row.max_concurrent_workers } : {}),
    ...(routerModel ? { routerModel } : {}),
    ...(workerModel ? { workerModel } : {}),
    routerSessionId: row.router_session_id,
    sortOrder: row.sort_order,
    memoryMode: row.memory_mode === "off" ? "off" : "alphacode",
    ...(row.last_visited_at ? { lastVisitedAt: row.last_visited_at } : {}),
    ...(row.archived_at ? { archivedAt: row.archived_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapThread(row: ThreadRow): BotThreadRecord {
  let metadata: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.metadata_json) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed as Record<string, unknown>;
  } catch { /* Ignore malformed metadata. */ }
  return {
    id: row.id,
    botId: row.bot_id,
    channel: row.channel,
    ...(row.external_key ? { externalKey: row.external_key } : {}),
    title: row.title,
    status: row.status === "archived" ? "archived" : "active",
    metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTrigger(row: TriggerRow): BotTriggerRecord {
  return {
    id: row.id,
    botId: row.bot_id,
    threadId: row.thread_id,
    source: row.source as BotTriggerSource,
    kind: row.kind,
    priority: row.priority as BotTriggerPriority,
    ...(row.idempotency_key ? { idempotencyKey: row.idempotency_key } : {}),
    actor: row.actor,
    summary: row.summary,
    ...(row.payload_ref ? { payloadRef: row.payload_ref } : {}),
    status: row.status as BotTriggerStatus,
    createdAt: row.created_at,
    ...(row.processed_at ? { processedAt: row.processed_at } : {}),
  };
}

function mapTask(row: TaskRow): BotTaskRecord {
  return {
    id: row.id,
    botId: row.bot_id,
    shortId: row.short_id,
    title: row.title,
    goal: row.goal,
    projectId: row.project_id,
    workspaceRoot: row.workspace_root,
    accessMode: row.access_mode as BotTaskAccessMode,
    isolationMode: row.isolation_mode as BotTaskIsolationMode,
    ...(row.worktree_path ? { worktreePath: row.worktree_path } : {}),
    ...(row.worktree_branch ? { worktreeBranch: row.worktree_branch } : {}),
    ...(row.base_commit ? { baseCommit: row.base_commit } : {}),
    mainRepoDirtyAtStart: Boolean(row.main_repo_dirty_at_start),
    worktreeState: row.worktree_state as BotWorktreeState,
    ...(row.diff_artifact_ref ? { diffArtifactRef: row.diff_artifact_ref } : {}),
    workerSessionId: row.worker_session_id,
    workerModelId: row.worker_model_id,
    status: row.status as BotTaskStatus,
    ...(row.result_summary !== null ? { resultSummary: row.result_summary } : {}),
    ...(row.origin_trigger_id ? { originTriggerId: row.origin_trigger_id } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
  };
}

function mapLink(row: LinkRow): BotLinkRecord {
  return {
    botId: row.bot_id,
    fromId: row.from_id,
    toId: row.to_id,
    relation: row.relation,
    createdAt: row.created_at,
  };
}

export interface BotPatch {
  name?: string;
  instructions?: string;
  projectId?: string;
  appearance?: BotAppearance;
  permissionMode?: PermissionMode | null;
  maxConcurrentWorkers?: number | null;
  routerModel?: BotModelOverride | null;
  workerModel?: BotModelOverride | null;
  sortOrder?: number;
  memoryMode?: BotMemoryMode;
  lastVisitedAt?: string | null;
  archivedAt?: string | null;
}

export interface BotTaskPatch {
  title?: string;
  status?: BotTaskStatus;
  isolationMode?: BotTaskIsolationMode;
  worktreePath?: string | null;
  worktreeBranch?: string | null;
  baseCommit?: string | null;
  mainRepoDirtyAtStart?: boolean;
  worktreeState?: BotWorktreeState;
  diffArtifactRef?: string | null;
  resultSummary?: string | null;
  finishedAt?: string | null;
}

export interface BotsStore {
  readonly filename: string;
  createBot(bot: BotRecord): BotRecord;
  getBot(id: string): BotRecord | undefined;
  listBots(options?: { includeArchived?: boolean }): BotRecord[];
  nextSortOrder(): number;
  updateBot(id: string, patch: BotPatch): BotRecord | undefined;
  reorderBots(ids: readonly string[]): void;
  deleteBot(id: string): boolean;

  ensureThread(input: { id: string; botId: string; channel?: string; externalKey?: string; title?: string; metadata?: Record<string, unknown> }): BotThreadRecord;
  getThread(id: string): BotThreadRecord | undefined;

  savePayload(botId: string, id: string, content: string): void;
  getPayload(botId: string, id: string): string | undefined;

  insertTrigger(trigger: BotTriggerRecord): { inserted: boolean; trigger: BotTriggerRecord };
  getTrigger(botId: string, id: string): BotTriggerRecord | undefined;
  listPendingTriggers(botId: string, limit?: number): BotTriggerRecord[];
  countPendingTriggers(botId: string): number;
  listRecentThreadTriggers(botId: string, threadId: string, limit?: number): BotTriggerRecord[];
  markTriggersStatus(ids: readonly string[], status: BotTriggerStatus): void;

  createTask(task: BotTaskRecord): BotTaskRecord;
  updateTask(id: string, patch: BotTaskPatch): BotTaskRecord | undefined;
  getTask(id: string): BotTaskRecord | undefined;
  getTaskByShortId(shortId: string): BotTaskRecord | undefined;
  listTasksByBot(botId: string, limit?: number): BotTaskRecord[];
  listAllTasks(limit?: number): BotTaskRecord[];
  listUnmergedWorktreeTasks(botId: string): BotTaskRecord[];
  markRunningTasksInterrupted(): BotTaskRecord[];

  subscribeThread(botId: string, threadId: string, taskId: string): void;
  unsubscribeThread(threadId: string, taskId: string): void;
  listSubscribedTasks(botId: string, threadId: string): BotTaskRecord[];

  addLink(botId: string, fromId: string, toId: string, relation: string): void;
  getLinks(botId: string, objectId: string): BotLinkRecord[];

  close(): void;
}

export function createBotsStore(filename: string): BotsStore {
  mkdirSync(dirname(filename), { recursive: true });
  const db = new Database(filename, { create: true });
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 10000;

    CREATE TABLE IF NOT EXISTS bots (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      instructions TEXT NOT NULL DEFAULT '',
      project_id TEXT NOT NULL,
      appearance_json TEXT NOT NULL,
      permission_mode TEXT,
      max_concurrent_workers INTEGER,
      router_model_json TEXT,
      worker_model_json TEXT,
      router_session_id TEXT NOT NULL DEFAULT 'main',
      sort_order INTEGER NOT NULL DEFAULT 0,
      memory_mode TEXT NOT NULL DEFAULT 'alphacode',
      last_visited_at TEXT,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bots_active_order ON bots(archived_at, sort_order, created_at);

    CREATE TABLE IF NOT EXISTS bot_threads (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      channel TEXT NOT NULL DEFAULT 'desktop-app',
      external_key TEXT,
      title TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bot_threads_bot ON bot_threads(bot_id, updated_at);

    CREATE TABLE IF NOT EXISTS bot_payloads (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bot_triggers (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      thread_id TEXT NOT NULL REFERENCES bot_threads(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      kind TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'normal',
      idempotency_key TEXT UNIQUE,
      actor TEXT NOT NULL,
      summary TEXT NOT NULL,
      payload_ref TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      processed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bot_triggers_bot_status ON bot_triggers(bot_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_bot_triggers_thread_created ON bot_triggers(thread_id, created_at);

    CREATE TABLE IF NOT EXISTS bot_tasks (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      short_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      goal TEXT NOT NULL,
      project_id TEXT NOT NULL,
      workspace_root TEXT NOT NULL,
      access_mode TEXT NOT NULL,
      isolation_mode TEXT NOT NULL,
      worktree_path TEXT,
      worktree_branch TEXT,
      base_commit TEXT,
      main_repo_dirty_at_start INTEGER NOT NULL DEFAULT 0,
      worktree_state TEXT NOT NULL DEFAULT 'none',
      diff_artifact_ref TEXT,
      worker_session_id TEXT NOT NULL,
      worker_model_id TEXT NOT NULL,
      status TEXT NOT NULL,
      result_summary TEXT,
      origin_trigger_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bot_tasks_bot_updated ON bot_tasks(bot_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bot_tasks_status ON bot_tasks(status, updated_at);

    CREATE TABLE IF NOT EXISTS bot_subscriptions (
      thread_id TEXT NOT NULL REFERENCES bot_threads(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES bot_tasks(id) ON DELETE CASCADE,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, task_id)
    );

    CREATE TABLE IF NOT EXISTS bot_links (
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (bot_id, from_id, to_id, relation)
    );
    CREATE INDEX IF NOT EXISTS idx_bot_links_from ON bot_links(bot_id, from_id);
    CREATE INDEX IF NOT EXISTS idx_bot_links_to ON bot_links(bot_id, to_id);
  `);

  const qInsertBot = db.query(`
    INSERT INTO bots (
      id, name, instructions, project_id, appearance_json, permission_mode, max_concurrent_workers,
      router_model_json, worker_model_json, router_session_id, sort_order, memory_mode,
      last_visited_at, archived_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const qGetBot = db.query<BotRow, [string]>("SELECT * FROM bots WHERE id = ?");
  const qListActiveBots = db.query<BotRow, []>(
    "SELECT * FROM bots WHERE archived_at IS NULL ORDER BY sort_order ASC, created_at ASC",
  );
  const qListAllBots = db.query<BotRow, []>(
    "SELECT * FROM bots ORDER BY (archived_at IS NOT NULL) ASC, sort_order ASC, created_at ASC",
  );
  const qMaxSort = db.query<{ max_order: number | null }, []>("SELECT MAX(sort_order) as max_order FROM bots");
  const qDeleteBot = db.query("DELETE FROM bots WHERE id = ?");

  const qGetThread = db.query<ThreadRow, [string]>("SELECT * FROM bot_threads WHERE id = ?");
  const qInsertThread = db.query(
    "INSERT INTO bot_threads (id, bot_id, channel, external_key, title, status, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)",
  );
  const qTouchThread = db.query("UPDATE bot_threads SET updated_at = ? WHERE id = ?");

  const qSavePayload = db.query("INSERT OR REPLACE INTO bot_payloads (id, bot_id, content, created_at) VALUES (?, ?, ?, ?)");
  const qGetPayload = db.query<{ content: string }, [string, string]>("SELECT content FROM bot_payloads WHERE bot_id = ? AND id = ?");

  const qGetTrigger = db.query<TriggerRow, [string, string]>("SELECT * FROM bot_triggers WHERE bot_id = ? AND id = ?");
  const qGetTriggerByKey = db.query<TriggerRow, [string]>("SELECT * FROM bot_triggers WHERE idempotency_key = ?");
  const qInsertTrigger = db.query(
    "INSERT INTO bot_triggers (id, bot_id, thread_id, source, kind, priority, idempotency_key, actor, summary, payload_ref, status, created_at, processed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const qPendingTriggers = db.query<TriggerRow, [string, number]>(
    "SELECT * FROM bot_triggers WHERE bot_id = ? AND status = 'pending' ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, created_at ASC LIMIT ?",
  );
  const qCountPending = db.query<{ count: number }, [string]>(
    "SELECT COUNT(*) as count FROM bot_triggers WHERE bot_id = ? AND status = 'pending'",
  );
  const qThreadTriggers = db.query<TriggerRow, [string, string, number]>(
    "SELECT * FROM bot_triggers WHERE bot_id = ? AND thread_id = ? ORDER BY created_at DESC LIMIT ?",
  );

  const qGetTask = db.query<TaskRow, [string]>("SELECT * FROM bot_tasks WHERE id = ?");
  const qGetTaskByShort = db.query<TaskRow, [string]>("SELECT * FROM bot_tasks WHERE short_id = ?");
  const qListTasksByBot = db.query<TaskRow, [string, number]>(
    "SELECT * FROM bot_tasks WHERE bot_id = ? ORDER BY updated_at DESC LIMIT ?",
  );
  const qListAllTasks = db.query<TaskRow, [number]>("SELECT * FROM bot_tasks ORDER BY updated_at DESC LIMIT ?");
  const qUnmergedWorktrees = db.query<TaskRow, [string]>(
    "SELECT * FROM bot_tasks WHERE bot_id = ? AND isolation_mode = 'git_worktree' AND worktree_state IN ('active', 'ready_for_review')",
  );
  const qInsertTask = db.query(`
    INSERT INTO bot_tasks (
      id, bot_id, short_id, title, goal, project_id, workspace_root, access_mode, isolation_mode,
      worktree_path, worktree_branch, base_commit, main_repo_dirty_at_start, worktree_state,
      diff_artifact_ref, worker_session_id, worker_model_id, status, result_summary,
      origin_trigger_id, created_at, updated_at, finished_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const qRunningTasks = db.query<TaskRow, []>(
    "SELECT * FROM bot_tasks WHERE status IN ('queued', 'running', 'awaiting_approval')",
  );

  const qSubscribe = db.query(
    "INSERT INTO bot_subscriptions (thread_id, task_id, active, created_at) VALUES (?, ?, 1, ?) ON CONFLICT(thread_id, task_id) DO UPDATE SET active = 1",
  );
  const qUnsubscribe = db.query("UPDATE bot_subscriptions SET active = 0 WHERE thread_id = ? AND task_id = ?");
  const qSubscribedTasks = db.query<TaskRow, [string, string]>(`
    SELECT t.* FROM bot_tasks t
    INNER JOIN bot_subscriptions s ON s.task_id = t.id
    WHERE t.bot_id = ? AND s.thread_id = ? AND s.active = 1 AND t.status IN ('queued', 'running', 'awaiting_approval')
    ORDER BY t.created_at ASC
  `);

  const qAddLink = db.query("INSERT OR IGNORE INTO bot_links (bot_id, from_id, to_id, relation, created_at) VALUES (?, ?, ?, ?, ?)");
  const qGetLinks = db.query<LinkRow, [string, string, string]>(
    "SELECT * FROM bot_links WHERE bot_id = ? AND (from_id = ? OR to_id = ?) ORDER BY created_at DESC LIMIT 50",
  );

  return {
    filename,
    createBot(bot) {
      qInsertBot.run(
        bot.id,
        bot.name,
        bot.instructions,
        bot.projectId,
        JSON.stringify(bot.appearance),
        bot.permissionMode ?? null,
        bot.maxConcurrentWorkers ?? null,
        bot.routerModel ? JSON.stringify(bot.routerModel) : null,
        bot.workerModel ? JSON.stringify(bot.workerModel) : null,
        bot.routerSessionId,
        bot.sortOrder,
        bot.memoryMode,
        bot.lastVisitedAt ?? null,
        bot.archivedAt ?? null,
        bot.createdAt,
        bot.updatedAt,
      );
      return bot;
    },
    getBot(id) {
      const row = qGetBot.get(id);
      return row ? mapBot(row) : undefined;
    },
    listBots(options = {}) {
      const rows = options.includeArchived ? qListAllBots.all() : qListActiveBots.all();
      return rows.map(mapBot);
    },
    nextSortOrder() {
      const max = qMaxSort.get()?.max_order;
      return typeof max === "number" ? max + 1 : 0;
    },
    updateBot(id, patch) {
      const current = qGetBot.get(id);
      if (!current) return undefined;
      const now = new Date().toISOString();
      const next = {
        name: patch.name ?? current.name,
        instructions: patch.instructions ?? current.instructions,
        project_id: patch.projectId ?? current.project_id,
        appearance_json: patch.appearance ? JSON.stringify(patch.appearance) : current.appearance_json,
        permission_mode: patch.permissionMode === undefined ? current.permission_mode : patch.permissionMode,
        max_concurrent_workers: patch.maxConcurrentWorkers === undefined ? current.max_concurrent_workers : patch.maxConcurrentWorkers,
        router_model_json: patch.routerModel === undefined ? current.router_model_json : (patch.routerModel ? JSON.stringify(patch.routerModel) : null),
        worker_model_json: patch.workerModel === undefined ? current.worker_model_json : (patch.workerModel ? JSON.stringify(patch.workerModel) : null),
        sort_order: patch.sortOrder ?? current.sort_order,
        memory_mode: patch.memoryMode ?? current.memory_mode,
        last_visited_at: patch.lastVisitedAt === undefined ? current.last_visited_at : patch.lastVisitedAt,
        archived_at: patch.archivedAt === undefined ? current.archived_at : patch.archivedAt,
      };
      db.query(`
        UPDATE bots SET
          name = ?, instructions = ?, project_id = ?, appearance_json = ?,
          permission_mode = ?, max_concurrent_workers = ?, router_model_json = ?, worker_model_json = ?,
          sort_order = ?, memory_mode = ?, last_visited_at = ?, archived_at = ?, updated_at = ?
        WHERE id = ?
      `).run(
        next.name,
        next.instructions,
        next.project_id,
        next.appearance_json,
        next.permission_mode,
        next.max_concurrent_workers,
        next.router_model_json,
        next.worker_model_json,
        next.sort_order,
        next.memory_mode,
        next.last_visited_at,
        next.archived_at,
        now,
        id,
      );
      const updated = qGetBot.get(id);
      return updated ? mapBot(updated) : undefined;
    },
    reorderBots(ids) {
      const stmt = db.query("UPDATE bots SET sort_order = ?, updated_at = ? WHERE id = ?");
      const now = new Date().toISOString();
      const run = db.transaction(() => {
        ids.forEach((id, index) => stmt.run(index, now, id));
      });
      run();
    },
    deleteBot(id) {
      const res = qDeleteBot.run(id);
      return res.changes > 0;
    },
    ensureThread(input) {
      const existing = qGetThread.get(input.id);
      if (existing) return mapThread(existing);
      const now = new Date().toISOString();
      qInsertThread.run(
        input.id,
        input.botId,
        input.channel ?? "desktop-app",
        input.externalKey ?? null,
        input.title ?? "",
        JSON.stringify(input.metadata ?? {}),
        now,
        now,
      );
      return {
        id: input.id,
        botId: input.botId,
        channel: input.channel ?? "desktop-app",
        ...(input.externalKey ? { externalKey: input.externalKey } : {}),
        title: input.title ?? "",
        status: "active",
        metadata: input.metadata ?? {},
        createdAt: now,
        updatedAt: now,
      };
    },
    getThread(id) {
      const row = qGetThread.get(id);
      return row ? mapThread(row) : undefined;
    },
    savePayload(botId, id, content) {
      qSavePayload.run(id, botId, content, new Date().toISOString());
    },
    getPayload(botId, id) {
      return qGetPayload.get(botId, id)?.content;
    },
    insertTrigger(trigger) {
      const run = db.transaction(() => {
        if (trigger.idempotencyKey) {
          const existing = qGetTriggerByKey.get(trigger.idempotencyKey);
          if (existing) return { inserted: false, trigger: mapTrigger(existing) };
        }
        qInsertTrigger.run(
          trigger.id,
          trigger.botId,
          trigger.threadId,
          trigger.source,
          trigger.kind,
          trigger.priority,
          trigger.idempotencyKey ?? null,
          trigger.actor,
          trigger.summary,
          trigger.payloadRef ?? null,
          trigger.status,
          trigger.createdAt,
          trigger.processedAt ?? null,
        );
        qTouchThread.run(trigger.createdAt, trigger.threadId);
        return { inserted: true, trigger };
      });
      return run();
    },
    getTrigger(botId, id) {
      const row = qGetTrigger.get(botId, id);
      return row ? mapTrigger(row) : undefined;
    },
    listPendingTriggers(botId, limit = 12) {
      return qPendingTriggers.all(botId, limit).map(mapTrigger);
    },
    countPendingTriggers(botId) {
      return qCountPending.get(botId)?.count ?? 0;
    },
    listRecentThreadTriggers(botId, threadId, limit = 10) {
      return qThreadTriggers.all(botId, threadId, limit).map(mapTrigger).reverse();
    },
    markTriggersStatus(ids, status) {
      if (!ids.length) return;
      const now = status === "processed" || status === "routed_fast" || status === "dropped" ? new Date().toISOString() : null;
      const stmt = db.query("UPDATE bot_triggers SET status = ?, processed_at = COALESCE(?, processed_at) WHERE id = ?");
      const run = db.transaction(() => {
        for (const id of ids) stmt.run(status, now, id);
      });
      run();
    },
    createTask(task) {
      qInsertTask.run(
        task.id,
        task.botId,
        task.shortId,
        task.title,
        task.goal,
        task.projectId,
        task.workspaceRoot,
        task.accessMode,
        task.isolationMode,
        task.worktreePath ?? null,
        task.worktreeBranch ?? null,
        task.baseCommit ?? null,
        task.mainRepoDirtyAtStart ? 1 : 0,
        task.worktreeState,
        task.diffArtifactRef ?? null,
        task.workerSessionId,
        task.workerModelId,
        task.status,
        task.resultSummary ?? null,
        task.originTriggerId ?? null,
        task.createdAt,
        task.updatedAt,
        task.finishedAt ?? null,
      );
      return task;
    },
    updateTask(id, patch) {
      const current = qGetTask.get(id);
      if (!current) return undefined;
      const now = new Date().toISOString();
      const next = {
        title: patch.title ?? current.title,
        status: patch.status ?? current.status,
        isolation_mode: patch.isolationMode ?? current.isolation_mode,
        worktree_path: patch.worktreePath === undefined ? current.worktree_path : patch.worktreePath,
        worktree_branch: patch.worktreeBranch === undefined ? current.worktree_branch : patch.worktreeBranch,
        base_commit: patch.baseCommit === undefined ? current.base_commit : patch.baseCommit,
        main_repo_dirty_at_start: patch.mainRepoDirtyAtStart === undefined ? current.main_repo_dirty_at_start : (patch.mainRepoDirtyAtStart ? 1 : 0),
        worktree_state: patch.worktreeState ?? current.worktree_state,
        diff_artifact_ref: patch.diffArtifactRef === undefined ? current.diff_artifact_ref : patch.diffArtifactRef,
        result_summary: patch.resultSummary === undefined ? current.result_summary : patch.resultSummary,
        finished_at: patch.finishedAt === undefined ? current.finished_at : patch.finishedAt,
      };
      db.query(`
        UPDATE bot_tasks SET
          title = ?, status = ?, isolation_mode = ?, worktree_path = ?, worktree_branch = ?,
          base_commit = ?, main_repo_dirty_at_start = ?, worktree_state = ?, diff_artifact_ref = ?,
          result_summary = ?, updated_at = ?, finished_at = ?
        WHERE id = ?
      `).run(
        next.title,
        next.status,
        next.isolation_mode,
        next.worktree_path,
        next.worktree_branch,
        next.base_commit,
        next.main_repo_dirty_at_start,
        next.worktree_state,
        next.diff_artifact_ref,
        next.result_summary,
        now,
        next.finished_at,
        id,
      );
      const updated = qGetTask.get(id);
      return updated ? mapTask(updated) : undefined;
    },
    getTask(id) {
      const row = qGetTask.get(id);
      return row ? mapTask(row) : undefined;
    },
    getTaskByShortId(shortId) {
      const row = qGetTaskByShort.get(shortId);
      return row ? mapTask(row) : undefined;
    },
    listTasksByBot(botId, limit = 100) {
      return qListTasksByBot.all(botId, limit).map(mapTask);
    },
    listAllTasks(limit = 500) {
      return qListAllTasks.all(limit).map(mapTask);
    },
    listUnmergedWorktreeTasks(botId) {
      return qUnmergedWorktrees.all(botId).map(mapTask);
    },
    markRunningTasksInterrupted() {
      const run = db.transaction(() => {
        const rows = qRunningTasks.all();
        if (!rows.length) return [];
        const now = new Date().toISOString();
        const stmt = db.query("UPDATE bot_tasks SET status = 'interrupted', updated_at = ?, finished_at = ? WHERE id = ?");
        for (const row of rows) stmt.run(now, now, row.id);
        return rows.map(row => mapTask({ ...row, status: "interrupted", updated_at: now, finished_at: now }));
      });
      return run();
    },
    subscribeThread(botId, threadId, taskId) {
      if (!qGetThread.get(threadId)) {
        const now = new Date().toISOString();
        qInsertThread.run(threadId, botId, "desktop-app", null, "", "{}", now, now);
      }
      qSubscribe.run(threadId, taskId, new Date().toISOString());
    },
    unsubscribeThread(threadId, taskId) {
      qUnsubscribe.run(threadId, taskId);
    },
    listSubscribedTasks(botId, threadId) {
      return qSubscribedTasks.all(botId, threadId).map(mapTask);
    },
    addLink(botId, fromId, toId, relation) {
      qAddLink.run(botId, fromId, toId, relation, new Date().toISOString());
    },
    getLinks(botId, objectId) {
      return qGetLinks.all(botId, objectId, objectId).map(mapLink);
    },
    close() {
      db.close();
    },
  };
}
