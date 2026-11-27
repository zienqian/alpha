import type { SessionView } from "../api";

export type SessionNotificationKind = "completed" | "approval" | "failed";

// Remember accepted snapshots so reconnects and command refreshes cannot repeat alerts.
export class SessionNotifications {
  private snapshots = new Map<string, SessionView>();

  receive(view: SessionView): SessionNotificationKind | undefined {
    const previous = this.snapshots.get(view.session.id);
    if (previous?.instanceId === view.instanceId && previous.sequence >= view.sequence) return;
    this.snapshots.set(view.session.id, view);
    if (view.state.approval && view.approvalId && (previous?.instanceId !== view.instanceId || previous.approvalId !== view.approvalId)) return "approval";
    if (!previous || previous.instanceId !== view.instanceId) return;
    const completion = view.state.messages.at(-1)?.completion;
    const priorCompletion = previous.state.messages.at(-1)?.completion;
    const finished = previous.state.busy && !view.state.busy;
    const newCompletion = completion && completion.completedAt !== priorCompletion?.completedAt;
    if (!view.state.busy && (finished || newCompletion)) {
      const status = completion?.status ?? view.state.lastRunStatus;
      if (status === "completed") return "completed";
      if (status === "failed" || status === "blocked") return "failed";
    }
  }
}
