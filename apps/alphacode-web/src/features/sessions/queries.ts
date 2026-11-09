import { useEffect, useState } from "react";
import { replaceEqualDeep, skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSession, listSessions, sessionPath, SessionApiError, type SessionView } from "@/features/sessions/api";
import { subscribeSnapshots, type ConnectionStatus } from "@/features/sessions/stream";

// Polling remains a fallback for the index and disconnected sessions.
const refreshInterval = 15_000;
const retry = (failures: number, error: Error) =>
  failures < 1 && !(error instanceof SessionApiError && error.status < 500);

export function useSessionsQuery() {
  const client = useQueryClient();
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let revision = "";
    void subscribeSnapshots<{ instanceId: string; sequence: number }>("/api/events", (event) => {
      const next = `${event.instanceId}:${event.sequence}`;
      if (next === revision) return;
      revision = next;
      // Token streams can publish many snapshots per second. Coalesce list GETs.
      timer ??= setTimeout(() => {
        timer = undefined;
        void client.invalidateQueries({ queryKey: ["sessions"] });
      }, 500);
    }, abort.signal);
    return () => { abort.abort(); clearTimeout(timer); };
  }, [client]);
  return useQuery({
    queryKey: ["sessions"], queryFn: ({ signal }) => listSessions(signal), retry,
    refetchInterval: refreshInterval, refetchIntervalInBackground: true,
  });
}

export function useSessionQuery(id: string | undefined) {
  const client = useQueryClient();
  const [stream, setStream] = useState<{ id?: string; status: ConnectionStatus }>({ status: "connecting" });
  const [reconnect, setReconnect] = useState(0);
  const connection = stream.id === id ? stream.status : "connecting";
  const query = useQuery({
    queryKey: ["session", id],
    queryFn: id ? ({ signal }) => getSession(id, signal) : skipToken,
    retry, refetchInterval: connection === "connected" ? false : refreshInterval,
    structuralSharing: (previous, next) => {
      const oldView = previous as SessionView | undefined;
      const nextView = next as SessionView;
      return oldView && oldView.instanceId === nextView.instanceId && oldView.sequence > nextView.sequence
        ? oldView : replaceEqualDeep(previous, next);
    },
  });
  const loaded = Boolean(query.data);
  useEffect(() => {
    setStream({ id, status: "connecting" });
    if (!id || !loaded) return;
    const abort = new AbortController();
    void subscribeSnapshots<SessionView>(`${sessionPath(id)}/events`, (view) => {
      if (view.session.id === id) client.setQueryData(["session", id], view);
    }, abort.signal, (status) => setStream({ id, status }));
    return () => abort.abort();
  }, [client, id, loaded, reconnect]);
  return { ...query, connection, refetch: (options?: Parameters<typeof query.refetch>[0]) => {
    if (connection === "error") setReconnect(previous => previous + 1);
    return query.refetch(options);
  } };
}
