import type { LanguageModel } from '@alpha/provider';
import type { AssistantMessage, Hooks, ModelContextProvider, Tool } from '../contracts';
import type { Run } from './run-controller';
import { Stop } from './run-controller';
import { ensure } from './errors';
import { bytes, createId, record, textBytes } from './json';
import { createAssistant } from './messages';
import { prepareContext } from './prepare-context';
import { estimateContextTokens } from '../model-context';

export function callModel<C>(run: Run<C>, model: LanguageModel, instructions: string, tools: readonly Tool<C>[], hooks: Hooks<C>, steeringSignal: AbortSignal, provider?: ModelContextProvider): Promise<AssistantMessage | undefined> {
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
      const prepare = (mode: 'auto' | 'emergency') => prepareContext({ history: run.history.messages, instructions, tools, hooks, model, provider,
        context, limits: run.limits, mode, protectedIds: run.userIds, reserve: () => run.reserveModel(), usage: run.recordUsage });
      let input = await prepare('auto');
      let retried = false;
      while (true) {
        let observed = false;
        try {
          run.reserveModel();
          modelCallId = createId('model');
          run.emit({ type: 'model.start', modelCallId }, { provider: model.provider, modelId: model.modelId });
          check();
          for await (const event of model.stream(input)) {
            observed = true;
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
          if (candidate.usage) { try { provider?.usage?.(candidate.usage, estimateContextTokens(input)); } catch { /* Observation only. */ } }
          return commit(candidate);
        } catch (cause) {
          // Only normalized pre-stream context failures can be retried. No run/tool replay.
          if (!provider || retried || observed || (cause as { code?: string })?.code !== 'CONTEXT_LENGTH_EXCEEDED') throw cause;
          retried = true;
          if (modelCallId) run.emit({ type: 'model.end', modelCallId, outcome: 'failed' }, { errorCode: 'CONTEXT_LENGTH_EXCEEDED' });
          modelCallId = undefined;
          input = await prepare('emergency');
        }
      }
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
