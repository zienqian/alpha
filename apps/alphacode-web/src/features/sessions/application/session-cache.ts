import { replaceEqualDeep, type QueryClient } from "@tanstack/react-query";
import type { SessionView } from "@/features/sessions/api";
import { latestSnapshot } from "@/features/sessions/domain/request";

export const sessionKeys = {
  list: ["sessions"] as const,
  detail: (id: string | undefined) => ["session", id] as const,
  search: (query: string) => ["session-search", query] as const,
};

// GETs, SSE and command refreshes must all use the same ordering policy.
export function shareSessionSnapshot(previous: unknown, next: unknown) {
  const current = previous as SessionView | undefined;
  const incoming = next as SessionView;
  return latestSnapshot(current, incoming) === current ? current : replaceEqualDeep(previous, next);
}

export function cacheSession(client: QueryClient, view: SessionView) {
  client.setQueryData<SessionView>(sessionKeys.detail(view.session.id), previous => latestSnapshot(previous, view));
}
