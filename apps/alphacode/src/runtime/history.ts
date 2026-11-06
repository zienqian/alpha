import type { SessionData } from "@alpha/adk-session";
import type { ChatMessage } from "../chat/contracts";

export function restoreMessages(data: SessionData): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const turn of data.turns) {
    for (const message of turn.messages) {
      if (message.role === "user") messages.push({ id: message.id, role: "user", text: message.content });
      else if (message.role === "assistant") messages.push({
        id: message.id, role: "assistant", text: message.text,
        ...(message.incompleteReason ? { note: "回复未完成" } : {}),
      });
      else if (message.role === "toolResult") {
        const assistant = turn.messages.find(item => item.id === message.assistantId);
        const name = assistant?.role === "assistant" ? assistant.toolCalls.find(call => call.id === message.callId)?.name : undefined;
        messages.push({ id: message.id, role: "tool", text: name ?? "工具调用", note: message.execution === "succeeded" ? "已返回" : message.execution });
      }
    }
  }
  return messages;
}
