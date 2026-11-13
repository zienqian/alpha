import type { AdkError } from '../contracts';

const messages: Record<string, string> = {
  CONFIG_INVALID: 'Invalid agent configuration.',
  DUPLICATE_TOOL: 'Tool names must be unique.',
  MISSING_CAPABILITY: 'Exactly one model is required.',
  PLUGIN_CONFLICT: 'Invalid or conflicting plugin contribution.',
  PLUGIN_SETUP_FAILED: 'Plugin setup failed.',
  PLUGIN_REGISTRATION_CLOSED: 'Plugin registration is closed.',
  PLUGIN_START_FAILED: 'Plugin startup failed.',
  PLUGIN_DISPOSE_FAILED: 'Plugin cleanup failed.',
  INIT_ABORTED: 'Agent initialization was cancelled.',
  TOOL_SCHEMA_INVALID: 'The tool input schema is not supported.',
  TOOL_INPUT_INVALID: 'Tool input validation failed.',
  TOOL_NOT_FOUND: 'The requested tool is not registered.',
  TOOL_FAILED: 'Tool execution failed.',
  TOOL_OUTCOME_UNKNOWN: 'The tool outcome could not be confirmed.',
  TOOL_RESULT_INVALID: 'Tool output is invalid or too large.',
  TOOL_RESULT_PROCESSING: 'Tool result processing failed.',
  MODEL_FAILED: 'Model invocation failed.',
  CONTEXT_LIMIT: 'Context exceeds the input budget. Reduce the input or configure a larger context window.',
  CONTEXT_COMPACTION_FAILED: 'Context compaction failed.',
  CONTEXT_UNAVAILABLE: 'Context management is not configured.',
  CONTEXT_WINDOW_UNKNOWN: 'Configure the endpoint context window before compacting.',
  CONTEXT_NOTHING_TO_COMPACT: 'No older complete messages can be compacted.',
  MODEL_PROTOCOL: 'Invalid model response or message projection.',
  MODEL_TOOL_BATCH_TOO_LARGE: 'The model requested too many tools.',
  MODEL_OUTPUT_TOO_LARGE: 'Model output exceeded the configured limit.',
  HOOK_FAILED: 'An execution hook failed.',
  INPUT_INVALID: 'Invalid input or history.',
  AGENT_BUSY: 'The agent is already running.',
  AGENT_CLOSING: 'The agent is closing.',
  AGENT_CLOSED: 'The agent is closed.',
  HISTORY_BLOCKED: 'Resolve the unknown tool outcome before continuing.',
  HISTORY_MANAGED: 'History is managed by the registered run boundary.',
  RUN_BOUNDARY_FAILED: 'The run boundary failed; further execution is blocked.',
  RUN_BOUNDARY_INVALID: 'Invalid run boundary result.',
  RUN_PREPARATION_CLOSED: 'The history preparation capability has expired.',
  REENTRANT_MUTATION: 'State mutation is not allowed during event dispatch.',
  CALL_NOT_PENDING: 'The tool call does not belong to this run.',
  RUN_OPERATION_BUSY: 'A run operation is already active.',
  INTERNAL_INVARIANT: 'An internal execution invariant was violated.',
  OBSERVER_FAILED: 'An observer failed.',
};

export class Failure extends Error implements AdkError {
  readonly code: string;
  readonly cleanupErrors?: readonly AdkError[];
  constructor(code: string, cleanupErrors?: readonly AdkError[]) {
    super(messages[code] ?? 'Agent operation failed.');
    this.name = 'AdkError';
    this.code = code;
    if (cleanupErrors?.length) this.cleanupErrors = Object.freeze([...cleanupErrors]);
  }
}
export function error(code: string): Failure { return new Failure(code); }
export function ensure(condition: unknown, code: string): asserts condition {
  if (!condition) throw error(code);
}
export function safeError(value: unknown, fallback: string): Failure {
  return value instanceof Failure ? value : error(fallback);
}
/** Extension errors cross a public boundary by code only, never by raw message/cause. */
export function boundaryError(value: unknown): Failure {
  if (value instanceof Failure) return value;
  try {
    const code = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'code')?.value : undefined;
    if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code)) return error(code);
  } catch { /* Exotic errors cannot expose diagnostics. */ }
  return error('RUN_BOUNDARY_FAILED');
}
export function errorData(value: Failure): AdkError {
  return Object.freeze({ code: value.code, message: value.message });
}
