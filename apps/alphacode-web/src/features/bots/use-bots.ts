import { useEffect, useRef, useState } from "react";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ConnectionStatus } from "@/features/sessions/application/session-gateway";
import { shouldRetryQuery } from "@/features/sessions/domain/errors";
import { subscribeSnapshots } from "@/features/sessions/stream";
import {
  getBotState,
  getBotsDefaults,
  listBots,
  type BotDetailStateView,
  type BotsIndexSnapshot,
} from "./api";

const refreshInterval = 15_000;

export const botKeys = {
  all: ["bots"] as const,
  index: (includeArchived = true) => ["bots", "index", includeArchived] as const,
  detail: (botId: string | undefined) => ["bots", "detail", botId] as const,
  defaults: ["bots", "defaults"] as const,
};

export function useBotsIndex(options: { includeArchived?: boolean; enabled?: boolean } = {}) {
  const includeArchived = options.includeArchived ?? true;
  const enabled = options.enabled ?? true;
  const client = useQueryClient();
  const connectedRef = useRef(false);

  const query = useQuery({
    queryKey: botKeys.index(includeArchived),
    queryFn: enabled ? ({ signal }) => listBots(signal, includeArchived) : skipToken,
    retry: shouldRetryQuery,
    refetchInterval: () => (connectedRef.current ? false : refreshInterval),
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    const key = botKeys.index(includeArchived);
    const path = includeArchived ? "/api/bots/events?includeArchived=1" : "/api/bots/events";
    void subscribeSnapshots<BotsIndexSnapshot>(
      path,
      snapshot => {
        const current = client.getQueryData<BotsIndexSnapshot>(key);
        if (current && current.instanceId === snapshot.instanceId && current.sequence === snapshot.sequence) return;
        client.setQueryData(key, snapshot);
      },
      abort.signal,
      status => {
        connectedRef.current = status === "connected";
      },
    );
    return () => {
      connectedRef.current = false;
      abort.abort();
    };
  }, [client, enabled, includeArchived]);

  return query;
}

export function useBotDetail(botId: string | undefined) {
  const client = useQueryClient();
  const [stream, setStream] = useState<{ id?: string; status: ConnectionStatus }>({ status: "connecting" });
  const connection = stream.id === botId ? stream.status : "connecting";

  const query = useQuery({
    queryKey: botKeys.detail(botId),
    queryFn: botId ? ({ signal }) => getBotState(botId, signal) : skipToken,
    retry: shouldRetryQuery,
    refetchInterval: connection === "connected" ? false : refreshInterval,
    refetchOnMount: true,
  });

  const loaded = Boolean(query.data);

  useEffect(() => {
    setStream({ id: botId, status: "connecting" });
    if (!botId || !loaded) return;
    const abort = new AbortController();
    void subscribeSnapshots<BotDetailStateView>(
      `/api/bots/${encodeURIComponent(botId)}/events`,
      snapshot => {
        client.setQueryData(botKeys.detail(botId), snapshot);
        // Keep sidebar summary fresh immediately without waiting for index stream.
        client.setQueriesData<BotsIndexSnapshot>({ queryKey: ["bots", "index"] }, current => {
          if (!current) return current;
          const idx = current.bots.findIndex(item => item.id === snapshot.bot.id);
          if (idx < 0) return current;
          const nextBots = [...current.bots];
          nextBots[idx] = snapshot.bot;
          return { ...current, bots: nextBots };
        });
      },
      abort.signal,
      status => setStream(previous => previous.id === botId && previous.status === status ? previous : { id: botId, status }),
    );
    return () => abort.abort();
  }, [botId, client, loaded]);

  return { ...query, connection };
}

export function useBotsDefaults(enabled = true) {
  return useQuery({
    queryKey: botKeys.defaults,
    queryFn: enabled ? ({ signal }) => getBotsDefaults(signal) : skipToken,
    retry: shouldRetryQuery,
  });
}
