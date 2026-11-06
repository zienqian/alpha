import type { ChatEvent, ChatMessage, ChatRunStatus, ChatState } from "./contracts";

export const statusLabels: Record<ChatRunStatus, string> = {
  completed: "Ready", refused: "Request refused by the model", incomplete: "Response incomplete",
  unknown: "Outcome unknown", limited: "Run limit reached", cancelled: "Stopped", failed: "Run failed",
};

export function applyChatEvent(state: ChatState, event: ChatEvent): ChatState {
  const append = (message: ChatMessage) => [...state.messages, message];
  const change = (id: string, patch: (message: ChatMessage) => Partial<ChatMessage>) =>
    state.messages.map(message => message.id === id ? { ...message, ...patch(message) } : message);
  switch (event.type) {
    case "assistant.start":
      return { ...state, status: "Generating…", messages: append({ id: event.id, role: "assistant", text: "", streaming: true }) };
    case "assistant.delta":
      return { ...state, messages: change(event.id, message => ({ text: message.text + event.text })) };
    case "assistant.commit":
      return { ...state, messages: change(event.id, () => ({ text: event.text })) };
    case "assistant.end":
      return { ...state, messages: change(event.id, () => ({
        streaming: false,
        note: event.outcome === "failed" || event.outcome === "cancelled" ? "Incomplete preview"
          : event.outcome === "completed" || event.outcome === "tool_calls" ? undefined : statusLabels[event.outcome],
      })) };
    case "tool.start":
      return { ...state, status: `Tool: ${event.name}`, messages: append({ id: event.id, role: "tool", text: event.name, note: "Running" }) };
    case "tool.end": {
      const note = event.execution === "succeeded" ? "Completed" : event.execution;
      return { ...state, messages: state.messages.some(message => message.id === event.id)
        ? change(event.id, () => ({ note }))
        : append({ id: event.id, role: "tool", text: event.name, note }) };
    }
    case "run.end":
      return { ...state, status: "Saving session…" };
  }
}
