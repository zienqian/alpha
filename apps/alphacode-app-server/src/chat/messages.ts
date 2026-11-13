import type { ApprovalRequest, ChatEvent, ChatMessage, ChatRunStatus, ChatState, ToolRecord } from "./contracts";

export const statusLabels: Record<ChatRunStatus, string> = {
  completed: "Ready", refused: "Request refused by the model", incomplete: "Response incomplete",
  unknown: "Outcome unknown", limited: "Run limit reached", cancelled: "Stopped", failed: "Run failed",
};

const pending = (tool: ToolRecord) => tool.status === "queued" || tool.status === "running" || tool.status === "awaiting_approval";
const toolMessage = (tool: ToolRecord): ChatMessage => ({
  id: tool.id, role: "tool", text: tool.name, note: tool.status === "succeeded" ? "Completed" : tool.status, noteCode: tool.status, tool,
});

function upsertTools(messages: readonly ChatMessage[], tools: readonly ToolRecord[]): ChatMessage[] {
  const updates = new Map(tools.map(tool => [tool.id, tool]));
  const result = messages.map(message => {
    const tool = updates.get(message.id);
    if (!tool) return message;
    updates.delete(message.id);
    // Late/repeated starts and queued snapshots cannot resurrect a settled tool.
    if (message.tool && !pending(message.tool) && pending(tool)) return message;
    return toolMessage(tool);
  });
  return [...result, ...Array.from(updates.values(), toolMessage)];
}

export function settlePendingTools(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.map(message => message.tool && pending(message.tool) ? toolMessage({
    ...message.tool, status: message.tool.status === "running" ? "outcome_unknown" : "not_executed",
  }) : message);
}

export function applyApproval(state: ChatState, approval: ApprovalRequest | undefined): Partial<ChatState> {
  const old = state.approval;
  const messages = state.messages.map(message => {
    const tool = message.tool;
    if (!tool || !pending(tool)) return message;
    if (approval?.assistantId === tool.assistantId && approval.callId === tool.callId) return toolMessage({ ...tool, status: "awaiting_approval" });
    if (!approval && old?.assistantId === tool.assistantId && old.callId === tool.callId && tool.status === "awaiting_approval") return toolMessage({ ...tool, status: "queued" });
    return message;
  });
  return { approval, messages };
}

export function applyChatEvent(state: ChatState, event: ChatEvent): ChatState {
  const append = (message: ChatMessage) => [...state.messages, message];
  const change = (id: string, patch: (message: ChatMessage) => Partial<ChatMessage>) =>
    state.messages.map(message => message.id === id ? { ...message, ...patch(message) } : message);
  switch (event.type) {
    case "context.usage":
      return { ...state, contextUsage: event.usage };
    case "user.message":
      return { ...state, messages: [...state.messages, { id: event.id, role: "user", text: event.text }] };
    case "session.title":
      return { ...state, sessionTitle: event.title, titleStatus: event.status };
    case "assistant.start":
      return { ...state, phase: "thinking", status: "Generating…", messages: state.messages.some(message => message.id === event.id)
        ? state.messages : append({ id: event.id, role: "assistant", text: "", streaming: true }) };
    case "assistant.delta":
      return { ...state, messages: change(event.id, message => ({ text: message.text + event.text })) };
    case "assistant.commit":
      return { ...state, ...(event.tools?.length ? { phase: "queued" as const, status: "Preparing tools…" } : {}),
        messages: upsertTools(change(event.id, () => ({ text: event.text })), event.tools ?? []) };
    case "assistant.end": {
      const outcome = event.outcome;
      if (outcome === "steered") return { ...state, messages: state.messages
        .filter(message => message.id !== event.id || message.text.length > 0)
        .map(message => message.id === event.id ? { ...message, streaming: false, note: "Redirected by new instructions", noteCode: "RESPONSE_STEERED" } : message) };
      return { ...state, messages: change(event.id, () => ({
        streaming: false,
        noteCode: outcome === "failed" || outcome === "cancelled" ? "INCOMPLETE_PREVIEW"
          : outcome === "completed" || outcome === "tool_calls" ? undefined : outcome,
        note: outcome === "failed" || outcome === "cancelled" ? "Incomplete preview"
          : outcome === "completed" || outcome === "tool_calls" ? undefined : statusLabels[outcome],
      })) };
    }
    case "tool.start": {
      const previous = state.messages.find(message => message.id === event.tool.id)?.tool;
      if (previous && !pending(previous)) return state;
      return { ...state, phase: "running", status: event.tool.description, messages: upsertTools(state.messages, [event.tool]) };
    }
    case "tool.end": {
      const messages = upsertTools(state.messages, [event.tool]);
      const running = messages.find(message => message.tool?.status === "running")?.tool;
      return { ...state, messages, phase: running ? "running" : "queued", status: running?.description ?? "Preparing next step…" };
    }
    case "run.end":
      return { ...state, phase: "saving", lastRunStatus: event.status, status: "Saving session…", messages: settlePendingTools(state.messages) };
  }
}
