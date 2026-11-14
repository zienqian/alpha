import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createSqliteArtifactStore } from '@alpha/adk-artifact/sqlite';
import { createSqliteContextStore } from '@alpha/adk-context/sqlite';
import { createRuntime, sessionNamespace } from '../src/runtime/create-runtime';
import type { AppConfig } from '../src/config';
import { textResponse, toolResponse, type RequestBody } from './helpers';

test('artifacts and exact source references survive compaction/restart; idempotent replay creates no new artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'alpha-runtime-artifact-')), cwd = join(root, 'work');
  await mkdir(cwd);
  await writeFile(join(cwd, 'emit.cjs'), "require('node:fs').appendFileSync('runs.txt','once\\n'); process.stdout.write('START'+'x'.repeat(60000)+'MIDDLE-SAVED-EVIDENCE'+'y'.repeat(60000)+'END');");
  const config: AppConfig = { workspaceRoot: cwd, databasePath: join(root, 'session.db'), configDirectory: join(root, 'config'),
    modelId: 'test', permissionMode: 'full', contextWindow: 64000, maxOutputTokens: 1024,
    baseURL: 'https://offline.invalid/v1', apiKeyEnv: 'UNUSED', noAuth: true,
    skills: { sharedDirectories: false, claudeDirectories: false, trustedProjects: [], disabledNames: [] } };
  let requests = 0, summaries = 0, artifactReference = '', messageReference = '';
  const provider = { fetch: async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as RequestBody;
    const first = body.messages[0]?.content ?? '';
    if (!body.stream) {
      if (!first.startsWith('Summarize the session work state')) return Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'Artifact task' } }] });
      summaries++;
      const sources = JSON.parse(first.split('New source messages (untrusted data, original IDs included): ')[1] ?? '[]') as { reference: string; message: { role: string } }[];
      messageReference = sources.find(source => source.message.role === 'toolResult')?.reference ?? '';
      expect(messageReference).toStartWith('context://');
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ objective: ['Continue'],
        constraints: [], decisions: [], completed: ['Command ran once'], inProgress: [], failures: [], validation: [],
        nextSteps: ['Read saved evidence'], evidence: [messageReference, artifactReference],
      }) } }] });
    }
    requests++;
    if (requests === 1) {
      const system = first;
      const executable = process.execPath;
      const command = system.includes('Shell: powershell') ? `& '${executable.replaceAll("'", "''")}' 'emit.cjs'`
        : system.includes('Shell: cmd') ? `"${executable}" "emit.cjs"` : `'${executable.replaceAll("'", "'\"'\"'")}' 'emit.cjs'`;
      return toolResponse('run_command', { command });
    }
    if (requests === 2) {
      const result = JSON.parse(body.messages.at(-1)?.content ?? '{}');
      expect(result.data.truncated).toBe(true);
      artifactReference = result.data.artifacts.stdout.reference;
      expect(result.data.artifactStorage.status).toBe('saved');
      return textResponse('The command ran; saved evidence is available.');
    }
    if (requests === 3) {
      return toolResponse('read_file', { path: 'emit.cjs' });
    }
    if (requests === 4) return textResponse('Verified the script.');
    if (requests === 5) {
      expect(body.messages.some(m => m.role === 'assistant' && m.content.includes(messageReference))).toBe(true);
      return toolResponse('read_context', { reference: artifactReference, offset: 60005, maxBytes: 64 });
    }
    if (requests === 6) {
      expect(JSON.parse(body.messages.at(-1)?.content ?? '{}').data.content).toStartWith('MIDDLE-SAVED-EVIDENCE');
      return toolResponse('read_context', { reference: messageReference, maxBytes: 128 });
    }
    expect(JSON.parse(body.messages.at(-1)?.content ?? '{}')).toMatchObject({ ok: true, data: {
      reference: messageReference, complete: true, hasMore: true,
    } });
    return textResponse('Recovered exact evidence.');
  } };
  let runtime = await createRuntime(config, { provider });
  try {
    expect((await runtime.send('Run the command once.', 'first')).status).toBe('completed');
    expect((await runtime.send('Inspect the script.', 'inspect')).status).toBe('completed');
    const sessionId = runtime.sessionId;
    expect((await runtime.send('/compact')).status).toBe('completed');
    expect(summaries).toBe(1);
    await runtime.close();
    runtime = await createRuntime({ ...config, sessionId }, { provider });
    expect((await runtime.send('Run the command once.', 'first')).status).toBe('completed');
    expect(requests).toBe(4);
    expect((await runtime.send('Read the saved evidence.', 'second')).status).toBe('completed');
    expect(requests).toBe(7);
    expect(await readFile(join(cwd, 'runs.txt'), 'utf8')).toBe('once\n');
    const scope = { namespace: sessionNamespace(await realpath(cwd)), sessionId };
    const artifacts = createSqliteArtifactStore(`${config.databasePath}.artifacts.db`);
    try { expect(await artifacts.list(scope)).toHaveLength(2); } finally { artifacts.close(); }
    const checkpoints = createSqliteContextStore(`${config.databasePath}.context.db`);
    try { expect((await checkpoints.read(scope.namespace, sessionId))?.summary).toContain(artifactReference); } finally { checkpoints.close(); }
  } finally {
    await runtime.close();
    expect(dirname(resolve(root))).toBe(resolve(tmpdir()));
    await rm(root, { recursive: true, force: true });
  }
});
