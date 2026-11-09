import type { SessionData } from "@alpha/adk-session";
import type { ChatMessage } from "../chat/contracts";
import { restoreMessages } from "../runtime/history";
import type { SessionInfo, SessionSearchResult } from "./protocol";

export function archiveSearchMessages(data: SessionData): ChatMessage[] {
  return data.turns.flatMap(turn => {
    const outputs = new Map<string, string>(turn.messages.flatMap(message => message.role === "toolResult"
      ? [[`${message.assistantId}:${message.callId}`, message.content] as const] : []));
    const argumentsById = new Map<string, string>(turn.messages.flatMap(message => message.role === "assistant"
      ? message.toolCalls.map(call => [`${message.id}:${call.id}`, JSON.stringify(call.arguments)] as const) : []));
    // History UI intentionally clips tools; search must use their full stored data.
    return restoreMessages({ ...data, turns: [turn] }).map(message => message.tool ? {
      ...message, text: `${message.text}\n${argumentsById.get(message.id) ?? ""}`,
      tool: { ...message.tool, output: outputs.get(message.id) ?? message.tool.output },
    } : message);
  });
}

export function searchSession(session: SessionInfo, messages: readonly ChatMessage[], query: string): SessionSearchResult | undefined {
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu");
  const snippets: SessionSearchResult["snippets"] = [];
  let matchCount = 0;
  for (const message of messages) {
    const text = [message.text, message.tool?.description, message.tool?.command, message.tool?.path,
      message.tool?.output, message.tool?.error].filter(Boolean).join("\n").replace(/\s+/g, " ");
    const match = pattern.exec(text);
    if (!match) continue;
    matchCount++;
    if (snippets.length >= 3) continue;
    const start = Math.max(0, match.index - 48);
    const end = Math.min(text.length, Math.max(start + 180, match.index + match[0].length + 48));
    snippets.push({ messageId: message.id, role: message.role,
      text: `${start ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}` });
  }
  if (!matchCount && !pattern.test(session.title) && !pattern.test(session.workspaceRoot)) return undefined;
  return { session, snippets, matchCount };
}
