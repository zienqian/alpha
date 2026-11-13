import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createTool } from '@alpha/adk/core';
import { z } from 'zod';
import { createCodingAgent, readFileTool, runCommandTool } from '../dist/index';
import { answer, fakeModel, fixture } from './helpers';

test('built-in instructions reach every model request without entering conversation history', async () => {
  await using f = await fixture({ 'AGENTS.md': 'Project convention: use bun:test.' });
  const model = fakeModel(answer(), answer()), extra = 'Caller convention: use concise Chinese.';
  const agent = await createCodingAgent({ cwd: f.cwd, model, instructions: extra });
  try {
    await agent.prompt('one'); await agent.prompt('two');
    const prompt = model.inputs[0].messages[0];
    assert.equal(prompt.role, 'system');
    assert.match(prompt.content, /## Working on the task/);
    assert.match(prompt.content, /## Tools and trust/);
    assert.match(prompt.content, /## Verification and communication/);
    assert.ok(prompt.content.endsWith(extra));
    assert.ok(prompt.content.includes(f.cwd));
    assert.equal(model.inputs[1].messages[0].content, prompt.content);
    for (const input of model.inputs) {
      assert.equal(input.messages.filter(message => message.role === 'system').length, 1);
      assert.ok(input.messages.some(message => message.role === 'user' && message.content.includes('Project convention:')));
    }
    assert.ok(!agent.state.messages.some(message => message.content?.includes('## Working on the task')));
  } finally { await agent.close(); }
});

test('read-only and empty presets do not advertise disabled built-in workflows', async () => {
  await using f = await fixture();
  for (const tools of [[readFileTool], []]) {
    const model = fakeModel(answer());
    const agent = await createCodingAgent({ cwd: f.cwd, model, shell: false, tools, fileAccess: 'host', commandTimeoutMs: null });
    try {
      await agent.prompt('inspect');
      const prompt = model.inputs[0].messages[0].content;
      assert.deepEqual(model.inputs[0].tools.map(tool => tool.name), tools.map(tool => tool.info.name));
      assert.doesNotMatch(prompt, /edit_file|create_file|run_command|readSkill|timeoutMs|LASTEXITCODE/);
      assert.equal(prompt.includes('Use read_file'), tools.length === 1);
      assert.equal(prompt.includes('symbolic links are followed'), tools.length === 1);
      assert.equal(prompt.includes('Built-in coding tools return JSON'), tools.length === 1);
    } finally { await agent.close(); }
  }
});

test('custom same-name tools do not inherit built-in command contracts', async () => {
  await using f = await fixture();
  const custom = createTool({ name: 'run_command', description: 'Custom tool', input: z.object({}), execute: () => 'custom' });
  const model = fakeModel(answer());
  const agent = await createCodingAgent({ cwd: f.cwd, model, tools: [custom], shell: false });
  try {
    await agent.prompt('hello');
    const prompt = model.inputs[0].messages[0].content;
    assert.doesNotMatch(prompt, /Use run_command|run_command is unavailable|Built-in coding tools return JSON|timeoutMs/);
    assert.deepEqual(model.inputs[0].tools.map(tool => tool.name), ['run_command']);
  } finally { await agent.close(); }
});

test('command instructions reflect actual shell, deadlines and workspace access', async () => {
  await using f = await fixture();
  for (const commandTimeoutMs of [1234, null]) {
    const model = fakeModel(answer());
    const agent = await createCodingAgent({ cwd: f.cwd, model, tools: [runCommandTool, readFileTool], commandTimeoutMs });
    try {
      await agent.prompt('inspect');
      const prompt = model.inputs[0].messages[0].content;
      assert.match(prompt, /paths relative to the working directory/);
      assert.equal(prompt.includes('exit $LASTEXITCODE'), /Shell: powershell \(/.test(prompt));
      assert.equal(prompt.includes('Commands have no execution deadline'), commandTimeoutMs === null);
      assert.equal(prompt.includes('deadline defaults to 1234 ms'), commandTimeoutMs === 1234);
      assert.match(prompt, /Commands run in separate processes/);
    } finally { await agent.close(); }
  }
  const model = fakeModel(answer());
  const agent = await createCodingAgent({ cwd: f.cwd, model, tools: [runCommandTool], shell: false, commandTimeoutMs: null });
  try {
    await agent.prompt('inspect');
    const prompt = model.inputs[0].messages[0].content;
    assert.match(prompt, /run_command is unavailable/);
    assert.doesNotMatch(prompt, /Commands have no execution deadline|Use run_command with|exit \$LASTEXITCODE/);
  } finally { await agent.close(); }
});
