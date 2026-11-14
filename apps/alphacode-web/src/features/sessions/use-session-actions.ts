import { useEffect, useSyncExternalStore } from "react";
import { useTranslation } from "@/i18n/react";
import type { PermissionMode, SessionView } from "@/features/sessions/api";
import { useSharedWorkspace } from "./workspace-state";
import { presentActionError } from "@/features/sessions/presentation/errors";

export function useSessionActions(view: SessionView | undefined, selectedId: string) {
  const { t } = useTranslation();
  const { commands } = useSharedWorkspace();
  const state = useSyncExternalStore(commands.subscribe, () => commands.getState(selectedId));
  const canRefresh = useSyncExternalStore(commands.subscribe, commands.canRefresh);

  useEffect(() => { commands.observe(view); }, [commands, view]);

  return {
    canRefresh,
    send: (id: string, input: string) => commands.send(id, input),
    error: presentActionError(t, state.error),
    pending: state.pending,
    controlling: state.controlling,
    permissionSaving: Boolean(state.permissionSaving),
    setPermissionMode: (id: string, mode: PermissionMode) => commands.setPermissionMode(id, mode),
    retry: () => { void commands.retry(selectedId); },
    cancel: () => { void commands.control(selectedId, view, "cancel"); },
    cancelQueued: (requestId: string) => { void commands.cancelQueued(selectedId, requestId); },
    editQueued: (requestId: string, input: string, expectedInput: string) => commands.updateQueue(selectedId, { action: "edit", requestId, input, expectedInput }),
    moveQueued: (requestId: string, beforeRequestId: string | null) => commands.updateQueue(selectedId, { action: "move", requestId, beforeRequestId }),
    steerQueued: (requestId: string) => commands.updateQueue(selectedId, { action: "steer", requestId }),
    approve: (allow: boolean) => { void commands.control(selectedId, view, "approval", allow); },
  };
}
