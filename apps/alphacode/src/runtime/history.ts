import type { SessionData } from "@alpha/adk-session";
import type { ChatMessage } from "../chat/contracts";

export function restoreMessages(data: SessionData): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const turn of data.turns) {
    for (const message of turn.messages) {
      if (message.role === "user") messages.push({ id: message.id, role: "user", text: message.content });
      else if (message.role === "assistant") messages.push({
        id: message.id, role: "assistant", text: message.text,
        ...(message.incompleteReason ? { note: "Response incomplete" } : {}),
      });
      else if (message.role === "toolResult") {
        const assistant = turn.messages.find(item => item.id === message.assistantId);
        const name = assistant?.role === "assistant" ? assistant.toolCalls.find(call => call.id === message.callId)?.name : undefined;
        messages.push({ id: message.id, role: "tool", text: name ?? "Tool call", note: message.execution === "succeeded" ? "Completed" : message.execution });
      }
    }
  }
  return messages;
}
