import type { LanguageModel } from '@alpha/provider';
import type { AgentOptions, HookMap, Hooks, Limits, Tool } from '../contracts.js';
import { ensure, error } from './errors.js';
import { copyObject, record, text } from './json.js';

export const defaultLimits: Readonly<Limits> = Object.freeze({
  maxModelCalls: 8, maxToolCalls: 32,
  maxModelOutputBytes: 1024 * 1024, maxToolResultBytes: 128 * 1024,
  maxHistoryBytes: 4 * 1024 * 1024, maxHistoryMessages: 512,
});
export const hookNames = ['beforeModel', 'authorizeTool', 'mapToolResult'] as const;
export type MutableHooks<C> = { [K in keyof HookMap<C>]: HookMap<C>[K][] };
export function createHooks<C>(source?: Hooks<C>): MutableHooks<C> {
  const output: MutableHooks<C> = { beforeModel: [], authorizeTool: [], mapToolResult: [] };
  if (source !== undefined) {
    ensure(record(source), 'CONFIG_INVALID');
    for (const key of Object.keys(source)) ensure(hookNames.includes(key as keyof HookMap<C>), 'CONFIG_INVALID');
    for (const key of hookNames) {
      const values = source[key];
      if (values !== undefined) {
        ensure(Array.isArray(values) && values.every(v => typeof v === 'function'), 'CONFIG_INVALID');
        // Assignment preserves the relationship between the keyed hook and its signature.
        (output[key] as unknown[]) = [...values];
      }
    }
  }
  return output;
}
export function createLimits(source?: Partial<Limits>): Readonly<Limits> {
  ensure(source === undefined || record(source), 'CONFIG_INVALID');
  const output = { ...defaultLimits, ...source };
  for (const key of Object.keys(output)) {
    ensure(Object.hasOwn(defaultLimits, key) || key === 'timeoutMs', 'CONFIG_INVALID');
    const value = output[key as keyof Limits];
    if (key === 'timeoutMs' && value === undefined) continue;
    ensure(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, 'CONFIG_INVALID');
    if (key.endsWith('Bytes') || key === 'maxHistoryMessages') ensure(value > 0, 'CONFIG_INVALID');
    if (key === 'timeoutMs') ensure(value <= 2_147_483_647, 'CONFIG_INVALID');
  }
  return Object.freeze(output);
}
export function validateOptions<C>(options: AgentOptions<C>): void {
  ensure(record(options) && typeof options.instructions === 'string', 'CONFIG_INVALID');
  const keys = ['id', 'instructions', 'model', 'tools', 'plugins', 'hooks', 'appContext', 'limits', 'signal', 'onObserverError'];
  ensure(Object.keys(options).every(k => keys.includes(k)), 'CONFIG_INVALID');
  ensure(options.id === undefined || text(options.id), 'CONFIG_INVALID');
  ensure(options.tools === undefined || Array.isArray(options.tools), 'CONFIG_INVALID');
  ensure(options.plugins === undefined || Array.isArray(options.plugins), 'CONFIG_INVALID');
  ensure(options.onObserverError === undefined || typeof options.onObserverError === 'function', 'CONFIG_INVALID');
  validateSignal(options.signal);
}
export function validateSignal(signal?: AbortSignal): void {
  ensure(signal === undefined || (signal instanceof AbortSignal), 'CONFIG_INVALID');
}
export function copyTool<C>(source: Tool<C>): Tool<C> {
  ensure(record(source) && record(source.info) && typeof source.prepare === 'function', 'CONFIG_INVALID');
  const { name, description, effect } = source.info;
  ensure(text(name) && typeof description === 'string' && ['read', 'write', 'unknown'].includes(effect), 'CONFIG_INVALID');
  const inputSchema = copyObject(source.info.inputSchema, 'CONFIG_INVALID');
  ensure(inputSchema.type === 'object', 'CONFIG_INVALID');
  const prepare = source.prepare;
  return Object.freeze({ info: Object.freeze({ name, description, effect, inputSchema }), prepare: (raw, signal) => prepare.call(source, raw, signal) } satisfies Tool<C>);
}
export function copyModel(model: LanguageModel): LanguageModel {
  ensure(record(model) && text(model.provider) && text(model.modelId) && typeof model.generate === 'function' && typeof model.stream === 'function', 'CONFIG_INVALID');
  const { generate, stream, provider, modelId } = model;
  return Object.freeze({ provider, modelId, generate: input => generate.call(model, input), stream: input => stream.call(model, input) } satisfies LanguageModel);
}
export function assertNotReentrant(dispatching: boolean): void {
  if (dispatching) throw error('REENTRANT_MUTATION');
}
