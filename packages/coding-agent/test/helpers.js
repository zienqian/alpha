import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { selectShell } from '../dist/process/shell';
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

export async function fixture(initial = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'alpha-coding-test-'));
  for (const [path, content] of Object.entries(initial)) { await mkdir(dirname(join(cwd, path)), { recursive: true }); await writeFile(join(cwd, path), content); }
  return {
    cwd,
    read: path => readFile(join(cwd, path), 'utf8'),
    write: (path, content) => writeFile(join(cwd, path), content),
    async [Symbol.asyncDispose]() {
      assert.equal(dirname(resolve(cwd)), resolve(tmpdir()));
      assert.ok(basename(cwd).startsWith('alpha-coding-test-'));
      await rm(cwd, { recursive: true, force: true });
    },
  };
}
export function scriptCommand(file, shell = selectShell()) {
  if (shell.family === 'powershell') return `& '${process.execPath.replaceAll("'", "''")}' '${file.replaceAll("'", "''")}'`;
  if (shell.family === 'cmd') return `"${process.execPath}" "${file}"`;
  const quote = text => "'" + text.replaceAll("'", "'\"'\"'") + "'";
  return `${quote(process.execPath)} ${quote(file)}`;
}
export const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function waitFile(path) {
  for (let i = 0; i < 300; i++) { try { const value = await readFile(path, 'utf8'); if (value) return value; } catch {} await pause(20); }
  throw Error('Fixture child did not start');
}
