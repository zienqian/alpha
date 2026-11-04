import type { RunResult } from '../contracts.js';
import { ensure } from './errors.js';
import { copyObject, record, text } from './json.js';

/** Replayed results are data from an extension, never a second execution path. */
export function copyRunResult(input: unknown): RunResult {
  const C = 'RUN_BOUNDARY_INVALID', value = copyObject(input, C);
  ensure(Object.keys(value).every(k => ['runId', 'text', 'status', 'usage', 'error', 'reason'].includes(k)), C);
  ensure(text(value.runId) && typeof value.text === 'string' &&
    ['completed', 'refused', 'incomplete', 'unknown', 'failed', 'cancelled', 'limited'].includes(value.status as string), C);
  if (value.usage !== undefined) {
    ensure(record(value.usage) && Object.keys(value.usage).every(k => ['inputTokens', 'outputTokens'].includes(k)), C);
    ensure(Object.values(value.usage).every(n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0), C);
  }
  if (value.status === 'failed') {
    ensure(record(value.error) && Object.keys(value.error).every(k => ['code', 'message'].includes(k)) &&
      text(value.error.code) && typeof value.error.message === 'string' && value.reason === undefined, C);
  } else ensure(value.error === undefined && (value.reason === undefined || typeof value.reason === 'string'), C);
  return value as unknown as RunResult;
}
