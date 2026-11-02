import { ProviderError } from './errors.js';
import { builtinNames, validateBuiltinOptions } from './builtin-options.js';
import { validateModelConfig } from './model-config.js';
import type { ProviderAdapter, ProviderConfig } from './types.js';
import { checkKeys, invalid, isNonEmptyString, isRecord } from './validation-helpers.js';

function isJson(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || ancestors.has(value) || (!Array.isArray(value) && !isRecord(value))) return false;
  ancestors.add(value);
  const valid = Object.values(value).every((child) => isJson(child, ancestors));
  ancestors.delete(value);
  return valid;
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Validate the shared shape, then let each adapter validate its own options. */
export function createConfigSnapshot(config: unknown, adapters: Readonly<Record<string, ProviderAdapter>>): ProviderConfig {
  if (!isJson(config) || !isRecord(config)) invalid();
  checkKeys(config, ['providers'], '');
  if (!isRecord(config.providers) || !Object.keys(config.providers).length) invalid('providers');

  const snapshot = freeze(structuredClone(config)) as ProviderConfig;
  for (const [name, entry] of Object.entries(snapshot.providers)) {
    const path = `providers.${name}`;
    if (!isNonEmptyString(name) || !isRecord(entry)) invalid('providers');
    checkKeys(entry, ['adapter', 'options', 'models'], path);
    if (!isNonEmptyString(entry.adapter) || !isRecord(entry.options) || !isRecord(entry.models) || !Object.keys(entry.models).length) invalid(path);
    for (const [alias, model] of Object.entries(entry.models)) {
      if (!isNonEmptyString(alias) || !isRecord(model)) invalid(`${path}.models`);
      validateModelConfig(model, `${path}.models.${alias}`);
    }
    if (builtinNames.has(entry.adapter)) {
      validateBuiltinOptions(entry.adapter, entry.options, `${path}.options`);
      continue;
    }
    if (!Object.hasOwn(adapters, entry.adapter) || typeof adapters[entry.adapter]?.validate !== 'function' || typeof adapters[entry.adapter]?.createModel !== 'function') {
      throw new ProviderError('ADAPTER_NOT_FOUND', 'Provider adapter is not registered.');
    }
    try {
      adapters[entry.adapter].validate(entry.options as ProviderConfig['providers'][string]['options']);
    } catch {
      invalid(`${path}.options`);
    }
  }
  return snapshot;
}
