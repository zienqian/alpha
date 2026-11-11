import type { GenerateInput, LanguageModel, Message as ProviderMessage } from '@alpha/provider';
import type { AssistantMessage, Hooks, Message, Tool } from '../contracts';
import type { Run } from './run-controller';
import { Stop } from './run-controller';
import { ensure, error } from './errors';
import { bytes, createId, equalJson, record, textBytes } from './json';
import { copyMessages, createAssistant } from './messages';

function project(messages: readonly Message[], original: readonly Message[], runLimits: Run<unknown>['limits']): ProviderMessage[] {
  const normalized = copyMessages(messages, runLimits.maxToolCalls, 'MODEL_PROTOCOL');
  ensure((runLimits.maxHistoryMessages === null || normalized.length <= runLimits.maxHistoryMessages)
    && (runLimits.maxHistoryBytes === null || bytes(normalized) <= runLimits.maxHistoryBytes), 'MODEL_PROTOCOL');
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

export function callModel<C>(run: Run<C>, model: LanguageModel, instructions: string, tools: readonly Tool<C>[], hooks: Hooks<C>, steeringSignal: AbortSignal): Promise<AssistantMessage | undefined> {
  return run.operate(async () => {
    const context = Object.freeze({ ...run.context, signal: AbortSignal.any([run.context.signal, steeringSignal]) });
    const check = () => { run.check(); context.signal.throwIfAborted(); };
    let modelCallId: string | undefined, candidate: AssistantMessage | undefined, deltaBytes = 0, ended = false;
    const chunks: string[] = [];
    const commit = (message: AssistantMessage) => {
      ensure(modelCallId, 'INTERNAL_INVARIANT');
      run.history.commitAssistant(message);
      run.recordAssistant(message);
      ended = true;
      run.emit({ type: 'model.end', modelCallId, outcome: message.outcome }, {
        assistantId: message.id, usage: message.usage,
        toolCalls: Object.freeze(message.toolCalls.map(call => Object.freeze({ callId: call.id, name: call.name }))),
      });
      run.check();
      return message;
    };
    try {
      check();
      ensure(run.history.pending.length === 0, 'INTERNAL_INVARIANT');
      let messages = run.history.messages;
      for (const hook of hooks.beforeModel ?? []) {
        try { messages = await hook(messages, context); } catch { throw error('HOOK_FAILED'); }
        check();
      }
      const input: GenerateInput = {
        messages: [{ role: 'system', content: instructions }, ...project(messages, run.history.messages, run.limits)],
        tools: tools.map(t => ({ name: t.info.name, description: t.info.description, inputSchema: JSON.parse(JSON.stringify(t.info.inputSchema)) })),
        signal: context.signal,
      };
      run.reserveModel();
      modelCallId = createId('model');
      run.emit({ type: 'model.start', modelCallId }, { provider: model.provider, modelId: model.modelId });
      check();
      for await (const event of model.stream(input)) {
        check();
        ensure(!candidate && record(event), 'MODEL_PROTOCOL');
        if (event.type === 'text-delta') {
          ensure(typeof event.text === 'string', 'MODEL_PROTOCOL');
          deltaBytes += textBytes(event.text);
          ensure(deltaBytes <= run.limits.maxModelOutputBytes, 'MODEL_OUTPUT_TOO_LARGE');
          if (event.text) chunks.push(event.text);
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
      check();
      ensure(candidate, 'MODEL_PROTOCOL');
      return commit(candidate);
    } catch (cause) {
      let failureCause = cause;
      if (!run.intent && steeringSignal.aborted && !ended) {
        try {
          // A validated terminal result is already complete, even if steering
          // arrived while its iterator was closing. Preserve that result.
          if (candidate) return commit(candidate);
          // Only visible text is portable. Partial tool arguments and opaque
          // provider continuation state must never become executable history.
          if (modelCallId) {
            const text = chunks.join('');
            const partial = text ? createAssistant({ outcome: 'incomplete', text, toolCalls: [],
              finishReason: null, incompleteReason: 'steered',
            }, createId('msg'), run.limits.maxToolCalls) : undefined;
            if (partial) { run.history.commitAssistant(partial); run.recordAssistant(partial); }
            ended = true;
            run.emit({ type: 'model.end', modelCallId, outcome: 'steered' }, { assistantId: partial?.id, usage: partial?.usage });
          }
          run.check();
          return undefined;
        } catch (failure) { failureCause = failure; }
      }
      run.fail(failureCause, 'MODEL_FAILED');
      if (modelCallId && !ended) run.emit({ type: 'model.end', modelCallId, outcome: run.intent?.status === 'cancelled' ? 'cancelled' : 'failed' }, {
        errorCode: run.intent?.status === 'failed' ? run.intent.error.code : undefined,
      });
      throw new Stop();
    }
  });
}
