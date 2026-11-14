import type { QueryClient } from "@tanstack/react-query";
import type { ConnectionStatus, SessionGateway } from "./session-gateway";
import { cacheSession } from "./session-cache";

type Listener = (status: ConnectionStatus) => void;
type Entry = { abort: AbortController; status: ConnectionStatus; listeners: Set<Listener> };
const registries = new WeakMap<QueryClient, WeakMap<SessionGateway, SessionStreams>>();

// Query observers share snapshots; this registry also shares the transport.
export class SessionStreams {
  private entries = new Map<string, Entry>();
  constructor(private client: QueryClient, private gateway: SessionGateway) {}
  private start(id: string, entry: Entry) {
    entry.status = "connecting";
    entry.listeners.forEach(listener => listener(entry.status));
    const signal = entry.abort.signal;
    void this.gateway.subscribeSession(id, view => {
      if (!signal.aborted && view.session.id === id) cacheSession(this.client, view);
    }, signal, status => {
      if (signal.aborted) return;
      entry.status = status;
      entry.listeners.forEach(listener => listener(status));
    });
  }
  subscribe(id: string, listener: Listener) {
    let entry = this.entries.get(id);
    if (!entry) {
      entry = { abort: new AbortController(), status: "connecting", listeners: new Set() };
      this.entries.set(id, entry);
      this.start(id, entry);
    }
    entry.listeners.add(listener);
    listener(entry.status);
    return () => {
      entry.listeners.delete(listener);
      if (entry.listeners.size === 0) { entry.abort.abort(); this.entries.delete(id); }
    };
  }
  retry(id: string) {
    const entry = this.entries.get(id);
    if (!entry || entry.status !== "error") return;
    entry.abort.abort();
    entry.abort = new AbortController();
    this.start(id, entry);
  }
}

export function getSessionStreams(client: QueryClient, gateway: SessionGateway) {
  let gateways = registries.get(client);
  if (!gateways) { gateways = new WeakMap(); registries.set(client, gateways); }
  let streams = gateways.get(gateway);
  if (!streams) { streams = new SessionStreams(client, gateway); gateways.set(gateway, streams); }
  return streams;
}
