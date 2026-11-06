import type { AssistantMessage, Limits, Message, ToolExecution, ToolResultMessage } from '../contracts';
import type { ModelCall } from './messages';
import { copyMessages, callKey, createToolResult } from './messages';
import { bytes, createId } from './json';
import { ensure, error } from './errors';

export const placeholder = '[Tool result unavailable.]';
export interface PendingCall {
  readonly assistantId: string;
  readonly call: ModelCall;
  readonly resultId: string;
  readonly reservedBytes: number;
  fallback: ToolExecution;
}
export class HistoryCapacity extends Error {}

export function createHistory(limits: Readonly<Limits>) {
  let messages: readonly Message[] = Object.freeze([]);
  let committedBytes = 0, blocked = false;
  const pending = new Map<string, PendingCall>();
  function fits(addBytes: number, addCount: number, reserveBytes = 0, reserveCount = 0) {
    const count = messages.length + pending.size + addCount + reserveCount;
    const reserved = [...pending.values()].reduce((sum, p) => sum + p.reservedBytes, 0);
    return (limits.maxHistoryMessages === null || count <= limits.maxHistoryMessages)
      && (limits.maxHistoryBytes === null || 2 + Math.max(0, count - 1) + committedBytes + reserved + addBytes + reserveBytes <= limits.maxHistoryBytes);
  }
  function append(message: Message) {
    messages = Object.freeze([...messages, message]);
    committedBytes += bytes(message);
  }
  return {
    get messages() { return messages; },
    get blocked() { return blocked; },
    get pending() { return [...pending.values()]; },
    getPending(assistantId: string, callId: string) { return pending.get(callKey(assistantId, callId)); },
    commitUser(content: string) {
      const message = Object.freeze({ id: createId('msg'), role: 'user' as const, content });
      if (!fits(bytes(message), 1)) throw new HistoryCapacity();
      append(message); return message;
    },
    commitAssistant(message: AssistantMessage) {
      ensure(pending.size === 0, 'INTERNAL_INVARIANT');
      const reservations = message.toolCalls.map(call => {
        const resultId = createId('msg');
        const reservedBytes = bytes(createToolResult(resultId, message.id, call.id, placeholder, 'outcome_unknown'));
        return { assistantId: message.id, call, resultId, reservedBytes, fallback: 'not_executed' as ToolExecution };
      });
      if (!fits(bytes(message), 1, reservations.reduce((n, p) => n + p.reservedBytes, 0), reservations.length)) throw new HistoryCapacity();
      append(message);
      for (const p of reservations) pending.set(callKey(message.id, p.call.id), p);
      return message;
    },
    commitTool(assistantId: string, callId: string, content: string, execution: ToolExecution) {
      const key = callKey(assistantId, callId), reservation = pending.get(key);
      ensure(reservation, 'CALL_NOT_PENDING');
      let message = createToolResult(reservation.resultId, assistantId, callId, content, execution);
      pending.delete(key);
      const limited = !fits(bytes(message), 1);
      if (limited) message = createToolResult(reservation.resultId, assistantId, callId, placeholder, execution);
      // The assistant commit reserved enough for every possible execution state.
      if (!fits(bytes(message), 1)) throw error('INTERNAL_INVARIANT');
      append(message);
      if (execution === 'outcome_unknown') blocked = true;
      return { message, limited };
    },
    replace(input: readonly Message[]) {
      const replacement = copyMessages(input, limits.maxToolCalls);
      ensure((limits.maxHistoryMessages === null || replacement.length <= limits.maxHistoryMessages)
        && (limits.maxHistoryBytes === null || bytes(replacement) <= limits.maxHistoryBytes), 'INPUT_INVALID');
      ensure(pending.size === 0, 'INTERNAL_INVARIANT');
      messages = replacement;
      committedBytes = messages.reduce((n, m) => n + bytes(m), 0);
      blocked = false;
    },
  };
}
export type History = ReturnType<typeof createHistory>;
export type CompletedCalls = Map<string, ToolResultMessage>;
