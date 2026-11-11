import {
  answerApproval, cancelRequest, getSession, listSessions, searchSessions, sendRequest, sessionPath, setPermissionMode, updateQueue,
} from "@/features/sessions/api";
import { subscribeSnapshots } from "@/features/sessions/stream";
import type { SessionGateway } from "@/features/sessions/application/session-gateway";

// Keep the existing HTTP protocol in one place while application code consumes
// capabilities instead of endpoint paths and fetch/SSE implementations.
export const httpSessionGateway: SessionGateway = {
  list: listSessions,
  get: getSession,
  search: searchSessions,
  send: sendRequest,
  cancel: cancelRequest,
  updateQueue,
  answerApproval,
  setPermissionMode,
  subscribeIndex: (receive, signal) => subscribeSnapshots("/api/events", receive, signal),
  subscribeSession: (id, receive, signal, connection) =>
    subscribeSnapshots(`${sessionPath(id)}/events`, receive, signal, connection),
};
