import { useEffect, useState } from "react";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { shouldRetryQuery } from "@/features/sessions/domain/errors";
import { cacheSession, sessionKeys, shareSessionSnapshot } from "@/features/sessions/application/session-cache";
import type { ConnectionStatus } from "@/features/sessions/application/session-gateway";
import { useSessionGateway } from "@/features/sessions/application/session-gateway-provider";
import { listProjects } from "./api";

// Polling remains a fallback for the index and disconnected sessions.
const refreshInterval = 15_000;

export function useProjectsQuery() {
  return useQuery({ queryKey: ["projects"], queryFn: ({ signal }) => listProjects(signal),
    retry: shouldRetryQuery, refetchInterval: refreshInterval });
}

export function useSessionsQuery() {
  const client = useQueryClient();
  const gateway = useSessionGateway();
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let revision = "";
    void gateway.subscribeIndex((event) => {
      const next = `${event.instanceId}:${event.sequence}`;
      if (next === revision) return;
      revision = next;
      // Token streams can publish many snapshots per second. Coalesce list GETs.
      timer ??= setTimeout(() => {
        timer = undefined;
        void client.invalidateQueries({ queryKey: sessionKeys.list });
        void client.invalidateQueries({ queryKey: ["projects"] });
      }, 500);
    }, abort.signal);
    return () => { abort.abort(); clearTimeout(timer); };
  }, [client, gateway]);
  return useQuery({
    queryKey: sessionKeys.list, queryFn: ({ signal }) => gateway.list(signal), retry: shouldRetryQuery,
    refetchInterval: refreshInterval, refetchIntervalInBackground: true,
  });
}

export function useSessionQuery(id: string | undefined) {
  const client = useQueryClient();
  const gateway = useSessionGateway();
  const [stream, setStream] = useState<{ id?: string; status: ConnectionStatus }>({ status: "connecting" });
  const [reconnect, setReconnect] = useState(0);
  const connection = stream.id === id ? stream.status : "connecting";
  const query = useQuery({
    queryKey: sessionKeys.detail(id),
    queryFn: id ? ({ signal }) => gateway.get(id, signal) : skipToken,
    retry: shouldRetryQuery, refetchInterval: connection === "connected" ? false : refreshInterval,
    structuralSharing: shareSessionSnapshot,
  });
  const loaded = Boolean(query.data);
  useEffect(() => {
    setStream({ id, status: "connecting" });
    if (!id || !loaded) return;
    const abort = new AbortController();
    void gateway.subscribeSession(id, (view) => {
      if (view.session.id === id) cacheSession(client, view);
    }, abort.signal, (status) => setStream({ id, status }));
    return () => abort.abort();
  }, [client, gateway, id, loaded, reconnect]);
  return { ...query, connection, refetch: (options?: Parameters<typeof query.refetch>[0]) => {
    if (connection === "error") setReconnect(previous => previous + 1);
    return query.refetch(options);
  } };
}
