import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import type { SessionInfo, SessionView } from "./api";
import { sessionKeys } from "./application/session-cache";
import { useSessionGateway } from "./application/session-gateway-provider";
import { getSessionStreams } from "./application/session-streams";
import { SessionNotifications } from "./application/session-notifications";

export function useSessionNotifications() {
  const client = useQueryClient();
  const gateway = useSessionGateway();
  const navigate = useNavigate();
  useEffect(() => {
    const desktop = window.alphacodeDesktop;
    if (!desktop?.notify) return;
    const notifications = new SessionNotifications();
    const streams = getSessionStreams(client, gateway);
    const subscriptions = new Map<string, () => void>();
    const receive = (view: SessionView) => {
      const kind = notifications.receive(view);
      if (kind) desktop.notify?.({ sessionId: view.session.id, title: view.session.title, kind });
    };
    // Existing history establishes a baseline; opening the app must not alert for old completions.
    for (const query of client.getQueryCache().findAll({ queryKey: ["session"] })) {
      if (query.state.data) notifications.receive(query.state.data as SessionView);
    }
    let syncing = false;
    const watchRunning = () => {
      if (syncing) return;
      syncing = true;
      try {
        const sessions = client.getQueryData<SessionInfo[]>(sessionKeys.list) ?? [];
        const running = new Set(sessions.filter(session => session.status === "running").map(session => session.id));
        for (const query of client.getQueryCache().findAll({ queryKey: ["session"] })) {
          const view = query.state.data as SessionView | undefined;
          if (view?.state.busy) running.add(view.session.id);
        }
        for (const id of running) {
          if (!subscriptions.has(id)) subscriptions.set(id, streams.subscribe(id, () => undefined));
        }
        for (const [id, unsubscribe] of subscriptions) {
          if (!running.has(id)) {
            unsubscribe();
            subscriptions.delete(id);
          }
        }
      } finally { syncing = false; }
    };
    const unsubscribeCache = client.getQueryCache().subscribe(event => {
      if (event.type !== "updated" || event.action.type !== "success") return;
      if (event.query.queryKey[0] === "session" && event.query.state.data) receive(event.query.state.data as SessionView);
      if (event.query.queryKey[0] === "sessions" || event.query.queryKey[0] === "session") watchRunning();
    });
    watchRunning();
    const unsubscribeClick = desktop.onNotificationClick?.(id => {
      void navigate(`/?session=${encodeURIComponent(id)}`);
    });
    return () => {
      unsubscribeCache();
      unsubscribeClick?.();
      subscriptions.forEach(unsubscribe => unsubscribe());
    };
  }, [client, gateway, navigate]);
}
