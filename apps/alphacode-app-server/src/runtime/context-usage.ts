import type { GenerateInput } from "@alpha/provider";
import type { ContextUsage } from "../chat/contracts";

// Verified 2026-11-13: https://developers.openai.com/api/docs/models/gpt-6.1-sol
// Codex's default is smaller than the API model's maximum. A proxy may override it.
export function modelContext(modelId: string, configured?: number): ContextUsage {
  if (configured !== undefined && Number.isSafeInteger(configured) && configured > 0) {
    return { modelId, contextWindow: configured, windowSource: "configuration" };
  }
  if (modelId === "codex/gpt-6.1-sol") return { modelId, contextWindow: 500_000, windowSource: "codex" };
  if (modelId === "gpt-6.1-sol" || modelId === "openai/gpt-6.1-sol") {
    return { modelId, contextWindow: 1_050_000, windowSource: "model" };
  }
  return { modelId, windowSource: "unknown" };
}

// An estimate of the actual outbound payload, not cumulative billing usage.
// Includes tool schemas, tool calls/results and injected instructions. No content
// is exposed to the browser or retained in the usage snapshot.
export function estimateContext(input: GenerateInput, model: ContextUsage): ContextUsage {
  const estimate = (value: unknown) => Math.ceil(Buffer.byteLength(JSON.stringify(value), "utf8") / 4);
  const systemTokens = input.messages.filter(m => m.role === "system" || m.role === "developer")
    .reduce((sum, message) => sum + estimate(message), 0);
  const messageTokens = input.messages.filter(m => m.role !== "system" && m.role !== "developer")
    .reduce((sum, message) => sum + estimate(message), 0);
  const toolTokens = input.tools?.length ? estimate(input.tools) : 0;
  return { ...model, tokens: { system: systemTokens, tools: toolTokens, messages: messageTokens,
    total: systemTokens + toolTokens + messageTokens } };
}

export function restoreContext(value: unknown, model: ContextUsage): ContextUsage {
  if (!value || typeof value !== "object") return model;
  const saved = value as ContextUsage;
  const tokens = saved.tokens;
  if (saved.modelId !== model.modelId || !tokens ||
    ![tokens.system, tokens.tools, tokens.messages, tokens.total].every(n => Number.isSafeInteger(n) && n >= 0) ||
    (tokens.summary !== undefined && (!Number.isSafeInteger(tokens.summary) || tokens.summary < 0)) ||
    tokens.total !== tokens.system + tokens.tools + (tokens.summary ?? 0) + tokens.messages) return model;
  const extra: Partial<ContextUsage> = {};
  if (typeof saved.inputBudget === 'number' && Number.isSafeInteger(saved.inputBudget) && saved.inputBudget > 0) extra.inputBudget = saved.inputBudget;
  if (typeof saved.maxOutputTokens === 'number' && Number.isSafeInteger(saved.maxOutputTokens) && saved.maxOutputTokens > 0) extra.maxOutputTokens = saved.maxOutputTokens;
  if (typeof saved.automatic === 'boolean') extra.automatic = saved.automatic;
  const status = saved.compaction?.status;
  if (status && ['end', 'skip', 'failed'].includes(status)) extra.compaction = { status };
  return { ...model, ...extra, tokens: { system: tokens.system, tools: tokens.tools,
    ...(tokens.summary === undefined ? {} : { summary: tokens.summary }), messages: tokens.messages, total: tokens.total } };
}
