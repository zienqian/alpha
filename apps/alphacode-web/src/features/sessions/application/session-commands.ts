import type { PermissionMode, QueueAction, SessionView } from "@/features/sessions/api";
import { isUncertainSubmission, type SessionActionError } from "@/features/sessions/domain/errors";
import { hasAdvanced, type PendingRequest } from "@/features/sessions/domain/request";
import type { SessionGateway } from "./session-gateway";

export interface SessionCommandState {
  pending?: PendingRequest;
  error?: SessionActionError;
  controlling: boolean;
  permissionSaving?: boolean;
}

export interface SessionCommandCache {
  get(id: string): SessionView | undefined;
  write(view: SessionView): void;
  invalidateList(): void;
}

const emptyState: SessionCommandState = { controlling: false };

// Owns admission/retry and control lifecycles. React only subscribes to state;
// transport and cache implementations are supplied by the composition layer.
export class SessionCommands {
  private readonly states = new Map<string, SessionCommandState>();
  private readonly sending = new Set<string>();
  private readonly controlling = new Set<string>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly gateway: Pick<SessionGateway, "get" | "send" | "cancel" | "answerApproval" | "setPermissionMode" | "updateQueue">,
    private readonly cache: SessionCommandCache,
    private readonly onAccepted: (id: string, input: string) => void,
  ) {}

  getState = (id: string): SessionCommandState => this.states.get(id) ?? emptyState;
  canRefresh = () => ![...this.states.values()].some(state => state.controlling || state.pending?.status === "sending" || state.pending?.status === "uncertain");

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private update(id: string, patch: Partial<SessionCommandState>) {
    this.states.set(id, { ...this.getState(id), ...patch });
    for (const listener of this.listeners) listener();
  }

  observe(view: SessionView | undefined) {
    if (!view) return;
    const request = this.getState(view.session.id).pending;
    if (request?.status === "accepted" && hasAdvanced(view, request)) {
      this.update(view.session.id, { pending: undefined });
    }
  }

  private async refresh(id: string) {
    const view = await this.gateway.get(id, AbortSignal.timeout(15_000));
    this.cache.write(view);
    this.observe(this.cache.get(id));
  }

  async send(id: string, input: string) {
    if (this.sending.has(id) || this.controlling.has(id)) return;
    const previous = this.getState(id).pending;
    if (previous && previous.status !== "uncertain") return;
    const current = this.cache.get(id);
    const request: PendingRequest = previous ?? {
      requestId: crypto.randomUUID(), input, sequence: current?.sequence ?? -1,
      instanceId: current?.instanceId, status: "sending",
    };
    this.sending.add(id);
    this.update(id, { pending: { ...request, status: "sending" }, error: undefined });
    try {
      const receipt = await this.gateway.send(id, request.requestId, request.input);
      if (receipt.status === "interrupted") {
        this.update(id, { pending: undefined, error: { kind: "interrupted" } });
      } else {
        this.onAccepted(id, request.input);
        this.update(id, { pending: hasAdvanced(this.cache.get(id), request)
          ? undefined : { ...request, status: "accepted" } });
      }
      void this.refresh(id).catch(() => undefined);
      this.cache.invalidateList();
    } catch (cause) {
      const uncertain = isUncertainSubmission(cause);
      this.update(id, {
        pending: uncertain ? { ...request, status: "uncertain" } : undefined,
        error: { cause, kind: uncertain ? "uncertain" : undefined },
      });
      void this.refresh(id).catch(() => undefined);
    } finally {
      this.sending.delete(id);
    }
  }

  retry(id: string) {
    const request = this.getState(id).pending;
    if (request?.status === "uncertain") return this.send(id, request.input);
  }

  async cancelQueued(id: string, requestId: string) {
    if (this.controlling.has(id) || !this.cache.get(id)?.state.queuedRequests?.some(item => item.requestId === requestId)) return;
    this.controlling.add(id);
    this.update(id, { controlling: true, error: undefined });
    try {
      await this.gateway.cancel(id, requestId, true);
    } catch (cause) {
      this.update(id, { error: { cause } });
    } finally {
      await this.refresh(id).catch(() => undefined);
      this.controlling.delete(id);
      this.update(id, { controlling: false });
    }
  }

  async updateQueue(id: string, action: QueueAction): Promise<boolean> {
    if (this.controlling.has(id)) return false;
    this.controlling.add(id);
    this.update(id, { controlling: true, error: undefined });
    try {
      this.cache.write(await this.gateway.updateQueue(id, action));
      return true;
    } catch (cause) {
      this.update(id, { error: { cause } });
      await this.refresh(id).catch(() => undefined);
      return false;
    } finally {
      this.controlling.delete(id);
      this.update(id, { controlling: false });
    }
  }

  async setPermissionMode(id: string, mode: PermissionMode): Promise<boolean> {
    const view = this.cache.get(id);
    if (!view || this.controlling.has(id) || this.sending.has(id) || this.getState(id).pending
      || view.state.busy || view.state.queuedRequests?.length || view.state.closing || view.state.settingsSaving || view.state.approval || !view.state.canSend) return false;
    if (view.state.permissionMode === mode) return true;
    this.controlling.add(id);
    this.update(id, { controlling: true, permissionSaving: true, error: undefined });
    try {
      // The server snapshot is authoritative, including when SSE arrives first.
      this.cache.write(await this.gateway.setPermissionMode(id, mode));
      return this.cache.get(id)?.state.permissionMode === mode;
    } catch (cause) {
      this.update(id, { error: { cause, kind: "permission" } });
      await this.refresh(id).catch(() => undefined);
      return false;
    } finally {
      this.controlling.delete(id);
      this.update(id, { controlling: false, permissionSaving: false });
    }
  }

  async control(id: string, view: SessionView | undefined, kind: "cancel" | "approval", allow = false) {
    if (view?.session.id !== id || !view.requestId || this.controlling.has(id)) return;
    if (kind === "approval" && !view.approvalId) return;
    this.controlling.add(id);
    this.update(id, { controlling: true, error: undefined });
    try {
      if (kind === "approval" && view.approvalId) {
        await this.gateway.answerApproval(id, view.requestId, view.approvalId, allow);
      } else {
        await this.gateway.cancel(id, view.requestId);
      }
    } catch (cause) {
      this.update(id, { error: { cause } });
    } finally {
      await this.refresh(id).catch(() => undefined);
      this.controlling.delete(id);
      this.update(id, { controlling: false });
    }
  }
}
