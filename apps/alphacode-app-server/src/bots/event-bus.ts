import { randomUUID } from "node:crypto";
import type {
  BotTaskRecord,
  BotTriggerPriority,
  BotTriggerRecord,
  BotTriggerSource,
} from "./contracts";
import type { BotsStore } from "./store";

const inlineSummaryLimit = 280;

export function botMainThreadId(botId: string): string {
  return `thr_main:${botId}`;
}

export interface PublishBotTriggerInput {
  threadId?: string;
  source: BotTriggerSource;
  kind: string;
  priority?: BotTriggerPriority;
  idempotencyKey?: string;
  actor: string;
  text: string;
  payloadRef?: string;
  relatedIds?: readonly string[];
  allowFastPath?: boolean;
}

export interface PublishBotTriggerResult {
  inserted: boolean;
  trigger: BotTriggerRecord;
  route: "duplicate" | "fast_path" | "router";
  routedTaskIds?: readonly string[];
}

export interface BotEventBus {
  readonly mainThreadId: string;
  publish(input: PublishBotTriggerInput): Promise<PublishBotTriggerResult>;
}

function summarizeInline(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= inlineSummaryLimit) return compact;
  return `${compact.slice(0, inlineSummaryLimit - 1)}…`;
}

export function createBotEventBus(options: {
  botId: string;
  botName: () => string;
  store: BotsStore;
  onFastRoute?: (task: BotTaskRecord, trigger: BotTriggerRecord, fullText: string) => Promise<boolean>;
  onRouterWake?: (trigger: BotTriggerRecord) => void;
  onChanged?: () => void;
}): BotEventBus {
  const mainThread = botMainThreadId(options.botId);
  options.store.ensureThread({ id: mainThread, botId: options.botId, channel: "desktop-app", title: options.botName() });

  return {
    mainThreadId: mainThread,
    async publish(input) {
      const threadId = input.threadId ?? mainThread;
      options.store.ensureThread({
        id: threadId,
        botId: options.botId,
        channel: input.source === "external_channel" ? "external" : "desktop-app",
        title: threadId === mainThread ? options.botName() : "",
      });

      const triggerId = `trg_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
      const trimmed = input.text.trim();
      const summary = summarizeInline(trimmed);
      let payloadRef = input.payloadRef;
      if (!payloadRef && trimmed.length > inlineSummaryLimit) {
        const payloadId = `art_trg_${triggerId.slice(4)}`;
        options.store.savePayload(options.botId, payloadId, trimmed);
        payloadRef = payloadId;
      }

      const candidate: BotTriggerRecord = {
        id: triggerId,
        botId: options.botId,
        threadId,
        source: input.source,
        kind: input.kind,
        priority: input.priority ?? "normal",
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        actor: input.actor,
        summary,
        ...(payloadRef ? { payloadRef } : {}),
        status: "pending",
        createdAt: new Date().toISOString(),
      };

      const { inserted, trigger } = options.store.insertTrigger(candidate);
      if (!inserted) {
        return { inserted: false, trigger, route: "duplicate" };
      }

      options.store.addLink(options.botId, trigger.id, threadId, "belongs_to");
      if (payloadRef) options.store.addLink(options.botId, trigger.id, payloadRef, "spilled_to");
      for (const rel of input.relatedIds ?? []) {
        if (rel) options.store.addLink(options.botId, trigger.id, rel, "mentions");
      }

      // Subscription Fast Path: subscribed non-main events route straight to active Workers.
      const fastEligible = input.allowFastPath ?? (input.source === "external_channel" || input.source === "schedule");
      if (fastEligible && options.onFastRoute) {
        const subscribed = options.store.listSubscribedTasks(options.botId, threadId);
        if (subscribed.length > 0) {
          const routedTaskIds: string[] = [];
          for (const task of subscribed) {
            if (await options.onFastRoute(task, trigger, trimmed)) {
              routedTaskIds.push(task.id);
              options.store.addLink(options.botId, trigger.id, task.id, "routed_to");
            }
          }
          if (routedTaskIds.length > 0) {
            options.store.markTriggersStatus([trigger.id], "routed_fast");
            options.onChanged?.();
            return { inserted: true, trigger: { ...trigger, status: "routed_fast" }, route: "fast_path", routedTaskIds };
          }
        }
      }

      options.onChanged?.();
      options.onRouterWake?.(trigger);
      return { inserted: true, trigger, route: "router" };
    },
  };
}
