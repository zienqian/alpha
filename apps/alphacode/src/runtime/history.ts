import type { SessionData } from "@alpha/adk-session";
import type { ChatMessage } from "../chat/contracts";
import { completeToolRecord, createToolRecord } from "./tool-records";
import { skillInputDisplay } from "../input";

export function restoreMessages(data: SessionData): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const indices = new Map<string, number>();
  for (const turn of data.turns) {
    const latest = turn === data.turns.at(-1);
    const turnStart = messages.length;
    for (const message of turn.messages) {
      if (message.role === "user") messages.push({ id: message.id, role: "user", text: skillInputDisplay(message.content), rawText: message.content });
      else if (message.role === "assistant") {
        messages.push({
          id: message.id, role: "assistant", text: message.text,
          ...(message.incompleteReason ? { note: "Response incomplete" } : {}),
        });
        for (const call of message.toolCalls) {
          const tool = createToolRecord(message.id, call);
          indices.set(tool.id, messages.length);
          // A historical call without a corresponding result is not still running.
          messages.push({ id: tool.id, role: "tool", text: tool.name, note: "outcome_unknown", tool: { ...tool, status: "outcome_unknown" } });
        }
      }
      else if (message.role === "toolResult") {
        const assistant = turn.messages.find(item => item.id === message.assistantId);
        const call = assistant?.role === "assistant" ? assistant.toolCalls.find(call => call.id === message.callId) : undefined;
        const tool = completeToolRecord(createToolRecord(message.assistantId, call ?? { id: message.callId, name: "Tool call", arguments: {} }), message);
        const restored: ChatMessage = { id: tool.id, role: "tool", text: tool.name, note: tool.status === "succeeded" ? "Completed" : tool.status, tool };
        const index = indices.get(tool.id);
        if (index !== undefined) messages[index] = restored;
        else { indices.set(tool.id, messages.length); messages.push(restored); }
      }
    }
    const last = messages.at(-1);
    if (latest && messages.length > turnStart && last && turn.durationMs !== undefined) {
      messages[messages.length - 1] = { ...last, completion: {
        durationMs: turn.durationMs, completedAt: Date.parse(turn.committedAt), status: turn.run.status,
      } };
    }
  }
  return messages;
}
