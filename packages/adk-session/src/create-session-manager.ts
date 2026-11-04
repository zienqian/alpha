import type { Session, SessionData, SessionLimits, SessionManager, SessionManagerOptions, SessionSnapshot } from './contracts.js';
import { createAccess } from './internal/access.js';
import { metadata, snapshot, title } from './internal/codec.js';
import { createDispatch } from './internal/events.js';
import { Failure, aggregate, ensure, safe } from './internal/errors.js';
import { copy, equal, id, identifier, integer, keys, now } from './internal/json.js';
import { createSessionHandle } from './internal/session.js';

export function createSessionManager(options: SessionManagerOptions): SessionManager {
  try {
    const C = 'SESSION_CONFIG_INVALID';
    keys(options, ['namespace', 'agentKey', 'store', 'selectContext', 'limits', 'onObserverError'], C);
    const { namespace, agentKey, selectContext, onObserverError } = options;
    ensure(identifier(namespace) && identifier(agentKey), C);
    ensure(selectContext === undefined || typeof selectContext === 'function', C);
    ensure(onObserverError === undefined || typeof onObserverError === 'function', C);
    keys(options.limits ?? {}, ['maxTurns', 'maxArchiveBytes'], C);
    const limits: SessionLimits = Object.freeze({ maxTurns: 1000, maxArchiveBytes: 64 * 1024 * 1024, ...options.limits });
    ensure(Object.values(limits).every(v => integer(v) && v > 0), C);
    const access = createAccess(options.store, namespace), dispatch = createDispatch(onObserverError);
    const handles = new Set<Session>(), operations = new Set<Promise<unknown>>();
    let closing = false, closed = false, closePromise: Promise<void> | undefined;
    function guard() { ensure(!closed, 'MANAGER_CLOSED'); ensure(!closing, 'MANAGER_CLOSING'); }
    function begin<T>(body: () => Promise<T>): Promise<T> {
      const work = Promise.resolve().then(body).catch(e => { throw safe(e); }).finally(() => operations.delete(work));
      operations.add(work); return work;
    }
    function entry<T>(prepare: () => () => Promise<T>, mutate = false): Promise<T> {
      try { if (mutate) dispatch.guard(); guard(); return begin(prepare()); }
      catch (e) { return Promise.reject(safe(e, 'SESSION_INPUT_INVALID')); }
    }
    async function required(sessionId: string) { const value = await access.read(sessionId); ensure(value, 'SESSION_NOT_FOUND'); return value; }
    async function handle(initial: SessionSnapshot) {
      ensure(initial.data.agentKey === agentKey, 'AGENT_MISMATCH');
      const session = createSessionHandle({ agentKey, access, dispatch, limits, selectContext, managerGuard: guard, onClosed: s => handles.delete(s) }, initial);
      handles.add(session);
      if (closing) { await session.close(); throw new Failure('MANAGER_CLOSING'); }
      return session;
    }
    return Object.freeze({
      createSession(input) {
        return entry(() => {
          const value = copy(input ?? {}); keys(value, ['id', 'title', 'metadata'], 'SESSION_INPUT_INVALID');
          const sessionId = value.id ?? id(), heading = value.title ?? ''; ensure(identifier(sessionId), 'SESSION_INPUT_INVALID'); title(heading);
          const date = now();
          const data: SessionData = { formatVersion: 1, id: sessionId, agentKey, title: heading, metadata: metadata(value.metadata ?? {}), createdAt: date, updatedAt: date, turns: [], pending: null };
          const expected = snapshot({ revision: 0, data });
          return async () => {
            let created: SessionSnapshot;
            try { created = await access.create(expected.data); ensure(equal(created, expected), 'SESSION_FORMAT_INVALID'); }
            catch (cause) {
              const failure = safe(cause);
              if (failure.code === 'SESSION_EXISTS') throw failure;
              if (failure.code === 'SESSION_FORMAT_INVALID') throw new Failure(failure.code, { sessionId });
              let found: SessionSnapshot | undefined;
              try { found = await access.read(sessionId); } catch { /* Retain the original sanitized create failure. */ }
              if (found && equal(found, expected)) created = found;
              else throw new Failure(failure.code, { sessionId });
            }
            return handle(created);
          };
        }, true);
      },
      openSession(sessionId) { return entry(() => { ensure(identifier(sessionId), 'SESSION_INPUT_INVALID'); return async () => handle(await required(sessionId)); }, true); },
      getSession(sessionId) { return entry(() => { ensure(identifier(sessionId), 'SESSION_INPUT_INVALID'); return () => access.read(sessionId); }); },
      listSessions(options) { return entry(() => { const opts = options === undefined ? undefined : copy(options); return () => access.list(opts); }); },
      updateSession(sessionId, patch, options) {
        return entry(() => {
          ensure(identifier(sessionId), 'SESSION_INPUT_INVALID');
          const change = copy(patch), opts = copy(options);
          keys(change, ['title', 'metadata'], 'SESSION_INPUT_INVALID'); keys(opts, ['expectedRevision'], 'SESSION_INPUT_INVALID');
          ensure(integer(opts.expectedRevision) && opts.expectedRevision < Number.MAX_SAFE_INTEGER, 'SESSION_INPUT_INVALID');
          if (change.title !== undefined) title(change.title);
          if (change.metadata !== undefined) metadata(change.metadata);
          return async () => {
            const current = await required(sessionId);
            ensure(current.revision === opts.expectedRevision, 'SESSION_CONFLICT'); ensure(!current.data.pending, 'RECOVERY_REQUIRED');
            const next = snapshot({ revision: current.revision + 1, data: { ...current.data, ...change, updatedAt: now() } }, sessionId);
            ensure(await access.cas(sessionId, current.revision, next.data), 'SESSION_CONFLICT'); return next;
          };
        }, true);
      },
      deleteSession(sessionId, options) {
        return entry(() => {
          ensure(identifier(sessionId), 'SESSION_INPUT_INVALID'); const opts = copy(options); keys(opts, ['expectedRevision'], 'SESSION_INPUT_INVALID');
          ensure(integer(opts.expectedRevision) && opts.expectedRevision < Number.MAX_SAFE_INTEGER, 'SESSION_INPUT_INVALID');
          return async () => {
            const current = await required(sessionId);
            ensure(current.revision === opts.expectedRevision, 'SESSION_CONFLICT'); ensure(!current.data.pending, 'RECOVERY_REQUIRED');
            ensure(await access.cas(sessionId, current.revision, null), 'SESSION_CONFLICT');
          };
        }, true);
      },
      close() {
        try {
          dispatch.guard();
          if (!closePromise) {
            ensure([...handles].every(s => s.state.binding === 'unbound'), 'SESSION_BOUND');
            ensure([...handles].every(s => ['idle', 'unsaved', 'closed'].includes(s.state.status)), 'SESSION_BUSY');
          }
        } catch (e) { return Promise.reject(e); }
        if (closePromise) return closePromise;
        closing = true;
        const failures: Failure[] = [];
        // Data handles only. Agents are owned and drained by the application.
        closePromise = Promise.resolve().then(async () => {
          const releases = [...handles].map(s => s.close().catch(e => { failures.push(safe(e)); }));
          await Promise.allSettled([...operations]); await Promise.all(releases);
          if (failures.length) throw aggregate(failures); closed = true;
        }).catch(cause => { closing = false; closePromise = undefined; throw cause; });
        return closePromise;
      },
    } satisfies SessionManager);
  } catch (cause) { throw safe(cause, 'SESSION_CONFIG_INVALID'); }
}
