import type { ResolvedBotsGlobalConfig } from "./config-resolver";
import type { PublishBotTriggerInput, PublishBotTriggerResult } from "./event-bus";
import type { BotsStore } from "./store";
import type { BotWorkerPool } from "./worker-pool";
import { pruneOrphanWorktrees } from "./worktree-manager";

export interface BotsWatchdogOptions {
  store: BotsStore;
  workerPool: BotWorkerPool;
  publishBotTrigger: (botId: string, input: PublishBotTriggerInput) => Promise<PublishBotTriggerResult | undefined>;
  resolveGlobalConfig: () => Promise<ResolvedBotsGlobalConfig>;
  getRepoRoots: () => string[];
  intervalMs?: number;
  softTaskTimeoutMs?: number;
  approvalTimeoutMs?: number;
}

export interface BotsWatchdog {
  runOnce(): Promise<{ alerts: number; prunedWorktrees: number }>;
  stop(): void;
}

export function createBotsWatchdog(options: BotsWatchdogOptions): BotsWatchdog {
  const intervalMs = options.intervalMs ?? 30_000;
  const softTaskTimeoutMs = options.softTaskTimeoutMs ?? 30 * 60_000;
  const approvalTimeoutMs = options.approvalTimeoutMs ?? 15 * 60_000;
  let running = false;
  let stopped = false;

  async function runOnce(): Promise<{ alerts: number; prunedWorktrees: number }> {
    if (running || stopped) return { alerts: 0, prunedWorktrees: 0 };
    running = true;
    let alerts = 0;
    let prunedWorktrees = 0;
    try {
      const now = Date.now();
      for (const metric of options.workerPool.getActiveMetrics()) {
        const task = options.store.getTask(metric.taskId);
        if (!task) continue;
        if (metric.approvalId && metric.approvalCreatedAt && now - metric.approvalCreatedAt >= approvalTimeoutMs) {
          const published = await options.publishBotTrigger(metric.botId, {
            source: "watchdog",
            kind: "watchdog.approval_timeout",
            priority: "normal",
            idempotencyKey: `wd:approval:${metric.approvalId}`,
            actor: "watchdog",
            text: `Task ${task.shortId} (${task.title}) has been waiting for approval for more than ${Math.round(approvalTimeoutMs / 60_000)} minute(s).`,
            relatedIds: [task.id],
          });
          if (published?.inserted) alerts++;
        }
        if (now - metric.startedAt >= softTaskTimeoutMs) {
          const published = await options.publishBotTrigger(metric.botId, {
            source: "watchdog",
            kind: "watchdog.task_timeout",
            priority: "normal",
            idempotencyKey: `wd:timeout:${task.id}`,
            actor: "watchdog",
            text: `Task ${task.shortId} (${task.title}) has been running for more than ${Math.round(softTaskTimeoutMs / 60_000)} minute(s). Consider checking progress or steering it.`,
            relatedIds: [task.id],
          });
          if (published?.inserted) alerts++;
        }
      }

      // Safely prune only non-protected worktrees under worktreeRoot.
      const tasks = options.store.listAllTasks(1000);
      const protectedPaths = new Set<string>();
      for (const task of tasks) {
        if (!task.worktreePath) continue;
        const keep = task.status === "queued"
          || task.status === "running"
          || task.status === "awaiting_approval"
          || task.status === "interrupted"
          || task.worktreeState === "active"
          || task.worktreeState === "ready_for_review"
          || task.worktreeState === "merged";
        if (keep) protectedPaths.add(task.worktreePath);
      }
      const config = await options.resolveGlobalConfig();
      const repoRoots = options.getRepoRoots();
      if (repoRoots.length > 0) {
        prunedWorktrees = await pruneOrphanWorktrees(repoRoots, protectedPaths, config.worktreeRoot).catch(() => 0);
      }
    } finally {
      running = false;
    }
    return { alerts, prunedWorktrees };
  }

  const timer = setInterval(() => { void runOnce(); }, intervalMs);
  timer.unref?.();

  return {
    runOnce,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
