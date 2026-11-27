/** Claude Code 4-phase Auto-Dream + Codex Stage 2 global consolidation (Orient -> Gather -> Consolidate -> Prune). */
import {
  memoryScopeKey,
  memoryTypes,
  type MemoryTopic,
  type MemoryType,
  type Stage1Output,
  type Stage2DreamInput,
  type Stage2DreamResult,
} from "./contracts";
import { defaultMaxIndexBytes, defaultMaxIndexLines, slugifyTopic } from "./frontmatter";
import { sanitizeMemoryText } from "./sanitizer";

const dreamLeaseTtlMs = 3 * 60 * 1000;
const defaultMinIntervalHours = 24;
const defaultMinNewRollouts = 5;

interface DreamPlan {
  readonly upserts: readonly {
    readonly slug: string;
    readonly name: string;
    readonly description: string;
    readonly type: MemoryType;
    readonly body: string;
  }[];
  readonly deletes: readonly string[];
}

function buildDreamPrompt(
  existingTopics: readonly MemoryTopic[],
  pendingStage1: readonly Stage1Output[],
  nowIso: string,
): string {
  const existingView = existingTopics.map(t => ({
    slug: t.slug,
    name: t.name,
    description: t.description,
    type: t.type,
    owner: t.owner,
    locked: t.owner === "user",
    updatedAt: t.updatedAt,
    body: t.body.slice(0, 1200),
  }));
  const gatheredView = pendingStage1.map(item => ({
    sessionKey: item.sessionKey,
    rolloutPath: item.rolloutPath,
    createdAt: item.createdAt,
    takeaways: item.rawTakeaways,
  }));

  return [
    `You are running Stage 2 Auto-Dream memory consolidation at ${nowIso}.`,
    "Follow the 4 consolidation principles (Orient -> Gather -> Consolidate -> Prune):",
    "1. Merge duplicate or overlapping agent topics into crisp, non-redundant Markdown topic files.",
    "2. Resolve contradictions in favor of newer facts; convert relative dates ('yesterday', 'last week') into absolute ISO dates.",
    "3. NEVER modify or delete any topic where locked=true (owner='user'). Respect user-owned topics as immutable.",
    "4. Exclude transient debugging steps, derivable codebase facts, and secrets.",
    "Return ONLY valid JSON:",
    '  { "upserts": [{ "slug": "kebab-case", "name": "Title", "description": "1-line pointer", "type": "user|feedback|project|reference", "body": "Markdown content" }], "deletes": ["obsolete-slug"] }',
    "",
    `Existing topics (${existingView.length}):`,
    JSON.stringify(existingView),
    "",
    `Newly gathered Stage 1 outputs (${gatheredView.length}):`,
    JSON.stringify(gatheredView),
  ].join("\n");
}

function parseDreamPlan(raw: string): DreamPlan | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = (fenced?.[1] ?? raw).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const rawUpserts = Array.isArray(parsed.upserts) ? parsed.upserts : [];
    const upserts = rawUpserts
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      .map(item => {
        const slug = typeof item.slug === "string" ? slugifyTopic(item.slug) : "";
        const name = typeof item.name === "string" ? sanitizeMemoryText(item.name).text.trim().slice(0, 120) : "";
        const description = typeof item.description === "string" ? sanitizeMemoryText(item.description).text.trim().slice(0, 240) : "";
        const body = typeof item.body === "string" ? sanitizeMemoryText(item.body).text.trim().slice(0, 8000) : "";
        const type = memoryTypes.includes(item.type as MemoryType) ? (item.type as MemoryType) : ("project" as const);
        return { slug, name, description, type, body };
      })
      .filter(item => item.slug && item.name && item.description && item.body)
      .slice(0, 40);

    const rawDeletes = Array.isArray(parsed.deletes) ? parsed.deletes : [];
    const deletes = rawDeletes
      .filter((slug): slug is string => typeof slug === "string" && slug.trim().length > 0)
      .map(slug => slugifyTopic(slug))
      .slice(0, 40);

    return { upserts, deletes };
  } catch {
    return undefined;
  }
}

export async function runStage2Dream(input: Stage2DreamInput): Promise<Stage2DreamResult> {
  const nowIso = input.nowIso ?? new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const scopeKey = memoryScopeKey(input.scope);
  const jobKey = `stage2:dream:${scopeKey}`;
  const minIntervalHours = input.minIntervalHours ?? defaultMinIntervalHours;
  const minNewRollouts = input.minNewRollouts ?? defaultMinNewRollouts;

  // Gate 1 & 2 (Claude Code Auto-Dream thresholds: time + accumulated rollouts).
  const pending = input.coordinator.listPendingStage1(scopeKey, 50);
  if (!input.force) {
    if (pending.length < minNewRollouts) {
      return { status: "skipped", reason: "below_rollout_threshold", consumedRollouts: 0, upsertedTopics: [], deletedTopics: [], skippedLockedTopics: [] };
    }
    const job = input.coordinator.getJob(jobKey);
    if (job?.lastRunAt) {
      const elapsedHours = (nowMs - Date.parse(job.lastRunAt)) / (1000 * 60 * 60);
      if (elapsedHours < minIntervalHours) {
        return { status: "skipped", reason: "cooldown_active", consumedRollouts: 0, upsertedTopics: [], deletedTopics: [], skippedLockedTopics: [] };
      }
    }
  }

  // Gate 3 (Codex SQLite job lease: cross-process mutex without fragile lockfiles).
  const claimed = input.coordinator.claimJob({
    jobKey,
    kind: "stage2_dream",
    scopeKey,
    leaseOwner: input.leaseOwner,
    leaseTtlMs: dreamLeaseTtlMs,
    nowIso,
  });
  if (!claimed) {
    return { status: "busy", reason: "lease_held", consumedRollouts: 0, upsertedTopics: [], deletedTopics: [], skippedLockedTopics: [] };
  }

  try {
    input.signal.throwIfAborted();

    // Phase 1: Orient — snapshot before mutating, survey existing topics.
    const snapshotId = await input.store.snapshotScope(input.scope);
    const topicMetas = await input.store.listTopics(input.scope);
    const existingTopics: MemoryTopic[] = [];
    for (const meta of topicMetas) {
      const topic = await input.store.readTopic(input.scope, meta.slug);
      if (topic) existingTopics.push(topic);
    }

    // Phase 2: Gather — pending Stage 1 outputs already collected above.
    if (!pending.length && existingTopics.length <= 1) {
      await input.store.rebuildIndex(input.scope, {
        maxLines: input.maxIndexLines ?? defaultMaxIndexLines,
        maxBytes: input.maxIndexBytes ?? defaultMaxIndexBytes,
      });
      input.coordinator.completeJob(jobKey, input.leaseOwner, { watermark: nowIso, nowIso });
      return { status: "completed", snapshotId, consumedRollouts: 0, upsertedTopics: [], deletedTopics: [], skippedLockedTopics: [] };
    }

    // Phase 3: Consolidate — model proposes topic updates; code strictly enforces owner='user' immutability.
    const rawPlan = await input.runModel(buildDreamPrompt(existingTopics, pending, nowIso), {
      maxOutputTokens: 4096,
      signal: input.signal,
    });
    const plan = parseDreamPlan(rawPlan);
    if (!plan) {
      input.coordinator.failJob(jobKey, input.leaseOwner, "DREAM_INVALID_JSON", nowIso);
      return { status: "failed", reason: "DREAM_INVALID_JSON", snapshotId, consumedRollouts: 0, upsertedTopics: [], deletedTopics: [], skippedLockedTopics: [] };
    }

    const lockedSlugs = new Set(existingTopics.filter(t => t.owner === "user").map(t => t.slug));
    const upsertedTopics: string[] = [];
    const deletedTopics: string[] = [];
    const skippedLockedTopics: string[] = [];

    for (const item of plan.upserts) {
      if (lockedSlugs.has(item.slug)) {
        skippedLockedTopics.push(item.slug);
        continue;
      }
      await input.store.writeTopic(input.scope, {
        slug: item.slug,
        name: item.name,
        description: item.description,
        type: item.type,
        owner: "agent",
        body: item.body,
        updatedAt: nowIso.slice(0, 10),
      }, { actor: "agent" });
      upsertedTopics.push(item.slug);
    }

    for (const slug of plan.deletes) {
      if (lockedSlugs.has(slug)) {
        skippedLockedTopics.push(slug);
        continue;
      }
      const deleted = await input.store.deleteTopic(input.scope, slug, { actor: "agent" });
      if (deleted) deletedTopics.push(slug);
    }

    // Phase 4: Prune — rebuild compact MEMORY.md (<= 200 lines / 12 KiB) & mark Stage 1 consumed.
    await input.store.rebuildIndex(input.scope, {
      maxLines: input.maxIndexLines ?? defaultMaxIndexLines,
      maxBytes: input.maxIndexBytes ?? defaultMaxIndexBytes,
    });
    await input.store.syncIndex?.([input.scope]);
    if (pending.length) {
      input.coordinator.markStage1Consumed(pending.map(p => p.sessionKey), nowIso);
    }
    input.coordinator.completeJob(jobKey, input.leaseOwner, { watermark: nowIso, nowIso });
    return {
      status: "completed",
      snapshotId,
      consumedRollouts: pending.length,
      upsertedTopics,
      deletedTopics,
      skippedLockedTopics,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.coordinator.failJob(jobKey, input.leaseOwner, message, nowIso);
    return { status: "failed", reason: message, consumedRollouts: 0, upsertedTopics: [], deletedTopics: [], skippedLockedTopics: [] };
  }
}
