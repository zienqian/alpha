import type { AgentEvent, AssistantMessage, EventMeta, Limits, Message, RunContext, RunResult, ToolResultMessage, Usage } from '../contracts.js';
import type { Events } from './events.js';
import type { History } from './history.js';
import { HistoryCapacity, placeholder } from './history.js';
import { callKey } from './messages.js';
import { createId } from './json.js';
import { ensure, error, errorData, safeError } from './errors.js';

type EventPayload = AgentEvent extends infer E ? E extends AgentEvent ? Omit<E, keyof EventMeta> : never : never;
type StopIntent = { status: 'cancelled' | 'limited'; reason: string } | { status: 'failed'; error: ReturnType<typeof error> };
export class Stop extends Error {}

export function createRun<C>(agentId: string, app: C, history: History, events: Events, limits: Readonly<Limits>, onStop: () => void) {
  const runId = createId('run'), controller = new AbortController();
  const context: RunContext<C> = Object.freeze({ agentId, runId, app, signal: controller.signal });
  const completed = new Map<string, ToolResultMessage>(), assistants = new Set<string>();
  let intent: StopIntent | undefined, active: Promise<unknown> | undefined, accepting = true;
  let seq = 0, modelCalls = 0, toolCalls = 0, last: AssistantMessage | undefined;
  const usage: { inputTokens?: number; outputTokens?: number } = {};
  let timer: ReturnType<typeof setTimeout> | undefined, detach: (() => void) | undefined;
  function emit(event: EventPayload) {
    events.emit({ ...event, agentId, runId, seq: ++seq } as AgentEvent);
  }
  function stop(next: StopIntent) {
    if (intent || !accepting) return;
    intent = next;
    onStop();
    controller.abort();
    emit({ type: 'run.stop_requested', status: next.status });
  }
  function fail(value: unknown, fallback = 'INTERNAL_INVARIANT') {
    if (value instanceof Stop) return;
    if (value instanceof HistoryCapacity) stop({ status: 'limited', reason: 'history_capacity' });
    else stop({ status: 'failed', error: safeError(value, fallback) });
  }
  function check() { if (intent || !accepting) throw new Stop(); }
  function commit(message: Message) { emit({ type: 'message.commit', messageId: message.id, role: message.role }); }
  function toolResult(assistantId: string, callId: string, content: string, execution: ToolResultMessage['execution']) {
    const { message, limited } = history.commitTool(assistantId, callId, content, execution);
    completed.set(callKey(assistantId, callId), message);
    // Capture the capacity failure before observers can request another stop.
    if (limited) stop({ status: 'limited', reason: 'history_capacity' });
    commit(message);
    emit({ type: 'tool.end', assistantId, callId, execution });
    return message;
  }
  return {
    context, history, limits, completed, assistants,
    get intent() { return intent; },
    get active() { return active !== undefined; },
    emit, check, fail, commit, toolResult,
    cancel(reason = 'user') { stop({ status: 'cancelled', reason }); },
    limit(reason: string) { stop({ status: 'limited', reason }); },
    begin(signal?: AbortSignal) {
      emit({ type: 'run.start' });
      if (signal) {
        const abort = () => stop({ status: 'cancelled', reason: 'external_signal' });
        signal.addEventListener('abort', abort, { once: true });
        detach = () => signal.removeEventListener('abort', abort);
        if (signal.aborted) abort();
      }
      if (limits.timeoutMs !== undefined && !intent) {
        if (limits.timeoutMs === 0) stop({ status: 'cancelled', reason: 'timeout' });
        else timer = setTimeout(() => stop({ status: 'cancelled', reason: 'timeout' }), limits.timeoutMs);
      }
    },
    reserveModel() {
      check();
      if (modelCalls >= limits.maxModelCalls) { stop({ status: 'limited', reason: 'max_model_calls' }); check(); }
      modelCalls++;
    },
    reserveTool() {
      check();
      if (toolCalls >= limits.maxToolCalls) { stop({ status: 'limited', reason: 'max_tool_calls' }); check(); }
      toolCalls++;
    },
    operate<T>(operation: () => Promise<T>): Promise<T> {
      check();
      if (active) { fail(error('RUN_OPERATION_BUSY')); throw new Stop(); }
      const work = Promise.resolve().then(operation).catch((cause: unknown) => {
        fail(cause); throw new Stop();
      }).finally(() => { if (active === work) active = undefined; });
      active = work;
      return work;
    },
    recordAssistant(message: AssistantMessage) {
      assistants.add(message.id); last = message;
      for (const key of ['inputTokens', 'outputTokens'] as const) {
        const amount = message.usage?.[key];
        if (amount !== undefined) usage[key] = (usage[key] ?? 0) + amount;
      }
      commit(message);
    },
    async finish(natural?: AssistantMessage): Promise<RunResult> {
      if (active) {
        fail(error('INTERNAL_INVARIANT'));
        await active.catch(() => undefined);
      }
      if (!intent && (!natural || natural.id !== last?.id || natural.outcome === 'tool_calls' || history.pending.length)) fail(error('INTERNAL_INVARIANT'));
      accepting = false;
      // All executed work has settled. Only uncommitted calls need a reserved placeholder.
      for (const p of history.pending) toolResult(p.assistantId, p.call.id, placeholder, p.fallback);
      if (timer !== undefined) clearTimeout(timer);
      detach?.();
      completed.clear(); assistants.clear();
      const reportedUsage: Readonly<Usage> | undefined = Object.keys(usage).length ? Object.freeze({ ...usage }) : undefined;
      const base = { runId, text: last?.text ?? '', ...(reportedUsage ? { usage: reportedUsage } : {}) };
      if (intent?.status === 'failed') return Object.freeze({ ...base, status: 'failed', error: errorData(intent.error) });
      if (intent) return Object.freeze({ ...base, status: intent.status, reason: intent.reason });
      ensure(natural && natural.outcome !== 'tool_calls', 'INTERNAL_INVARIANT');
      const status = natural.outcome;
      const reason = natural.refusal ?? natural.incompleteReason ?? natural.finishReason ?? undefined;
      return Object.freeze({ ...base, status, ...(reason !== undefined ? { reason } : {}) });
    },
  };
}
export type Run<C> = ReturnType<typeof createRun<C>>;
