import type { SessionMessage } from "@/features/sessions/types";

export type HistoryItem =
  | { type: "message"; id: string; message: SessionMessage & { role: "user" | "assistant" } }
  | { type: "tools"; id: string; messages: SessionMessage[] };

export function hasActiveTools(messages: readonly SessionMessage[]) {
  return messages.some(message => ["running", "queued", "awaiting_approval"].includes(message.tool?.status ?? ""));
}

export function buildSessionHistory(source: readonly SessionMessage[], busy: boolean, phase?: string, connected = true) {
  // Empty assistant deltas share the trailing progress row; explicit notes stay.
  const messages = source.filter(message => message.role !== "assistant" || message.content.trim() || message.note?.trim());
  const items: HistoryItem[] = [];
  const finalReplyIds = new Set<string>();
  let lastReplyId: string | undefined;

  for (const message of messages) {
    // A tool call continues the same reply. Only the last prose block of a
    // completed user turn exposes a copy action.
    if (message.role === "user") {
      if (lastReplyId) finalReplyIds.add(lastReplyId);
      lastReplyId = undefined;
    } else if (message.role === "assistant" && message.content.trim()) {
      lastReplyId = message.id;
    }
    const previous = items.at(-1);
    if (message.role === "tool") {
      if (previous?.type === "tools") previous.messages.push(message);
      else items.push({ type: "tools", id: message.id, messages: [message] });
    } else {
      items.push({ type: "message", id: message.id, message: { ...message, role: message.role } });
    }
  }
  if (!busy && lastReplyId) finalReplyIds.add(lastReplyId);
  const last = items.at(-1);
  const toolsRunning = last?.type === "tools" && hasActiveTools(last.messages);
  const streamingReply = last?.type === "message" && last.message.role === "assistant"
    && Boolean(last.message.streaming && last.message.content.trim());

  return {
    items, finalReplyIds, last, streamingReply,
    empty: messages.length === 0 && !busy,
    showProgress: busy && (!toolsRunning || phase === "stopping" || !connected),
  };
}
