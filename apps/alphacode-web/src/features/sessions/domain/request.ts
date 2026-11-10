import type { SessionView } from "@/features/sessions/api";

export interface PendingRequest {
  requestId: string;
  input: string;
  sequence: number;
  instanceId?: string;
  status: "sending" | "uncertain" | "accepted";
}

export function hasAdvanced(view: SessionView | undefined, request: PendingRequest) {
  return Boolean(view && (view.instanceId !== request.instanceId || view.sequence > request.sequence));
}

export function latestSnapshot(previous: SessionView | undefined, next: SessionView): SessionView {
  return previous?.instanceId === next.instanceId && previous.sequence > next.sequence ? previous : next;
}
