import type { SessionView } from "../api";

export type SessionNotificationKind = "completed" | "approval" | "failed";

interface SessionTrackerEntry {
  instanceId: string;
  sequence: number;
  active: boolean;
  approvalId?: string;
  lastCompletionKey?: string;
}

const attentionStatuses = new Set(["failed", "blocked", "refused", "incomplete", "limited", "unknown"]);

// A session is still running while a turn is active, settling its request journal, or has queued follow-ups.
export function isSessionActive(view: SessionView): boolean {
  return Boolean(
    view.state.busy
    || view.requestId
    || view.state.queuedRequests?.length
    || (view.state.phase && view.state.phase !== "idle"),
  );
}

function completionKey(view: SessionView): string | undefined {
  const last = view.state.messages.at(-1);
  const completion = last?.completion;
  return completion ? `${last.id}:${completion.completedAt}:${completion.status}` : undefined;
}

function activeApprovalId(view: SessionView): string | undefined {
  return view.state.busy && view.state.phase !== "stopping" && view.state.approval && view.approvalId
    ? view.approvalId
    : undefined;
}

// Remember accepted snapshots so reconnects, navigation, and command refreshes cannot repeat alerts.
export class SessionNotifications {
  private entries = new Map<string, SessionTrackerEntry>();

  seed(view: SessionView): void {
    this.receive(view, { baseline: true });
  }

  receive(view: SessionView, options?: { baseline?: boolean }): SessionNotificationKind | undefined {
    const id = view.session.id;
    const previous = this.entries.get(id);
    if (previous?.instanceId === view.instanceId && previous.sequence >= view.sequence) return;

    const active = isSessionActive(view);
    const approvalId = activeApprovalId(view);
    const nextCompletionKey = completionKey(view);

    if (!previous || previous.instanceId !== view.instanceId) {
      this.entries.set(id, {
        instanceId: view.instanceId,
        sequence: view.sequence,
        active,
        approvalId,
        lastCompletionKey: nextCompletionKey,
      });
      if (!options?.baseline && approvalId) return "approval";
      return;
    }

    const hadApproval = previous.approvalId;
    const previousCompletionKey = previous.lastCompletionKey;
    const settledCompletionKey = !active ? nextCompletionKey : undefined;

    this.entries.set(id, {
      instanceId: view.instanceId,
      sequence: view.sequence,
      active,
      approvalId,
      lastCompletionKey: settledCompletionKey ?? previousCompletionKey,
    });

    if (options?.baseline) return;
    if (approvalId && approvalId !== hadApproval) return "approval";

    if (!active && settledCompletionKey && settledCompletionKey !== previousCompletionKey) {
      const status = view.state.messages.at(-1)?.completion?.status;
      if (status === "cancelled") return;
      if (view.session.status === "blocked" || (status && attentionStatuses.has(status))) return "failed";
      if (status === "completed") return "completed";
    }
  }
}
