import { z } from 'zod';
import { createTool } from '@alpha/adk/core';

export const answer = (text = 'done') => ({ outcome: 'completed', text, toolCalls: [], finishReason: 'stop' });
export const call = (id = 'c1', name = 'lookup', args = { id: 'A' }) => ({ id, name, arguments: args });
export const request = (...toolCalls) => ({ outcome: 'tool_calls', text: '', toolCalls, finishReason: 'tool_calls' });
export function fakeModel(...steps) {
  const inputs = [];
  return {
    provider: 'fake', modelId: 'model', inputs,
    async generate() { throw new Error('The kernel should use stream.'); },
    async *stream(input) {
      if (this.modelId !== 'model') throw new Error('Receiver lost.');
      inputs.push(input);
      if (!steps.length) throw new Error('Unexpected model call');
      const step = steps.shift(), value = typeof step === 'function' ? step(input) : step;
      if (value?.[Symbol.asyncIterator]) { yield* value; return; }
      const result = await value;
      if (Array.isArray(result)) yield* result;
      else yield { type: 'finish', result };
    },
  };
}
export const tool = (execute = ({ id }) => id, effect = 'read') => createTool({
  name: 'lookup', description: 'Lookup a record', effect,
  input: z.strictObject({ id: z.string() }), execute,
});
export const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
export const options = model => ({ model, instructions: 'Use verified facts.' });
export const turn = () => new Promise(resolve => setImmediate(resolve));
