import type { CreateSessionOptions, Session } from './contracts.js';
import { createSessionManager } from './create-session-manager.js';
import { keys } from './internal/json.js';
import { safe } from './internal/errors.js';

/** The internal manager has no Agent, worker or owned Store. */
export async function createSession(options: CreateSessionOptions): Promise<Session> {
  try {
    keys(options, ['namespace', 'agentKey', 'store', 'selectContext', 'limits', 'onObserverError', 'id', 'title', 'metadata'], 'SESSION_CONFIG_INVALID');
    const { id, title, metadata, ...config } = options;
    const manager = createSessionManager(config);
    return await manager.createSession({ ...(id !== undefined ? { id } : {}), ...(title !== undefined ? { title } : {}), ...(metadata !== undefined ? { metadata } : {}) });
  } catch (cause) { throw safe(cause, 'SESSION_CONFIG_INVALID'); }
}
