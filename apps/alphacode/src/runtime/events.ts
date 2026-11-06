import type { Agent } from "@alpha/adk/core";
import type { ChatEvent, ToolRecord } from "../chat/contracts";
import { completeToolRecord, createToolRecord } from "./tool-records";

export function subscribeToAgent(agent: Agent, listener: (event: ChatEvent) => void): () => void {
  let currentModel: string | undefined;
  const records = new Map<string, ToolRecord>();
  const lookup = (assistantId: string, callId: string) => {
    const key = `${assistantId}:${callId}`;
    const known = records.get(key);
    if (known) return known;
    const assistant = agent.state.messages.find(message => message.id === assistantId);
    const call = assistant?.role === "assistant" ? assistant.toolCalls.find(call => call.id === callId) : undefined;
    return createToolRecord(assistantId, call ?? { id: callId, name: "Tool call", arguments: {} });
  };
  return agent.subscribe(event => {
    switch (event.type) {
      case "run.start":
        currentModel = undefined;
        records.clear();
        break;
      case "model.start":
        currentModel = event.modelCallId;
        listener({ type: "assistant.start", id: event.modelCallId });
        break;
      case "model.delta":
        listener({ type: "assistant.delta", id: event.modelCallId, text: event.text });
        break;
      case "message.commit": {
        if (event.role !== "assistant" || !currentModel) break;
        const message = agent.state.messages.find(message => message.id === event.messageId);
        if (message?.role === "assistant") {
          const tools = message.toolCalls.map(call => {
            const tool = lookup(message.id, call.id);
            records.set(tool.id, tool);
            return tool;
          });
          listener({ type: "assistant.commit", id: currentModel, text: message.text, tools });
        }
        break;
      }
      case "model.end":
        listener({ type: "assistant.end", id: event.modelCallId, outcome: event.outcome });
        break;
      case "tool.start": {
        const previous = lookup(event.assistantId, event.callId);
        if (previous.finishedAt !== undefined) break;
        const tool: ToolRecord = { ...previous, status: "running", startedAt: previous.startedAt ?? performance.now() };
        records.set(tool.id, tool);
        listener({ type: "tool.start", tool });
        break;
      }
      case "tool.end": {
        // Results are already committed here. Denied calls need not have a start event.
        const result = agent.state.messages.find(message => message.role === "toolResult"
          && message.assistantId === event.assistantId && message.callId === event.callId);
        const tool = completeToolRecord(lookup(event.assistantId, event.callId), result?.role === "toolResult"
          ? result : { execution: event.execution, content: "" });
        tool.finishedAt ??= performance.now();
        records.set(tool.id, tool);
        listener({ type: "tool.end", tool });
        break;
      }
      case "run.end":
        listener({ type: "run.end", status: event.status });
        break;
    }
  });
}
