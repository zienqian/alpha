import type { Agent, AgentOptions } from './contracts';
import { createAgentInstance } from './internal/agent';
import { createLimits, validateOptions } from './internal/config';
import { createRegistry } from './internal/plugin-registry';
import { startPlugins } from './internal/plugin-lifecycle';
import { createId } from './internal/json';
import { Failure, error, errorData, safeError } from './internal/errors';

export async function createAgent<C = undefined>(options: AgentOptions<C>): Promise<Agent<C>> {
  let dispose: (() => Promise<void>) | undefined;
  try {
    validateOptions(options);
    if (options.signal?.aborted) throw error('INIT_ABORTED');
    const id = options.id ?? createId('agent'), instructions = options.instructions;
    const app = options.appContext as C, signal = options.signal, onObserverError = options.onObserverError;
    const limits = createLimits(options.limits), registry = createRegistry(options);
    dispose = await startPlugins(registry.plugins, signal);
    return createAgentInstance({ id, instructions, app, limits, registry, dispose, onObserverError });
  } catch (cause) {
    const failure = safeError(cause, 'CONFIG_INVALID');
    if (dispose) {
      try { await dispose(); }
      catch { throw new Failure(failure.code, [errorData(error('PLUGIN_DISPOSE_FAILED'))]); }
    }
    throw failure;
  }
}
