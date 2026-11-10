import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "@/i18n/react";
import type { SessionView } from "@/features/sessions/api";
import { SessionCommands } from "@/features/sessions/application/session-commands";
import { cacheSession, sessionKeys } from "@/features/sessions/application/session-cache";
import { useSessionGateway } from "@/features/sessions/application/session-gateway-provider";
import { presentActionError } from "@/features/sessions/presentation/errors";

export function useSessionActions(view: SessionView | undefined, selectedId: string,
  onAccepted: (id: string, input: string) => void) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const gateway = useSessionGateway();
  const accepted = useRef(onAccepted);
  accepted.current = onAccepted;
  const commands = useMemo(() => new SessionCommands(gateway, {
    get: id => client.getQueryData<SessionView>(sessionKeys.detail(id)),
    write: next => cacheSession(client, next),
    invalidateList: () => { void client.invalidateQueries({ queryKey: sessionKeys.list }); },
  }, (id, input) => accepted.current(id, input)), [client, gateway]);
  const state = useSyncExternalStore(commands.subscribe, () => commands.getState(selectedId));

  useEffect(() => { commands.observe(view); }, [commands, view]);

  return {
    send: (id: string, input: string) => commands.send(id, input),
    error: presentActionError(t, state.error),
    pending: state.pending,
    controlling: state.controlling,
    retry: () => { void commands.retry(selectedId); },
    cancel: () => { void commands.control(selectedId, view, "cancel"); },
    approve: (allow: boolean) => { void commands.control(selectedId, view, "approval", allow); },
  };
}
