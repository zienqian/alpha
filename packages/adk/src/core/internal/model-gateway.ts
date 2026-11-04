import type { GenerateInput, LanguageModel, Message as ProviderMessage } from '@alpha/provider';
import type { AssistantMessage, Hooks, Message, Tool } from '../contracts.js';
import type { Run } from './run-controller.js';
import { Stop } from './run-controller.js';
import { ensure, error } from './errors.js';
import { bytes, createId, equalJson, record, textBytes } from './json.js';
import { copyMessages, createAssistant } from './messages.js';

function project(messages: readonly Message[], original: readonly Message[], runLimits: Run<unknown>['limits']): ProviderMessage[] {
  const normalized = copyMessages(messages, runLimits.maxToolCalls, 'MODEL_PROTOCOL');
  ensure(normalized.length <= runLimits.maxHistoryMessages && bytes(normalized) <= runLimits.maxHistoryBytes, 'MODEL_PROTOCOL');
  const originals = new Map(original.map(m => [m.id, m]));
  const output: ProviderMessage[] = [];
  for (const message of normalized) {
    const original = originals.get(message.id);
    const protectedOriginal = original?.role === 'toolResult' || (original?.role === 'assistant' && (original.toolCalls.length || original.continuation));
    if (protectedOriginal || message.role === 'toolResult' || (message.role === 'assistant' && (message.toolCalls.length || message.continuation))) {
      ensure(equalJson(original, message), 'MODEL_PROTOCOL');
    }
    if (message.role === 'custom') throw error('MODEL_PROTOCOL');
    if (message.role === 'user') output.push({ role: 'user', content: message.content });
    if (message.role === 'assistant') {
      output.push({
        role: 'assistant', content: message.text,
        ...(message.toolCalls.length ? { toolCalls: JSON.parse(JSON.stringify(message.toolCalls)) } : {}),
        ...(message.continuation ? { continuation: JSON.parse(JSON.stringify(message.continuation)) } : {}),
      });
    }
    if (message.role === 'toolResult') output.push({ role: 'tool', toolCallId: message.callId, content: message.content });
  }
  return output;
}

export function callModel<C>(run: Run<C>, model: LanguageModel, instructions: string, tools: readonly Tool<C>[], hooks: Hooks<C>): Promise<AssistantMessage> {
  return run.operate(async () => {
    run.check();
    ensure(run.history.pending.length === 0, 'INTERNAL_INVARIANT');
    let messages = run.history.messages;
    for (const hook of hooks.beforeModel ?? []) {
      try { messages = await hook(messages, run.context); } catch { throw error('HOOK_FAILED'); }
      run.check();
    }
    const input: GenerateInput = {
      messages: [{ role: 'system', content: instructions }, ...project(messages, run.history.messages, run.limits)],
      tools: tools.map(t => ({ name: t.info.name, description: t.info.description, inputSchema: JSON.parse(JSON.stringify(t.info.inputSchema)) })),
      signal: run.context.signal,
    };
    run.reserveModel();
    const modelCallId = createId('model');
    run.emit({ type: 'model.start', modelCallId });
    let candidate: AssistantMessage | undefined, deltaBytes = 0, committed = false;
    try {
      run.check();
      try {
        for await (const event of model.stream(input)) {
          run.check();
          ensure(!candidate && record(event), 'MODEL_PROTOCOL');
          if (event.type === 'text-delta') {
            ensure(typeof event.text === 'string', 'MODEL_PROTOCOL');
            deltaBytes += textBytes(event.text);
            ensure(deltaBytes <= run.limits.maxModelOutputBytes, 'MODEL_OUTPUT_TOO_LARGE');
            run.emit({ type: 'model.delta', modelCallId, text: event.text });
          } else if (event.type === 'tool-call') {
            // Provider also reports these in finish. They are never a separate execution source.
          } else {
            ensure(event.type === 'finish', 'MODEL_PROTOCOL');
            candidate = createAssistant(event.result, createId('msg'), run.limits.maxToolCalls);
            const result = Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== 'id' && key !== 'role'));
            ensure(bytes(result) <= run.limits.maxModelOutputBytes, 'MODEL_OUTPUT_TOO_LARGE');
          }
        }
      } catch (cause) {
        run.fail(cause, 'MODEL_FAILED');
        throw new Stop();
      }
      run.check();
      ensure(candidate, 'MODEL_PROTOCOL');
      run.history.commitAssistant(candidate);
      committed = true;
      run.recordAssistant(candidate);
      run.emit({ type: 'model.end', modelCallId, outcome: candidate.outcome });
      run.check();
      return candidate;
    } catch (cause) {
      run.fail(cause, 'MODEL_FAILED');
      if (!committed) run.emit({ type: 'model.end', modelCallId, outcome: run.intent?.status === 'cancelled' ? 'cancelled' : 'failed' });
      throw new Stop();
    }
  });
}
