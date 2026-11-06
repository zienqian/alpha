import type { Agent } from "@alpha/adk/core";
import type { ChatEvent } from "../chat/contracts";

export function subscribeToAgent(agent: Agent, listener: (event: ChatEvent) => void): () => void {
  let currentModel: string | undefined;
  return agent.subscribe(event => {
    switch (event.type) {
      case "run.start":
        currentModel = undefined;
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
        if (message?.role === "assistant") listener({ type: "assistant.commit", id: currentModel, text: message.text });
        break;
      }
      case "model.end":
        listener({ type: "assistant.end", id: event.modelCallId, outcome: event.outcome });
        break;
      case "tool.start":
        listener({ type: "tool.start", id: `${event.assistantId}:${event.callId}`, name: event.name });
        break;
      case "tool.end": {
        // Denied calls have no tool.start event; resolve their name from committed history.
        const assistant = agent.state.messages.find(message => message.id === event.assistantId);
        const name = assistant?.role === "assistant" ? assistant.toolCalls.find(call => call.id === event.callId)?.name : undefined;
        listener({ type: "tool.end", id: `${event.assistantId}:${event.callId}`, name: name ?? "Tool call", execution: event.execution });
        break;
      }
      case "run.end":
        listener({ type: "run.end" });
        break;
    }
  });
}
