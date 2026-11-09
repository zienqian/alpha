import { useTranslation } from "@/i18n/react";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { actionErrorMessage, answerApproval, cancelRequest, getSession, sendRequest, SessionApiError, type SessionView } from "@/features/sessions/api";

export interface PendingRequest { requestId: string; input: string; sequence: number; instanceId?: string; status: "sending" | "uncertain" | "accepted" }

export function useSessionActions(view: SessionView | undefined, selectedId: string,
  onAccepted: (id: string, input: string) => void) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const requests = useRef(new Map<string, PendingRequest>());
  const locks = useRef(new Set<string>());
  const controlLocks = useRef(new Set<string>());
  const [pending, setPending] = useState<Record<string, PendingRequest | undefined>>({});
  const [errors, setErrors] = useState<Record<string, { cause?: unknown; kind?: "interrupted" | "uncertain" } | undefined>>({});
  const [controls, setControls] = useState<Record<string, boolean>>({});
  const error = (id: string, text?: { cause?: unknown; kind?: "interrupted" | "uncertain" }) => setErrors(previous => ({ ...previous, [id]: text }));
  function update(id: string, request?: PendingRequest) {
    if (request) requests.current.set(id, request);
    else requests.current.delete(id);
    setPending(previous => ({ ...previous, [id]: request }));
  }
  async function refresh(id: string) {
    const next = await getSession(id, AbortSignal.timeout(15_000));
    client.setQueryData<SessionView>(["session", id], previous =>
      previous?.instanceId === next.instanceId && previous.sequence > next.sequence ? previous : next);
  }
  useEffect(() => {
    if (!view) return;
    const request = requests.current.get(view.session.id);
    if (request?.status === "accepted" && (view.instanceId !== request.instanceId || view.sequence > request.sequence)) {
      requests.current.delete(view.session.id);
      setPending(previous => ({ ...previous, [view.session.id]: undefined }));
    }
  }, [view]);

  async function send(id: string, input: string) {
    if (locks.current.has(id)) return;
    const previous = requests.current.get(id);
    if (previous && previous.status !== "uncertain") return;
    const current = client.getQueryData<SessionView>(["session", id]);
    const request: PendingRequest = previous ?? {
      requestId: crypto.randomUUID(), input, sequence: current?.sequence ?? -1,
      instanceId: current?.instanceId, status: "sending",
    };
    locks.current.add(id);
    update(id, { ...request, status: "sending" });
    error(id);
    try {
      const receipt = await sendRequest(id, request.requestId, request.input);
      if (receipt.status === "interrupted") {
        update(id);
        error(id, { kind: "interrupted" });
      } else {
        onAccepted(id, request.input);
        const latest = client.getQueryData<SessionView>(["session", id]);
        update(id, latest && (latest.instanceId !== request.instanceId || latest.sequence > request.sequence)
          ? undefined : { ...request, status: "accepted" });
      }
      void refresh(id).catch(() => undefined);
      void client.invalidateQueries({ queryKey: ["sessions"] });
    } catch (cause) {
      // Busy may be a concurrent admission of this same ID. Keep it for retry.
      const uncertain = !(cause instanceof SessionApiError) || cause.status >= 500 || cause.code === "SESSION_BUSY";
      update(id, uncertain ? { ...request, status: "uncertain" } : undefined);
      error(id, { cause, kind: uncertain ? "uncertain" : undefined });
      void refresh(id).catch(() => undefined);
    } finally { locks.current.delete(id); }
  }

  async function control(kind: "cancel" | "approval", allow = false) {
    if (!view?.requestId || controlLocks.current.has(selectedId)) return;
    const id = selectedId;
    controlLocks.current.add(id);
    setControls(previous => ({ ...previous, [id]: true }));
    error(id);
    try {
      if (kind === "approval") {
        if (!view.approvalId) return;
        await answerApproval(id, view.requestId, view.approvalId, allow);
      } else await cancelRequest(id, view.requestId);
    } catch (cause) { error(id, { cause }); }
    finally {
      await refresh(id).catch(() => undefined);
      controlLocks.current.delete(id);
      setControls(previous => ({ ...previous, [id]: false }));
    }
  }

  return {
    send, error: errors[selectedId] ? errors[selectedId].kind === "interrupted" ? t("errors:interrupted") : errors[selectedId].kind === "uncertain" ? t("errors:retryUncertain") : actionErrorMessage(t, errors[selectedId].cause) : undefined, pending: pending[selectedId], controlling: controls[selectedId] ?? false,
    retry: () => { const request = requests.current.get(selectedId); if (request) void send(selectedId, request.input); },
    cancel: () => void control("cancel"), approve: (allow: boolean) => void control("approval", allow),
  };
}
