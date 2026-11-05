import type { LanguageModel } from '@alpha/provider';
import type { AgentEvent, AgentOptions, Awaitable, HookMap, PluginAPI, RunBoundary, Tool } from '../contracts';
import { copyModel, copyTool, createHooks, hookNames } from './config';
import { ensure, error } from './errors';
import { record, text } from './json';

export interface PluginLifecycle {
  readonly id: string;
  readonly start?: (signal: AbortSignal) => Promise<void>;
  readonly dispose?: () => Awaitable<void>;
}
export function createRegistry<C>(options: AgentOptions<C>) {
  const models: LanguageModel[] = options.model === undefined ? [] : [copyModel(options.model)];
  const tools = [...(options.tools ?? [])].map(t => copyTool(t));
  const hooks = createHooks(options.hooks);
  const observers: ((event: AgentEvent) => void)[] = [];
  const boundaries: RunBoundary<C>[] = [];
  const seen = new Set<string>();
  const plugins = [...(options.plugins ?? [])].map(plugin => {
    ensure(record(plugin) && text(plugin.id) && plugin.apiVersion === 1 && typeof plugin.setup === 'function', 'PLUGIN_CONFLICT');
    ensure(!seen.has(plugin.id), 'PLUGIN_CONFLICT');
    ensure(plugin.requires === undefined || (Array.isArray(plugin.requires) && plugin.requires.every(id => text(id) && seen.has(id))), 'PLUGIN_CONFLICT');
    ensure(plugin.start === undefined || typeof plugin.start === 'function', 'PLUGIN_CONFLICT');
    ensure(plugin.dispose === undefined || typeof plugin.dispose === 'function', 'PLUGIN_CONFLICT');
    seen.add(plugin.id);
    return Object.freeze({
      id: plugin.id, setup: plugin.setup.bind(plugin),
      start: plugin.start?.bind(plugin), dispose: plugin.dispose?.bind(plugin),
    });
  });
  for (const plugin of plugins) {
    let open = true;
    function guard() { ensure(open, 'PLUGIN_REGISTRATION_CLOSED'); }
    const api: PluginAPI<C> = Object.freeze({
      provideModel(model: LanguageModel) { guard(); models.push(copyModel(model)); },
      provideRunBoundary(boundary: RunBoundary<C>) {
        guard(); ensure(record(boundary) && typeof boundary.prepare === 'function', 'PLUGIN_CONFLICT');
        boundaries.push(Object.freeze({ prepare: boundary.prepare.bind(boundary) }));
      },
      addTool(tool: Tool<C>) { guard(); tools.push(copyTool(tool)); },
      hook<K extends keyof HookMap<C>>(name: K, fn: HookMap<C>[K]) {
        guard();
        ensure(hookNames.includes(name) && typeof fn === 'function', 'PLUGIN_CONFLICT');
        hooks[name].push(fn);
      },
      observe(listener: (event: AgentEvent) => void) {
        guard(); ensure(typeof listener === 'function', 'PLUGIN_CONFLICT'); observers.push(listener);
      },
    });
    try {
      const result: unknown = plugin.setup(api);
      if (record(result) && typeof result.then === 'function') {
        void Promise.resolve(result).catch(() => undefined);
        throw error('PLUGIN_SETUP_FAILED');
      }
    } catch { throw error('PLUGIN_SETUP_FAILED'); }
    finally { open = false; }
  }
  ensure(models.length === 1, models.length ? 'PLUGIN_CONFLICT' : 'MISSING_CAPABILITY');
  ensure(boundaries.length <= 1, 'PLUGIN_CONFLICT');
  const toolMap = new Map<string, Tool<C>>();
  for (const tool of tools) {
    ensure(!toolMap.has(tool.info.name), 'DUPLICATE_TOOL');
    toolMap.set(tool.info.name, tool);
  }
  return Object.freeze({
    model: models[0], boundary: boundaries[0], tools: Object.freeze(tools), toolMap,
    hooks: Object.freeze({
      beforeModel: Object.freeze(hooks.beforeModel),
      authorizeTool: Object.freeze(hooks.authorizeTool),
      mapToolResult: Object.freeze(hooks.mapToolResult),
    }),
    observers: Object.freeze(observers),
    plugins: Object.freeze(plugins),
  });
}
export type Registry<C> = ReturnType<typeof createRegistry<C>>;
