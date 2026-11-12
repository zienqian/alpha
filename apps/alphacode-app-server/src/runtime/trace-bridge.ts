import type { Agent, Message } from "@alpha/adk/core";
import type { Session } from "@alpha/adk-session";
import type { TraceScope, TraceService } from "@alpha/adk-trace";
import { completeToolRecord, createToolRecord } from "./tool-records";

/** App-owned read access. The observation plugin never receives writable history. */
export function createRuntimeTrace(service: TraceService) {
  const readers = new Map<string, () => readonly Message[]>();
  const key = (scope: TraceScope) =>
    JSON.stringify([scope.namespace, scope.sessionId]);
  return {
    service,
    messages(scope: TraceScope) {
      return readers.get(key(scope))?.();
    },
    bind(scope: TraceScope, agent: Agent, session: Session) {
      const read = () => agent.state.messages;
      readers.set(key(scope), read);
      const offSession = session.subscribe((event) =>
        service.recordSession(
          scope,
          event.requestId,
          event.type === "session.saved" ? "saved" : "unsaved",
        ),
      );
      const offAgent = agent.subscribe((event) => {
        if (event.type !== "tool.end") return;
        const messages = read(),
          assistant = messages.find((m) => m.id === event.assistantId);
        const call =
          assistant?.role === "assistant"
            ? assistant.toolCalls.find((c) => c.id === event.callId)
            : undefined;
        const result = messages.find(
          (m) =>
            m.role === "toolResult" &&
            m.assistantId === event.assistantId &&
            m.callId === event.callId,
        );
        if (!call || result?.role !== "toolResult") return;
        const record = completeToolRecord(
          createToolRecord(event.assistantId, call),
          result,
        );
        service.recordToolResult(
          scope,
          event.runId,
          event.assistantId,
          event.callId,
          record.status === "succeeded"
            ? "ok"
            : record.status === "failed"
              ? "error"
              : "unknown",
          record.errorCode,
        );
      });
      return () => {
        offSession();
        offAgent();
        if (readers.get(key(scope)) === read) readers.delete(key(scope));
      };
    },
  };
}
export type RuntimeTrace = ReturnType<typeof createRuntimeTrace>;
