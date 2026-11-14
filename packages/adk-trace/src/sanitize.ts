import type { AgentEvent } from "@alpha/adk/core";

/** Whitelist metadata before enqueueing; unknown extension fields are never retained. */
export function sanitizeEvent(event: AgentEvent): {
  event: AgentEvent;
  truncated: boolean;
  bytes: number;
} {
  let truncated = false;
  const clip = (value: string, limit = 512) => {
    if (value.length > limit) truncated = true;
    return value.slice(0, limit);
  };
  const fields: Record<string, unknown> = {
    type: event.type,
    agentId: clip(event.agentId),
    runId: clip(event.runId),
    seq: event.seq,
  };
  for (const key of [
    "modelCallId",
    "assistantId",
    "callId",
    "name",
    "messageId",
    "role",
    "execution",
    "outcome",
    "status",
  ] as const) {
    if (key in event) {
      const value = (event as unknown as Record<string, unknown>)[key];
      if (typeof value === "string") fields[key] = clip(value);
    }
  }
  if (event.type === "model.delta") fields.text = event.text ? "1" : "";
  if (event.type === "model.activity") {
    fields.kind = event.kind;
    fields.bytes = event.bytes;
    if (event.toolName) fields.toolName = clip(event.toolName, 256);
  }
  const source = event.telemetry;
  if (source) {
    const telemetry: Record<string, unknown> = {
      version: 1,
      timestampMs: source.timestampMs,
      elapsedMs: source.elapsedMs,
    };
    for (const key of [
      "requestId",
      "provider",
      "modelId",
      "assistantId",
      "resultMessageId",
      "effect",
      "errorCode",
    ] as const) {
      const value = source[key];
      if (value !== undefined) telemetry[key] = clip(value);
    }
    if (source.usage)
      telemetry.usage = {
        inputTokens: source.usage.inputTokens,
        outputTokens: source.usage.outputTokens,
      };
    if (source.toolCalls) {
      truncated ||= source.toolCalls.length > 512;
      telemetry.toolCalls = source.toolCalls
        .slice(0, 512)
        .map((call) => ({
          callId: clip(call.callId),
          name: clip(call.name, 256),
        }));
    }
    fields.telemetry = telemetry;
  }
  return {
    event: fields as unknown as AgentEvent,
    truncated,
    bytes: JSON.stringify(fields).length * 2,
  };
}
