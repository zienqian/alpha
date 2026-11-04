import type { AdkError } from '../contracts.js';
import type { PluginLifecycle } from './plugin-registry.js';
import { Failure, error, errorData } from './errors.js';

export async function startPlugins(plugins: readonly PluginLifecycle[], signal?: AbortSignal): Promise<() => Promise<void>> {
  const controller = new AbortController(), started: PluginLifecycle[] = [];
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  let disposed = false;
  async function cleanup(): Promise<AdkError[]> {
    if (disposed) return [];
    disposed = true;
    const failures: AdkError[] = [];
    for (const plugin of [...started].reverse()) {
      try { await plugin.dispose?.(); }
      catch { failures.push(errorData(error('PLUGIN_DISPOSE_FAILED'))); }
    }
    return failures;
  }
  try {
    if (controller.signal.aborted) throw error('INIT_ABORTED');
    for (const plugin of plugins) {
      started.push(plugin);
      await plugin.start?.(controller.signal);
      if (controller.signal.aborted) throw error('INIT_ABORTED');
    }
  } catch {
    const code = controller.signal.aborted ? 'INIT_ABORTED' : 'PLUGIN_START_FAILED';
    controller.abort();
    const failures = await cleanup();
    throw new Failure(code, failures);
  } finally { signal?.removeEventListener('abort', abort); }
  return async () => {
    const failures = await cleanup();
    if (failures.length) throw new Failure('PLUGIN_DISPOSE_FAILED', failures);
  };
}
