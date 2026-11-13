import type { Plugin } from '@alpha/adk/core';
import type { CodingAction, CodingContext } from './contracts';
import { callKey } from './context';
import { checkSignal, digest, failure } from './internal';
import { prepareCodingCall } from './tools/index';

/** Internal permission hook. Tools are registered explicitly by createCodingAgent. */
export function createCodingPlugin<C>(context: CodingContext<C>, hasReadSkillTool = false): Plugin<CodingContext<C>> {
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
        const plan = await prepareCodingCall(ctx.app, call, ctx.signal, hasReadSkillTool);
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
      api.observe(event => { if (event.type === 'run.end') {
        state.plans.clear(); state.skillReads.clear();
        // Failed delivery/result processing must not leave a read capability for the next run.
        if (event.status !== 'completed') state.observations.clear();
      } });
    },
    dispose() { state.plans.clear(); state.observations.clear(); state.skillReads.clear(); },
  };
}
