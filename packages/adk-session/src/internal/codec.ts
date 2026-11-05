import type { JsonObject, Message, RunResult } from '@alpha/adk/core';
import type { SessionData, SessionKey, SessionSnapshot, SessionSummary, SessionTurn } from '../contracts';
import { ensure, safe } from './errors';
import { bytes, copy, identifier, integer, keys, record, text } from './json';

const F = 'SESSION_FORMAT_INVALID';
const outcomes = ['completed', 'tool_calls', 'refused', 'incomplete', 'unknown'];
const executions = ['succeeded', 'failed', 'denied', 'not_executed', 'outcome_unknown'];
const timestamp = (v: unknown) => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v));
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function usage(v: unknown) {
  if (v === undefined) return;
  keys(v, ['inputTokens', 'outputTokens'], F);
  for (const count of Object.values(v)) ensure(integer(count), F);
}
export function validateRun(value: unknown): asserts value is RunResult {
  keys(value, ['runId', 'text', 'status', 'usage', 'error', 'reason'], F);
  ensure(text(value.runId) && typeof value.text === 'string' && ['completed', 'refused', 'incomplete', 'unknown', 'failed', 'cancelled', 'limited'].includes(value.status as string), F);
  usage(value.usage);
  if (value.status === 'failed') {
    keys(value.error, ['code', 'message'], F);
    ensure(text(value.error.code) && typeof value.error.message === 'string' && value.reason === undefined, F);
  } else ensure(value.error === undefined && (value.reason === undefined || typeof value.reason === 'string'), F);
}
/** Checks archive pairing, including blocked outcomes which core correctly refuses to import. */
function messages(input: unknown, ids: Set<string>): { blocked: boolean; last?: Record<string, unknown> } {
  ensure(Array.isArray(input), F);
  const pending = new Set<string>(); let blocked = false, last: Record<string, unknown> | undefined;
  for (const m of input) {
    ensure(record(m) && text(m.id) && !ids.has(m.id), F); ids.add(m.id);
    if (m.role === 'toolResult') {
      keys(m, ['id', 'role', 'assistantId', 'callId', 'content', 'execution'], F);
      ensure(text(m.assistantId) && text(m.callId) && typeof m.content === 'string' && executions.includes(m.execution as string), F);
      ensure(pending.delete(JSON.stringify([m.assistantId, m.callId])), F);
      blocked ||= m.execution === 'outcome_unknown';
      continue;
    }
    ensure(pending.size === 0, F);
    if (m.role === 'user') { keys(m, ['id', 'role', 'content'], F); ensure(typeof m.content === 'string', F); }
    else if (m.role === 'custom') { keys(m, ['id', 'role', 'kind', 'data'], F); ensure(text(m.kind) && Object.hasOwn(m, 'data'), F); }
    else {
      keys(m, ['id', 'role', 'outcome', 'text', 'toolCalls', 'finishReason', 'refusal', 'incompleteReason', 'responseId', 'continuation', 'usage'], F);
      ensure(m.role === 'assistant' && outcomes.includes(m.outcome as string) && typeof m.text === 'string' && Array.isArray(m.toolCalls) && (m.finishReason === null || typeof m.finishReason === 'string'), F);
      ensure(m.outcome === 'tool_calls' ? m.toolCalls.length > 0 : m.toolCalls.length === 0, F);
      for (const c of m.toolCalls) {
        keys(c, ['id', 'name', 'arguments'], F);
        ensure(text(c.id) && text(c.name) && record(c.arguments), F);
        const key = JSON.stringify([m.id, c.id]); ensure(!pending.has(key), F); pending.add(key);
      }
      for (const key of ['refusal', 'incompleteReason', 'responseId']) ensure(m[key] === undefined || typeof m[key] === 'string', F);
      usage(m.usage);
      if (m.continuation !== undefined) {
        keys(m.continuation, ['protocol', 'content'], F);
        ensure(m.continuation.protocol === 'anthropic-messages' && Array.isArray(m.continuation.content), F);
      }
      last = m;
    }
  }
  ensure(pending.size === 0, F); return { blocked, last };
}
export function validateKey(key: unknown): asserts key is SessionKey {
  keys(key, ['namespace', 'id'], 'SESSION_INPUT_INVALID');
  ensure(identifier(key.namespace) && identifier(key.id), 'SESSION_INPUT_INVALID');
}
export function metadata(value: unknown): JsonObject {
  const data = copy(value); ensure(record(data) && bytes(data) <= 65536, 'SESSION_INPUT_INVALID'); return data as JsonObject;
}
export function title(value: unknown): asserts value is string { ensure(typeof value === 'string' && Buffer.byteLength(value) <= 4096, 'SESSION_INPUT_INVALID'); }
export function health(data: SessionData): SessionSummary['status'] {
  return data.turns.some(t => t.historyStatus === 'blocked') ? 'blocked' : data.pending ? 'pending' : 'ready';
}
export function snapshot(value: unknown, expectedId?: string): SessionSnapshot {
  try {
    const result = copy(value, F);
    keys(result, ['revision', 'data'], F); ensure(integer(result.revision), F);
    const d = result.data;
    keys(d, ['formatVersion', 'id', 'agentKey', 'title', 'metadata', 'createdAt', 'updatedAt', 'turns', 'pending'], F);
    ensure(d.formatVersion === 1 && identifier(d.id) && (expectedId === undefined || expectedId === d.id) && identifier(d.agentKey) && timestamp(d.createdAt) && timestamp(d.updatedAt), F);
    title(d.title); metadata(d.metadata); ensure(Array.isArray(d.turns), F);
    const requests = new Set<string>(), runs = new Set<string>(), ids = new Set<string>();
    let previousRevision = 0, blocked = false;
    for (const turn of d.turns) {
      keys(turn, ['requestId', 'inputHash', 'run', 'messages', 'historyStatus', 'committedAt', 'committedRevision'], F);
      ensure(!blocked && identifier(turn.requestId) && !requests.has(turn.requestId) && hash(turn.inputHash) && timestamp(turn.committedAt), F);
      ensure(integer(turn.committedRevision) && turn.committedRevision >= previousRevision + 2 && turn.committedRevision <= result.revision, F);
      previousRevision = turn.committedRevision; requests.add(turn.requestId);
      validateRun(turn.run); ensure(!runs.has(turn.run.runId), F); runs.add(turn.run.runId);
      const state = messages(turn.messages, ids);
      ensure(turn.historyStatus === (state.blocked ? 'blocked' : 'ready') && turn.run.text === (state.last?.text ?? ''), F);
      if (['completed', 'refused', 'incomplete', 'unknown'].includes(turn.run.status)) ensure(state.last?.outcome === turn.run.status, F);
      blocked = state.blocked;
    }
    if (d.pending !== null) {
      keys(d.pending, ['requestId', 'inputHash', 'token', 'startedAt'], F);
      ensure(!blocked && result.revision > previousRevision && identifier(d.pending.requestId) && !requests.has(d.pending.requestId) && hash(d.pending.inputHash) && identifier(d.pending.token) && timestamp(d.pending.startedAt), F);
    }
    return result as unknown as SessionSnapshot;
  } catch { throw safe(undefined, F); }
}
export function summary(s: SessionSnapshot): SessionSummary {
  return Object.freeze({ id: s.data.id, revision: s.revision, title: s.data.title, updatedAt: s.data.updatedAt, status: health(s.data) });
}
export function turnMessages(turns: readonly SessionTurn[]): readonly Message[] { return turns.flatMap(t => t.messages); }
