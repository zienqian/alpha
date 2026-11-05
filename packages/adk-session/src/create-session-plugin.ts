import type { Plugin } from '@alpha/adk/core';
import type { Session } from './contracts';
import { sessionBinding } from './internal/session';
import { ensure, safe } from './internal/errors';
import { keys } from './internal/json';

export function createSessionPlugin<C = unknown>(options: { readonly session: Session }): Plugin<C> {
  try {
    keys(options, ['session'], 'SESSION_CONFIG_INVALID');
    const binding = sessionBinding(options.session), owner = Symbol('session-plugin');
    let configured = false, started = false, attached = false;
    return Object.freeze({
      id: 'alpha/session', apiVersion: 1,
      setup(api) {
        ensure(!configured, 'SESSION_PLUGIN_REUSED'); configured = true;
        api.provideRunBoundary({ prepare: (request, history) => binding.prepare(owner, request, history) });
      },
      async start(signal) {
        ensure(!started, 'SESSION_PLUGIN_REUSED'); started = true;
        ensure(!signal.aborted, 'SESSION_ABORTED'); binding.bind(owner); attached = true;
      },
      async dispose() { if (attached) { attached = false; await binding.release(owner); } },
    } satisfies Plugin<C>);
  } catch (cause) { throw safe(cause, 'SESSION_CONFIG_INVALID'); }
}
