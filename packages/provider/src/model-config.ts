import { checkKeys, invalid, isNonEmptyString, isRecord } from './validation-helpers';

/** Validate descriptive metadata without using it to change a request. */
export function validateModelConfig(model: Record<string, unknown>, path: string): void {
  checkKeys(model, ['id', 'name', 'reasoning', 'input', 'cost', 'contextWindow', 'maxTokens', 'thinkingLevelMap', 'compat'], path);
  if (!isNonEmptyString(model.id)) invalid(`${path}.id`);
  if (model.name !== undefined && !isNonEmptyString(model.name)) invalid(`${path}.name`);
  if (model.reasoning !== undefined && typeof model.reasoning !== 'boolean') invalid(`${path}.reasoning`);
  if (model.input !== undefined && (!Array.isArray(model.input) || model.input.length === 0 || model.input.some((item: unknown) => typeof item !== 'string' || !['text', 'image', 'audio', 'video'].includes(item)) || new Set(model.input).size !== model.input.length)) invalid(`${path}.input`);
  for (const field of ['contextWindow', 'maxTokens'] as const) {
    const value = model[field];
    if (value !== undefined && (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)) invalid(`${path}.${field}`);
  }
  if (model.cost !== undefined) {
    if (!isRecord(model.cost)) invalid(`${path}.cost`);
    checkKeys(model.cost, ['input', 'output', 'cacheRead', 'cacheWrite'], `${path}.cost`);
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite']) {
      const value = model.cost[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) invalid(`${path}.cost.${key}`);
    }
  }
  if (model.thinkingLevelMap !== undefined) {
    if (!isRecord(model.thinkingLevelMap)) invalid(`${path}.thinkingLevelMap`);
    checkKeys(model.thinkingLevelMap, ['minimal', 'low', 'medium', 'high', 'xhigh'], `${path}.thinkingLevelMap`);
    for (const value of Object.values(model.thinkingLevelMap)) if (value !== null && !isNonEmptyString(value)) invalid(`${path}.thinkingLevelMap`);
  }
  if (model.compat !== undefined) {
    if (!isRecord(model.compat)) invalid(`${path}.compat`);
    checkKeys(model.compat, ['supportsDeveloperRole', 'supportsReasoningEffort'], `${path}.compat`);
    for (const value of Object.values(model.compat)) if (typeof value !== 'boolean') invalid(`${path}.compat`);
  }
}
