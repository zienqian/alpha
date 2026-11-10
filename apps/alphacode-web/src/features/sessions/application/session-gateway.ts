import type { RequestReceipt, SessionInfo, SessionSearchResult, SessionView } from "@/features/sessions/api";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "error";
export interface SessionIndexEvent { instanceId: string; sequence: number }

// Application capabilities, independent of URLs, fetch and stream framing.
// Subscriptions live until their signal aborts or the connection becomes terminal.
export interface SessionGateway {
  list(signal: AbortSignal): Promise<SessionInfo[]>;
  get(id: string, signal: AbortSignal): Promise<SessionView>;
  search(query: string, signal: AbortSignal): Promise<SessionSearchResult[]>;
  send(id: string, requestId: string, input: string): Promise<RequestReceipt>;
  cancel(id: string, requestId: string): Promise<unknown>;
  answerApproval(id: string, requestId: string, approvalId: string, allow: boolean): Promise<unknown>;
  subscribeIndex(receive: (event: SessionIndexEvent) => void, signal: AbortSignal): Promise<void>;
  subscribeSession(id: string, receive: (view: SessionView) => void, signal: AbortSignal,
    connection: (status: ConnectionStatus) => void): Promise<void>;
}
