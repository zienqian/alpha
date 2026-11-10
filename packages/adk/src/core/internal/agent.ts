import type { AdkError, Agent, AgentState, AssistantMessage, Limits, Message, PromptOptions, RunPlan, RunResult, RunSnapshot } from '../contracts';
import type { Registry } from './plugin-registry';
import type { Run } from './run-controller';
import { createRun } from './run-controller';
import { createLoop } from './create-loop';
import { createHistory } from './history';
import { createEvents } from './events';
import { callModel } from './model-gateway';
import { callTool } from './tool-gateway';
import { assertNotReentrant, validateSignal } from './config';
import { boundaryError, ensure, error, errorData, safeError } from './errors';
import { createId, record, text, textBytes } from './json';
import { copyRunResult } from './run-result';

export function createAgentInstance<C>(config: {
  id: string; instructions: string; app: C; limits: Readonly<Limits>;
  registry: Registry<C>; dispose: () => Promise<void>; onObserverError?: (error: AdkError) => void;
}): Agent<C> {
  const { registry, limits, id, instructions, app } = config;
  const history = createHistory(limits), events = createEvents(config.onObserverError), loop = createLoop();
  for (const observer of registry.observers) events.subscribe(observer);
  let status: AgentState['status'] = 'idle', closing = false;
  let current: Run<C> | undefined, currentPromise: Promise<RunResult> | undefined, closePromise: Promise<void> | undefined;
  let invocation: AbortController | undefined, boundaryFailed = false;
  async function drive(run: Run<C>, input: string, signal?: AbortSignal): Promise<RunResult> {
    let natural: AssistantMessage | undefined;
    try {
      run.begin(signal); run.check();
      run.commit(history.commitUser(input)); run.check();
      natural = await loop.execute({
        callModel: () => callModel(run, registry.model, instructions, registry.tools, registry.hooks),
        callTool: (assistantId, callId) => callTool(run, registry.toolMap, registry.hooks, assistantId, callId),
      });
    } catch (cause) { run.fail(cause); }
    const result = await run.finish(natural);
    if (!registry.boundary) status = closing ? 'closed' : 'idle';
    run.emit({ type: 'run.end', status: result.status }, { usage: result.usage, errorCode: result.status === 'failed' ? result.error.code : undefined });
    current = undefined;
    return result;
  }
  async function invoke(input: string, requestId: string, signal: AbortSignal): Promise<RunResult> {
    let plan: RunPlan | undefined;
    if (registry.boundary) {
      let preparing = true;
      try {
        plan = await registry.boundary.prepare(Object.freeze({ agentId: id, requestId, input, signal, app }), Object.freeze({
          restore(messages: readonly Message[]) {
            ensure(preparing, 'RUN_PREPARATION_CLOSED');
            history.replace(messages); return history.messages;
          },
        }));
      } catch (cause) { throw boundaryError(cause); }
      finally { preparing = false; }
      ensure(record(plan), 'RUN_BOUNDARY_INVALID');
      if (plan.type === 'replay') return copyRunResult(plan.result);
      ensure(plan.type === 'execute' && typeof plan.complete === 'function', 'RUN_BOUNDARY_INVALID');
      // Capture the callback before execution; later mutation cannot change the boundary.
      plan = Object.freeze({ type: 'execute', complete: plan.complete.bind(plan) });
    }
    let snapshot: RunSnapshot | undefined;
    try {
      ensure(!history.blocked, 'HISTORY_BLOCKED');
      const run = createRun(id, app, history, events, limits, () => { status = 'cancelling'; }, requestId);
      current = run;
      const result = await drive(run, input, signal);
      snapshot = Object.freeze({ result, messages: history.messages, historyStatus: history.blocked ? 'blocked' : 'ready' });
      return result;
    } finally {
      if (plan?.type === 'execute') {
        try { await plan.complete(snapshot); }
        catch {
          boundaryFailed = true;
          // Do not turn a known external effect into a rejected/rewritten run result.
          try { void Promise.resolve(config.onObserverError?.(errorData(error('RUN_BOUNDARY_FAILED')))).catch(() => undefined); }
          catch { /* Diagnostics never replace execution facts. */ }
        }
      }
    }
  }
  return Object.freeze({
    id,
    get state(): AgentState {
      return Object.freeze({ status, historyStatus: history.blocked ? 'blocked' : 'ready',
        boundaryStatus: boundaryFailed ? 'failed' : registry.boundary ? 'ready' : 'none', messages: history.messages });
    },
    prompt(input: string, options?: PromptOptions): Promise<RunResult> {
      try {
        assertNotReentrant(events.dispatching);
        ensure(status !== 'closed', 'AGENT_CLOSED');
        ensure(!closing, 'AGENT_CLOSING');
        ensure(!currentPromise, 'AGENT_BUSY');
        ensure(!boundaryFailed, 'RUN_BOUNDARY_FAILED');
        if (!registry.boundary) ensure(!history.blocked, 'HISTORY_BLOCKED');
        ensure(text(input), 'INPUT_INVALID');
        ensure(options === undefined || (Boolean(record(options)) && Object.keys(options).every(k => ['signal', 'requestId'].includes(k))), 'INPUT_INVALID');
        ensure(options?.requestId === undefined || (text(options.requestId) && textBytes(options.requestId) <= 512 && !/[\p{Cc}\p{Cs}]/u.test(options.requestId)), 'INPUT_INVALID');
        validateSignal(options?.signal);
        let resolve!: (value: RunResult) => void, reject!: (reason: unknown) => void;
        const promise = new Promise<RunResult>((yes, no) => { resolve = yes; reject = no; });
        status = 'running';
        const controller = new AbortController(); invocation = controller; currentPromise = promise;
        const abort = () => { if (status === 'running') status = 'cancelling'; controller.abort(); };
        options?.signal?.addEventListener('abort', abort, { once: true });
        if (options?.signal?.aborted) abort();
        let timer: ReturnType<typeof setTimeout> | undefined;
        if (registry.boundary && limits.timeoutMs !== undefined) {
          if (limits.timeoutMs === 0) abort();
          else timer = setTimeout(() => { current?.cancel('timeout'); abort(); }, limits.timeoutMs);
        }
        const done = () => {
          options?.signal?.removeEventListener('abort', abort); if (timer !== undefined) clearTimeout(timer);
          current = undefined; currentPromise = undefined; invocation = undefined;
          status = closing ? 'closed' : 'idle';
        };
        void invoke(input, options?.requestId ?? createId('request'), controller.signal).then(
          result => { done(); resolve(result); }, cause => { done(); reject(registry.boundary ? boundaryError(cause) : safeError(cause, 'INTERNAL_INVARIANT')); },
        );
        return promise;
      } catch (cause) { return Promise.reject(safeError(cause, 'INPUT_INVALID')); }
    },
    subscribe: events.subscribe,
    abort(reason?: string) {
      if (currentPromise) status = 'cancelling';
      current?.cancel(typeof reason === 'string' ? reason : 'user'); invocation?.abort();
    },
    waitForIdle(): Promise<void> { return currentPromise ? currentPromise.then(() => undefined, () => undefined) : Promise.resolve(); },
    replaceMessages(messages: readonly Message[]) {
      assertNotReentrant(events.dispatching);
      ensure(status !== 'closed', 'AGENT_CLOSED');
      ensure(!closing, 'AGENT_CLOSING');
      ensure(!currentPromise, 'AGENT_BUSY');
      ensure(!registry.boundary, 'HISTORY_MANAGED');
      try { history.replace(messages); } catch (cause) { throw safeError(cause, 'INPUT_INVALID'); }
    },
    close(): Promise<void> {
      if (events.dispatching) return Promise.reject(error('REENTRANT_MUTATION'));
      if (closePromise) return closePromise;
      closing = true;
      // Publish the promise before aborting: cancellation may synchronously notify observers.
      let resolve!: () => void, reject!: (reason: unknown) => void;
      closePromise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
      current?.cancel('close');
      invocation?.abort();
      void (async () => {
        await currentPromise?.catch(() => undefined);
        status = 'closed';
        await config.dispose();
      })().then(resolve, reject);
      return closePromise;
    },
  } satisfies Agent<C>);
}
