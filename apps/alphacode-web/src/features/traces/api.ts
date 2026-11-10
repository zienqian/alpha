import { useEffect, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  TracePage,
  TraceView,
  TraceStepDetail,
} from "@alpha/adk-trace/contracts";
import { SessionApiError } from "@/features/sessions/api";
import { subscribeSnapshots } from "@/features/sessions/stream";
import type { ConnectionStatus } from "@/features/sessions/application/session-gateway";

export const tracePath = (sessionId: string) =>
  `/api/sessions/${encodeURIComponent(sessionId)}/traces`;
async function read<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    signal,
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok)
    throw new SessionApiError(
      response.status,
      (await response.json().catch(() => ({}))).code ?? "TRACE_LOAD_FAILED",
    );
  if (!response.headers.get("Content-Type")?.includes("application/json"))
    throw new SessionApiError(503, "TRACE_UNAVAILABLE");
  return response.json();
}
const retry = (count: number, error: Error) =>
  count < 2 &&
  !(
    error instanceof SessionApiError &&
    [400, 401, 403, 404].includes(error.status)
  );
export function useReplyTrace(sessionId: string, replyId: string) {
  return useQuery({
    queryKey: ["traces", sessionId, "reply", replyId],
    queryFn: ({ signal }) =>
      read<{ traceId: string | null }>(
        `${tracePath(sessionId)}/by-reply?replyId=${encodeURIComponent(replyId)}`,
        signal,
      ),
    retry,
  });
}
export function useTraceList(sessionId: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ["traces", sessionId, "list"],
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: TracePage) => last.cursor,
    queryFn: ({ signal, pageParam }) =>
      read<TracePage>(
        `${tracePath(sessionId)}${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`,
        signal,
      ),
    enabled,
    retry,
    refetchInterval: enabled ? 5000 : false,
  });
}
export function useTraceSearch(
  sessionId: string,
  traceId: string,
  search: string,
  revision: number,
) {
  const [query, setQuery] = useState(search);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 200);
    return () => clearTimeout(timer);
  }, [search]);
  return useQuery({
    queryKey: ["traces", sessionId, traceId, "search", query, revision],
    enabled: !!query,
    queryFn: ({ signal }) =>
      read<{ stepIds: string[] }>(
        `${tracePath(sessionId)}/${traceId}/search?q=${encodeURIComponent(query)}`,
        signal,
      ),
    retry,
  });
}
export async function copyTrace(
  sessionId: string,
  traceId: string,
  stepIds: string[],
): Promise<{ text: string; truncated: boolean }> {
  const response = await fetch(`${tracePath(sessionId)}/${traceId}/copy`, {
    method: "POST",
    credentials: "omit",
    redirect: "error",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stepIds }),
  });
  if (!response.ok) throw new Error("TRACE_COPY_FAILED");
  return response.json();
}
export function useTraceView(sessionId: string, traceId: string) {
  const client = useQueryClient();
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined,
      last = "";
    setConnection("connecting");
    void subscribeSnapshots<{ instanceId: string; revision: number }>(
      `${tracePath(sessionId)}/events`,
      (event) => {
        const next = `${event.instanceId}:${event.revision}`;
        if (next === last) return;
        last = next;
        timer ??= setTimeout(() => {
          timer = undefined;
          void client.invalidateQueries({ queryKey: ["traces", sessionId] });
        }, 250);
      },
      abort.signal,
      setConnection,
    );
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [client, sessionId, traceId]);
  const query = useQuery({
    queryKey: ["traces", sessionId, traceId, "view"],
    queryFn: ({ signal }) =>
      read<TraceView>(`${tracePath(sessionId)}/${traceId}/view`, signal),
    retry,
    refetchInterval: connection === "connected" ? false : 5000,
  });
  return { ...query, connection };
}
export function useTraceDetail(
  sessionId: string,
  traceId: string,
  stepId: string,
  revision: number,
) {
  return useQuery({
    queryKey: ["traces", sessionId, traceId, "detail", stepId, revision],
    queryFn: ({ signal }) =>
      read<TraceStepDetail>(
        `${tracePath(sessionId)}/${traceId}/steps/${encodeURIComponent(stepId)}/detail`,
        signal,
      ),
    retry,
  });
}
