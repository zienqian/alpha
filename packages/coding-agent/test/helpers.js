import { createHash } from 'node:crypto';
export const answer = (text = 'done') => ({ outcome: 'completed', text, toolCalls: [], finishReason: 'stop' });
export const call = (name, args = {}, id = 'c1') => ({ id, name, arguments: args });
export const request = (...toolCalls) => ({ outcome: 'tool_calls', text: '', toolCalls, finishReason: 'tool_calls' });
export function fakeModel(...steps) {
  const inputs = [];
  return {
    provider: 'fake', modelId: 'model', inputs,
    async generate() { throw Error('Unexpected generate'); },
    async *stream(input) { inputs.push(input); if (!steps.length) throw Error('Unexpected model call'); const step = steps.shift(); yield { type: 'finish', result: await (typeof step === 'function' ? step(input) : step) }; },
  };
}
export const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { resolve, promise }; };
export const results = agent => agent.state.messages.filter(m => m.role === 'toolResult').map(m => ({ ...m, data: m.execution === 'succeeded' ? JSON.parse(m.content) : undefined }));
export function memoryWorkspace(initial = {}) {
  const files = new Map(Object.entries(initial)), effects = { writes: 0, commands: 0, acquire: 0, release: 0 };
  let owned = false;
  const revision = text => createHash('sha256').update(text).digest('hex');
  const workspace = {
    id: 'memory-workspace', root: '/project', shell: 'test', isolation: 'sandbox', files, effects,
    async readFile(path) { const content = files.get(path); return content === undefined ? undefined : { path, content, revision: revision(content) }; },
    async listFiles() { return { paths: [...files.keys()].sort(), truncated: false }; },
    async search({ query }) { return { matches: [...files].filter(([,text]) => text.includes(query)).map(([path,text]) => ({ path, text, line: 1 })), truncated: false }; },
    async acquire() {
      if (owned) throw Error('BUSY'); owned = true; effects.acquire++;
      return {
        async writeFile(input) {
          const current = files.get(input.path);
          if ((current === undefined ? null : revision(current)) !== input.expectedRevision) return { status: 'rejected', code: 'FILE_CONFLICT' };
          effects.writes++; files.set(input.path, input.content); return { status: 'applied', revision: revision(input.content) };
        },
        async runCommand(input, options) { effects.commands++; options.onOutput?.('stdout', 'output'); return { status: 'exited', exitCode: input.command === 'fail' ? 1 : 0, stdout: 'output', stderr: '', truncated: false }; },
        async release() { if (owned) { owned = false; effects.release++; } },
      };
    },
    async close() { if (owned) throw Error('Lease still owned'); },
  };
  return workspace;
}
