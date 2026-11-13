import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createRuntime, sessionNamespace } from '../src/runtime/create-runtime';
import { createSqliteSessionStore } from '@alpha/adk-session/sqlite';
import { createSqliteContextStore } from '@alpha/adk-context/sqlite';
import type { AppConfig } from '../src/config';
import { textResponse } from './helpers';

test('manual compaction adds no archive turn, survives restart and does not run on idempotent replay', async () => {
  const root = await mkdtemp(join(tmpdir(), 'alpha-context-'));
  const cwd = join(root, 'work'); await mkdir(cwd);
  const config: AppConfig = { workspaceRoot: cwd, databasePath: join(root, 'session.db'), configDirectory: join(root, 'config'),
    modelId: 'test', contextWindow: 32000, maxOutputTokens: 1024, baseURL: 'https://offline.invalid/v1', apiKeyEnv: 'UNUSED', noAuth: true,
    skills: { sharedDirectories: false, claudeDirectories: false, trustedProjects: [], disabledNames: [] } };
  const requests: { stream?: boolean; max_tokens?: number; messages: { role: string; content: string }[]; tools?: unknown[] }[] = [];
  let summaries = 0;
  const provider = { fetch: async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)); requests.push(body);
    if (body.stream) return textResponse('done');
    if (body.messages[0].content.startsWith('Summarize the session work state')) {
      summaries++;
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ objective: ['Context implementation'], constraints: ['No Memory'], decisions: [], completed: [], inProgress: [], failures: [], validation: [], nextSteps: ['Continue'], evidence: [] }) } }] });
    }
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'Context project' } }] });
  } };
  let runtime = await createRuntime(config, { provider });
  try {
    await runtime.send('No Memory. ' + 'x'.repeat(1500), 'one');
    await runtime.send('More work. ' + 'y'.repeat(1500), 'two');
    const sessionId = runtime.sessionId;
    const compact = await runtime.send('/compact');
    expect(compact.localResult?.kind).toBe('compact');
    expect(summaries).toBe(1);
    expect(runtime.contextUsage?.tokens?.summary).toBeGreaterThan(0);
    await runtime.close();
    const store = await createSqliteSessionStore({ filename: config.databasePath });
    const snapshot = await store.read({ namespace: sessionNamespace(cwd), id: sessionId });
    expect(snapshot?.data.turns).toHaveLength(2);
    expect(snapshot?.data.turns[0]?.messages[0]).toMatchObject({ role: 'user', content: 'No Memory. ' + 'x'.repeat(1500) });
    await store.close();
    const cache = createSqliteContextStore(`${config.databasePath}.context.db`);
    expect(await cache.read(sessionNamespace(cwd), sessionId)).toBeDefined(); cache.close();
    runtime = await createRuntime({ ...config, sessionId }, { provider });
    const beforeReplay = requests.length;
    await runtime.send('More work. ' + 'y'.repeat(1500), 'two');
    expect(requests).toHaveLength(beforeReplay);
    await runtime.send('continue', 'three');
    expect(summaries).toBe(1);
    expect(requests.at(-1)?.messages.some(m => m.role === 'assistant' && m.content.includes('SESSION WORK STATE'))).toBe(true);
    expect(requests.at(-1)?.max_tokens).toBe(1024);
    await runtime.close();
    runtime = await createRuntime(config, { provider });
    await runtime.send('new task');
    expect(requests.findLast(r => r.stream)?.messages.some(m => m.content.includes('SESSION WORK STATE'))).toBe(false);
  } finally {
    await runtime.close();
    expect(dirname(resolve(root))).toBe(resolve(tmpdir()));
    await rm(root, { recursive: true, force: true });
  }
});
