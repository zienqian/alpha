import { expect, test } from 'bun:test';
import { createMemoryArtifactStore } from '@alpha/adk-artifact';
import { createCodingAgent } from '../dist/index';
import { captureCommandArtifacts } from '../dist/command-artifacts';
import { answer, call, fakeModel, fixture, request, results, scriptCommand } from './helpers';

const scope = { namespace: 'project', sessionId: 'session' };
test('command preview retains references to omitted output; read_context recovers it without rerunning', async () => {
  await using f = await fixture({ 'output.cjs': "process.stdout.write('HEAD'+'x'.repeat(60000)+'MIDDLE-EVIDENCE'+'y'.repeat(60000)+'TAIL'); process.stderr.write('stderr evidence');" });
  const store = createMemoryArtifactStore();
  const model = fakeModel(request(call('run_command', { command: scriptCommand('output.cjs') })), input => {
    const result = JSON.parse(input.messages.at(-1).content);
    expect(result.data.truncated).toBe(true);
    expect(result.data.stdout).not.toContain('MIDDLE-EVIDENCE');
    expect(result.data.artifactStorage.status).toBe('saved');
    expect(result.data.artifacts.stdout.complete).toBe(true);
    return request(call('read_context', { reference: result.data.artifacts.stdout.reference, offset: 60004, maxBytes: 64 }, 'read'));
  }, input => {
    expect(JSON.parse(input.messages.at(-1).content).data.content).toStartWith('MIDDLE-EVIDENCE');
    return answer();
  });
  const agent = await createCodingAgent({ cwd: f.cwd, model, artifacts: { store, scope }, policy: { decide: () => 'allow' } });
  try {
    expect((await agent.prompt('run once')).status).toBe('completed');
    expect(results(agent)).toHaveLength(2);
    expect(await store.list(scope)).toHaveLength(2);
  } finally { await agent.close(); }
});

test('capture limits are independent, UTF-8 safe, and failed storage never rewrites command facts', async () => {
  const store = createMemoryArtifactStore();
  const capture = captureCommandArtifacts({ artifacts: { store, scope, maxOutputBytes: 4 } }, 'run', 'assistant', 'call');
  capture.capture('stdout', '汉😀'); capture.capture('stdout', 'x');
  capture.capture('stderr', 'err');
  const outcome = { status: 'exited', exitCode: 7, stdout: 'preview', stderr: 'err', truncated: true, outputIncomplete: false };
  const saved = await capture.save(outcome);
  expect(saved.artifacts.stdout.complete).toBe(false);
  expect(saved.artifacts.stderr.complete).toBe(true);
  expect((await store.read(scope, { reference: saved.artifacts.stdout.reference })).content).toBe('汉');
  await using f = await fixture();
  const broken = { put() { throw Error('private disk failure'); } };
  const agent = await createCodingAgent({ cwd: f.cwd,
    model: fakeModel(request(call('run_command', { command: 'exit 7' })), answer()),
    artifacts: { store: broken, scope }, policy: { decide: () => 'allow' } });
  try {
    expect((await agent.prompt('run')).status).toBe('completed');
    expect(results(agent)[0].data).toMatchObject({ ok: false, code: 'COMMAND_EXIT_NONZERO', detail: {
      exitCode: 7, artifactStorage: { status: 'failed', code: 'ARTIFACT_SAVE_FAILED' }, artifacts: {},
    } });
    expect(results(agent)[0].content).not.toContain('private disk failure');
  } finally { await agent.close(); }
});

test('unknown command captures remain incomplete; not-started commands publish no artifacts', async () => {
  const store = createMemoryArtifactStore();
  const capture = captureCommandArtifacts({ artifacts: { store, scope } }, 'run', 'assistant', 'call');
  capture.capture('stdout', 'partial');
  await capture.save({ status: 'unknown', code: 'COMMAND_CANCELLED' });
  expect((await store.list(scope)).every(entry => !entry.complete)).toBe(true);
  const empty = captureCommandArtifacts({ artifacts: { store, scope } }, 'run', 'assistant', 'next');
  expect(await empty.save({ status: 'not_started', code: 'CANCELLED' })).toEqual({});
  expect(await store.list(scope)).toHaveLength(2);
});
