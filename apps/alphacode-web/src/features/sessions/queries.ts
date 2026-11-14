import { useEffect, useState } from "react";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { shouldRetryQuery } from "@/features/sessions/domain/errors";
import { sessionKeys, shareSessionSnapshot } from "@/features/sessions/application/session-cache";
import { getSessionStreams } from "./application/session-streams";
import type { ConnectionStatus } from "@/features/sessions/application/session-gateway";
import { useSessionGateway } from "@/features/sessions/application/session-gateway-provider";
import { listProjects } from "./api";

// Polling remains a fallback for the index and disconnected sessions.
const refreshInterval = 15_000;

export function useProjectsQuery(observeOnly = false) {
  return useQuery({ queryKey: ["projects"], queryFn: ({ signal }) => listProjects(signal),
    retry: shouldRetryQuery, refetchInterval: observeOnly ? false : refreshInterval, refetchOnMount: !observeOnly, refetchOnWindowFocus: !observeOnly });
}

export function useSessionsQuery(observeOnly = false) {
  const client = useQueryClient();
  const gateway = useSessionGateway();
  useEffect(() => {
    if (observeOnly) return;
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
  }, [client, gateway, observeOnly]);
  return useQuery({
    queryKey: sessionKeys.list, queryFn: ({ signal }) => gateway.list(signal), retry: shouldRetryQuery,
    refetchInterval: observeOnly ? false : refreshInterval, refetchIntervalInBackground: true,
    refetchOnMount: !observeOnly, refetchOnWindowFocus: !observeOnly,
  });
}

export function useSessionQuery(id: string | undefined) {
  const client = useQueryClient();
  const gateway = useSessionGateway();
  const [stream, setStream] = useState<{ id?: string; status: ConnectionStatus }>({ status: "connecting" });
  const streams = getSessionStreams(client, gateway);
  const connection = stream.id === id ? stream.status : "connecting";
  const query = useQuery({
    queryKey: sessionKeys.detail(id),
    queryFn: id ? ({ signal }) => gateway.get(id, signal) : skipToken,
    retry: shouldRetryQuery, refetchInterval: connection === "connected" ? false : refreshInterval,
    structuralSharing: shareSessionSnapshot,
    refetchOnMount: false,
  });
  const loaded = Boolean(query.data);
  useEffect(() => {
    setStream({ id, status: "connecting" });
    if (!id || !loaded) return;
    return streams.subscribe(id, status => setStream(previous => previous.id === id && previous.status === status ? previous : { id, status }));
  }, [streams, id, loaded]);
  return { ...query, connection, refetch: (options?: Parameters<typeof query.refetch>[0]) => {
    if (id && connection === "error") streams.retry(id);
    return query.refetch(options);
  } };
}
