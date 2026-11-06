import type { Message, RunHistory, RunPlan, RunRequest, RunSnapshot } from '@alpha/adk/core';
import type { SaveResult, Session, SessionEvent, SessionLimits, SessionManagerOptions, SessionSnapshot, SessionState, SessionTurn } from '../contracts';
import type { Access } from './access';
import type { Dispatch } from './events';
import { health, snapshot, turnMessages } from './codec';
import { Failure, ensure, safe } from './errors';
import { bytes, copy, equal, id, identifier, inputHash, now } from './json';

interface Commit { admission: SessionSnapshot; candidate: SessionSnapshot; turn: SessionTurn }
interface SessionConfig {
  agentKey: string; access: Access; dispatch: Dispatch; limits: SessionLimits;
  selectContext?: SessionManagerOptions['selectContext'];
  managerGuard(): void; onClosed(session: Session): void;
}
interface Binding {
  bind(owner: symbol): void;
  prepare(owner: symbol, request: RunRequest<unknown>, history: RunHistory): Promise<RunPlan>;
  release(owner: symbol): Promise<void>;
}
const bindings = new WeakMap<Session, Binding>();
export function sessionBinding(session: Session): Binding {
  const binding = bindings.get(session); ensure(binding, 'SESSION_CONFIG_INVALID'); return binding;
}

export function createSessionHandle(config: SessionConfig, initial: SessionSnapshot): Session {
  const { access, dispatch } = config, sessionId = initial.data.id;
  let observed = initial, status: SessionState['status'] = 'idle', closing = false, active = false;
  let owner: symbol | undefined, closePromise: Promise<void> | undefined;
  let commit: Commit | undefined, quarantined = false, unsavedCode: string | undefined;
  let requestId: string | undefined, persistence: SaveResult | undefined;
  const listeners = new Set<(event: SessionEvent) => void>();
  function emit(event: SessionEvent) { dispatch.invoke([...listeners], copy(event)); }
  function guard() {
    dispatch.guard(); ensure(status !== 'closed', 'SESSION_CLOSED');
    ensure(!closing, 'SESSION_CLOSING'); config.managerGuard(); ensure(!active, 'SESSION_BUSY');
  }
  async function read(): Promise<SessionSnapshot> {
    const value = await access.read(sessionId); ensure(value, 'SESSION_NOT_FOUND'); observed = value; return value;
  }
  function receipt(s: SessionSnapshot, currentId: string, digest: string): RunPlan | undefined {
    const turn = s.data.turns.find(t => t.requestId === currentId); if (!turn) return;
    ensure(turn.inputHash === digest, 'REQUEST_MISMATCH');
    persistence = Object.freeze({ status: 'saved', revision: turn.committedRevision });
    return Object.freeze({ type: 'replay', result: turn.run });
  }
  async function context(s: SessionSnapshot, signal: AbortSignal, history: RunHistory): Promise<readonly Message[]> {
    let selected: readonly string[];
    try { selected = config.selectContext ? await config.selectContext(Object.freeze({ turns: s.data.turns, signal })) : s.data.turns.map(t => t.run.runId); }
    catch { ensure(!signal.aborted, 'SESSION_ABORTED'); throw new Failure('SESSION_CONTEXT_INVALID'); }
    ensure(!signal.aborted, 'SESSION_ABORTED'); ensure(Array.isArray(selected), 'SESSION_CONTEXT_INVALID');
    let previous = -1; const chosen: SessionTurn[] = [];
    for (const runId of selected) {
      const index = s.data.turns.findIndex(t => t.run.runId === runId);
      ensure(index > previous, 'SESSION_CONTEXT_INVALID'); previous = index; chosen.push(s.data.turns[index]);
    }
    try { return history.restore(turnMessages(chosen)); }
    catch { throw new Failure('SESSION_CONTEXT_INVALID'); }
  }
  async function save(): Promise<SaveResult> {
    const work = commit; ensure(work, 'RECOVERY_REQUIRED');
    let saved = false, code: 'STORE_UNAVAILABLE' | 'COMMIT_CONFLICT' = 'STORE_UNAVAILABLE';
    try { saved = await access.cas(sessionId, work.admission.revision, work.candidate.data); } catch { /* Reconcile lost acknowledgements. */ }
    if (saved) observed = work.candidate;
    else {
      try {
        const current = await access.read(sessionId); if (current) observed = current;
        const existing = current?.data.turns.find(t => t.requestId === work.turn.requestId);
        if (existing && equal(existing, work.turn)) saved = true;
        else if (!current || !equal(current, work.admission)) code = 'COMMIT_CONFLICT';
      } catch (cause) { if (safe(cause).code === 'SESSION_FORMAT_INVALID') code = 'COMMIT_CONFLICT'; }
    }
    if (saved) {
      commit = undefined; unsavedCode = undefined; status = 'idle';
      persistence = Object.freeze({ status: 'saved', revision: work.turn.committedRevision });
      emit({ type: 'session.saved', sessionId, requestId: work.turn.requestId, revision: persistence.revision }); return persistence;
    }
    status = 'unsaved'; persistence = Object.freeze({ status: 'pending', code });
    if (unsavedCode !== code) { unsavedCode = code; emit({ type: 'session.unsaved', sessionId, requestId: work.turn.requestId, code }); }
    return persistence;
  }
  async function prepare(request: RunRequest<unknown>, history: RunHistory): Promise<RunPlan> {
    const started = performance.now();
    const { signal, input } = request, currentId = request.requestId;
    ensure(!signal.aborted, 'SESSION_ABORTED'); const start = await read(); ensure(!signal.aborted, 'SESSION_ABORTED');
    ensure(start.data.agentKey === config.agentKey, 'AGENT_MISMATCH');
    const digest = inputHash(config.agentKey, input), prior = receipt(start, currentId, digest); if (prior) return prior;
    ensure(!quarantined && !start.data.pending, 'RECOVERY_REQUIRED'); ensure(health(start.data) !== 'blocked', 'HISTORY_BLOCKED');
    ensure(start.data.turns.length < config.limits.maxTurns && start.revision <= Number.MAX_SAFE_INTEGER - 2, 'SESSION_CAPACITY');
    const baseline = await context(start, signal, history); ensure(!signal.aborted, 'SESSION_ABORTED');
    const admission = snapshot({ revision: start.revision + 1, data: { ...start.data, updatedAt: now(), pending: { requestId: currentId, inputHash: digest, token: id(), startedAt: now() } } }, sessionId);
    ensure(bytes(admission.data) <= config.limits.maxArchiveBytes, 'SESSION_CAPACITY');
    let admitted: boolean;
    try { admitted = await access.cas(sessionId, start.revision, admission.data); }
    catch (cause) {
      if (safe(cause).code === 'SESSION_FORMAT_INVALID') { quarantined = true; throw cause; }
      let current: SessionSnapshot | undefined;
      try { current = await access.read(sessionId); }
      catch { quarantined = true; throw new Failure('RECOVERY_REQUIRED'); }
      if (current) observed = current;
      if (equal(current, admission)) admitted = true;
      else if (equal(current, start)) throw new Failure('STORE_UNAVAILABLE');
      else { quarantined = true; throw new Failure('RECOVERY_REQUIRED'); }
    }
    if (!admitted) {
      const current = await access.read(sessionId); if (current) observed = current;
      const prior = current && receipt(current, currentId, digest); if (prior) return prior;
      throw new Failure('SESSION_CONFLICT');
    }
    // An abort after admission must still finalize and save a cancelled core run.
    observed = admission; status = 'running';
    return Object.freeze({ type: 'execute', async complete(final: RunSnapshot | undefined) {
      try {
        if (!final) { quarantined = true; return; }
        ensure(final.messages.length >= baseline.length && equal(final.messages.slice(0, baseline.length), baseline), 'RECOVERY_REQUIRED');
        const turn: SessionTurn = { requestId: currentId, inputHash: digest, run: final.result, messages: final.messages.slice(baseline.length),
          historyStatus: final.historyStatus, committedAt: now(), durationMs: Math.max(0, Math.round(performance.now() - started)), committedRevision: admission.revision + 1 };
        const candidate = snapshot({ revision: admission.revision + 1, data: { ...admission.data, updatedAt: now(), turns: [...admission.data.turns, turn], pending: null } }, sessionId);
        const storedTurn = candidate.data.turns.at(-1); ensure(storedTurn, 'RECOVERY_REQUIRED');
        commit = { admission, candidate, turn: storedTurn }; status = 'saving'; await save();
      } catch { quarantined = true; throw new Failure('RECOVERY_REQUIRED'); }
      finally { active = false; status = commit ? 'unsaved' : 'idle'; }
    } });
  }
  const session: Session = Object.freeze({
    id: sessionId,
    get state(): SessionState { return Object.freeze({ status, binding: owner ? 'bound' : 'unbound', revision: observed.revision,
      historyStatus: health(observed.data), ...(requestId ? { requestId } : {}), ...(persistence ? { persistence } : {}) }); },
    async getSnapshot() {
      ensure(status !== 'closed', 'SESSION_CLOSED'); config.managerGuard();
      const value = await access.read(sessionId); ensure(value, 'SESSION_NOT_FOUND'); return value;
    },
    flush() {
      try {
        guard(); active = true; status = 'saving';
        return (async () => {
          if (commit) return save();
          const current = await read(); ensure(!quarantined && !current.data.pending, 'RECOVERY_REQUIRED'); ensure(health(current.data) !== 'blocked', 'HISTORY_BLOCKED');
          return Object.freeze({ status: 'saved' as const, revision: current.revision });
        })().catch(cause => { throw safe(cause); }).finally(() => { active = false; status = commit ? 'unsaved' : 'idle'; });
      } catch (cause) { return Promise.reject(safe(cause)); }
    },
    subscribe(listener: (event: SessionEvent) => void) { ensure(status !== 'closed', 'SESSION_CLOSED'); ensure(typeof listener === 'function', 'SESSION_INPUT_INVALID'); listeners.add(listener); return () => { listeners.delete(listener); }; },
    close() {
      try { dispatch.guard(); if (closePromise) return closePromise; ensure(!owner, 'SESSION_BOUND'); ensure(!active, 'SESSION_BUSY'); }
      catch (cause) { return Promise.reject(cause); }
      closing = true;
      closePromise = Promise.resolve().then(async () => {
        if (commit) { const result = await save(); ensure(result.status === 'saved', result.status === 'pending' ? result.code : 'STORE_UNAVAILABLE'); }
        status = 'closed'; listeners.clear(); config.onClosed(session);
      }).catch(cause => { closing = false; closePromise = undefined; throw safe(cause); });
      return closePromise;
    },
  });
  bindings.set(session, {
    bind(token) { guard(); ensure(!owner, 'SESSION_BOUND'); ensure(!commit, 'SESSION_UNSAVED'); owner = token; },
    async prepare(token, request, history) {
      guard(); ensure(owner === token, 'SESSION_NOT_BOUND'); ensure(!commit, 'SESSION_UNSAVED');
      ensure(identifier(request.requestId), 'SESSION_INPUT_INVALID');
      active = true; status = 'preparing'; requestId = request.requestId; persistence = undefined;
      try { const plan = await prepare(request, history); if (plan.type === 'replay') { active = false; status = 'idle'; } return plan; }
      catch (cause) { active = false; status = commit ? 'unsaved' : 'idle'; throw safe(cause); }
    },
    async release(token) {
      if (owner !== token) return;
      try {
        if (active) { quarantined = true; active = false; status = commit ? 'unsaved' : 'idle'; }
        if (commit) { status = 'saving'; const result = await save(); ensure(result.status === 'saved', result.status === 'pending' ? result.code : 'STORE_UNAVAILABLE'); }
      } finally { owner = undefined; status = commit ? 'unsaved' : 'idle'; }
    },
  });
  return session;
}
