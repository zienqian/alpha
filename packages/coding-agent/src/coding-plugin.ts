import type { Plugin } from '@alpha/adk/core';
import type { CodingAction, CodingContext } from './contracts.js';
import { callKey } from './context.js';
import { checkSignal, digest, failure } from './internal.js';
import { prepareCodingCall } from './tools/index.js';

/** Internal permission hook. Tools are registered explicitly by createCodingAgent. */
export function createCodingPlugin<C>(context: CodingContext<C>): Plugin<CodingContext<C>> {
  const { cwd, shell, controls, state } = context;
  return {
    id: 'coding/runtime', apiVersion: 1,
    setup(api) {
      if (state.used) throw failure('CODING_CONTEXT_ALREADY_USED');
      state.used = true;
      api.hook('beforeModel', (messages, ctx) => {
        if (ctx.app !== context) throw failure('CODING_CONTEXT_MISMATCH');
        return messages;
      });
      api.hook('authorizeTool', async (call, ctx) => {
        if (ctx.app !== context) throw failure('CODING_CONTEXT_MISMATCH');
        const plan = await prepareCodingCall(ctx.app, call, ctx.signal);
        const invocation = Object.freeze({ ...ctx, assistantId: call.assistantId, callId: call.callId });
        checkSignal(ctx.signal);
        const key = callKey(invocation);
        const retain = () => {
          if (['create', 'edit', 'command'].includes(plan.kind)) state.plans.set(key, plan);
        };
        if (plan.rejected) { retain(); return { action: 'allow' }; }
        const action: CodingAction = Object.freeze({ kind: plan.kind, cwd, call, preview: plan.preview,
          digest: await digest(JSON.stringify([cwd, shell, plan.args, plan.write ?? null, plan.preview])) });
        let decision = controls.policy ? await controls.policy.decide(action, invocation)
          : plan.kind === 'command' ? 'ask' : plan.kind === 'custom' ? 'deny' : 'allow';
        checkSignal(ctx.signal);
        if (decision === 'ask') decision = await controls.approve?.(action, invocation) ?? 'deny';
        checkSignal(ctx.signal);
        if (decision === 'allow') retain();
        return decision === 'allow' ? { action: 'allow' } : { action: 'deny', reason: 'Coding policy denied the action.' };
      });
      api.observe(event => { if (event.type === 'run.end') state.plans.clear(); });
    },
    dispose() { state.plans.clear(); state.observations.clear(); },
  };
}
