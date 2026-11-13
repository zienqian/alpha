import type { GenerateInput, LanguageModel } from '@alpha/provider';
import type { Hooks, Limits, Message, ModelContextPlan, ModelContextProvider, ModelContextRequest, RunContext, Tool, Usage } from '../contracts';
import { estimateContextTokens, projectContextMessages } from '../model-context';
import { boundaryError, ensure, error } from './errors';
import { bytes, equalJson } from './json';
import { copyMessages } from './messages';

export async function prepareContext<C>(options: {
  history: readonly Message[]; instructions: string; tools: readonly Tool<C>[]; hooks: Hooks<C>;
  model: LanguageModel; provider?: ModelContextProvider; context: RunContext<C>; limits: Readonly<Limits>;
  mode?: ModelContextRequest['mode']; protectedIds?: readonly string[];
  reserve: () => void; usage: (usage?: Usage) => void;
}): Promise<GenerateInput> {
  const { history, instructions, tools, hooks, model, provider, context, limits } = options;
  const check = () => context.signal.throwIfAborted();
  check();
  let messages = history;
  for (const hook of hooks.beforeModel ?? []) {
    try { messages = await hook(messages, context); } catch { check(); throw error('HOOK_FAILED'); }
    check();
  }
  messages = copyMessages(messages, limits.maxToolCalls, 'MODEL_PROTOCOL');
  const originals = new Map(history.map(m => [m.id, m]));
  for (const m of messages) {
    const old = originals.get(m.id);
    if (m.role === 'custom') throw error('MODEL_PROTOCOL');
    if (old?.role === 'toolResult' || (old?.role === 'assistant' && (old.toolCalls.length || old.continuation)) ||
        m.role === 'toolResult' || (m.role === 'assistant' && (m.toolCalls.length || m.continuation))) ensure(equalJson(old, m), 'MODEL_PROTOCOL');
  }
  const schemas = tools.map(t => ({ name: t.info.name, description: t.info.description, inputSchema: JSON.parse(JSON.stringify(t.info.inputSchema)) }));
  let input: GenerateInput = { messages: [{ role: 'system', content: instructions }, ...projectContextMessages(messages)], tools: schemas, signal: context.signal };
  let accept: ModelContextPlan['accept'];
  if (provider) {
    // Every injected instruction, current steering anchor and latest complete tool batch is pinned.
    const protectedIds = new Set([...messages.filter(m => !originals.has(m.id)).map(m => m.id), ...(options.protectedIds ?? [])]);
    const lastUser = history.findLast(m => m.role === 'user');
    if (lastUser) protectedIds.add(lastUser.id);
    const lastBatch = history.findLastIndex(m => m.role === 'assistant' && m.toolCalls.length > 0);
    if (lastBatch >= 0) {
      const assistant = history[lastBatch];
      if (assistant.role === 'assistant') for (const m of history.slice(lastBatch, lastBatch + assistant.toolCalls.length + 1)) protectedIds.add(m.id);
    }
    let preparing = true, summarizing = false;
    try {
      const plan = await Promise.resolve(provider.prepare(Object.freeze({ history, messages, instructions, tools: Object.freeze(tools.map(t => t.info)),
        model: Object.freeze({ provider: model.provider, modelId: model.modelId, metadata: model.metadata }),
        protectedIds: Object.freeze([...protectedIds]), mode: options.mode ?? 'auto', signal: context.signal,
        async summarize(text: string, maxOutputTokens: number) {
          check();
          ensure(preparing && !summarizing, 'RUN_PREPARATION_CLOSED');
          ensure(typeof text === 'string' && Number.isSafeInteger(maxOutputTokens) && maxOutputTokens > 0, 'MODEL_PROTOCOL');
          options.reserve();
          summarizing = true;
          const signal = AbortSignal.any([context.signal, AbortSignal.timeout(60_000)]);
          // Race cancellation even when a custom transport ignores the signal.
          let abort!: () => void;
          const cancelled = new Promise<never>((_, reject) => { abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true }); });
          try {
            const response = await Promise.race([model.generate({ messages: [{ role: 'user', content: text }], tools: [], maxOutputTokens, signal }), cancelled]);
            check(); ensure(preparing, 'RUN_PREPARATION_CLOSED'); options.usage(response.usage);
            ensure(response.outcome === 'completed' && response.toolCalls.length === 0 && typeof response.text === 'string' && response.text.trim() && bytes(response.text) <= limits.maxModelOutputBytes, 'CONTEXT_COMPACTION_FAILED');
            return response.text;
          } finally { summarizing = false; signal.removeEventListener('abort', abort); }
        },
      }))).finally(() => { preparing = false; });
      check();
      ensure(Array.isArray(plan.messageIds) && new Set(plan.messageIds).size === plan.messageIds.length, 'MODEL_PROTOCOL');
      const kept = new Set(plan.messageIds);
      ensure([...protectedIds].every(id => kept.has(id)), 'MODEL_PROTOCOL');
      const selected = messages.filter(m => kept.has(m.id));
      ensure(selected.length === kept.size && selected.every((m, i) => m.id === plan.messageIds[i]), 'MODEL_PROTOCOL');
      copyMessages(selected, limits.maxToolCalls, 'MODEL_PROTOCOL');
      ensure(Number.isSafeInteger(plan.maxOutputTokens) && plan.maxOutputTokens > 0, 'MODEL_PROTOCOL');
      ensure(plan.summary === undefined || (typeof plan.summary === 'string' && plan.summary.trim() && bytes(plan.summary) <= limits.maxModelOutputBytes), 'MODEL_PROTOCOL');
      const projected = projectContextMessages(selected);
      const firstHistory = selected.findIndex(m => originals.has(m.id));
      if (plan.summary) projected.splice(firstHistory < 0 ? projected.length : firstHistory, 0, { role: 'assistant', content: plan.summary });
      input = { ...input, maxOutputTokens: plan.maxOutputTokens, messages: [{ role: 'system', content: instructions },
        ...projected] };
      if (plan.inputBudget !== undefined) {
        ensure(Number.isSafeInteger(plan.inputBudget) && plan.inputBudget > 0 && Number.isFinite(plan.tokenScale ?? 1) && (plan.tokenScale ?? 1) >= 1, 'MODEL_PROTOCOL');
        ensure(estimateContextTokens(input, plan.tokenScale) <= plan.inputBudget, 'CONTEXT_LIMIT');
      }
      check(); accept = plan.accept;
    } catch (cause) { preparing = false; check(); throw boundaryError(cause); }
  }
  ensure((limits.maxHistoryMessages === null || input.messages.length - 1 <= limits.maxHistoryMessages)
    && (limits.maxHistoryBytes === null || bytes(input.messages) <= limits.maxHistoryBytes), 'MODEL_PROTOCOL');
  check(); accept?.();
  return input;
}
