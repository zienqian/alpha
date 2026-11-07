import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTool } from '@alpha/adk/core';
import { createMemorySessionStore, createSession, createSessionPlugin } from '@alpha/adk-session';
import { z } from 'zod';
import { loadSkills, formatSkillsForPrompt, readSkill, readSkillTool, createCodingAgent, codingTools } from '../dist/index';
import { createCodingContext } from '../dist/context';
import { answer, call, request, fakeModel, results, fixture } from './helpers';

const document = (name, body = 'Full instructions\n', fields = '') => `---\nname: ${name}\ndescription: Review code carefully\n${fields}---\n${body}`;
const root = path => ({ path, source: 'project', trusted: true });

test('loads immutable metadata, keeps full bodies lazy and formats names without paths', async () => {
  await using workspace = await fixture({ 'review/SKILL.md': document('review', 'secret full body\n', 'argument-hint: <path>\n') });
  const loaded = await loadSkills({ roots: [root(workspace.cwd)] });
  assert.equal(loaded.diagnostics.length, 0);
  const skill = loaded.skills[0];
  assert.equal(skill.filePath, join(workspace.cwd, 'review', 'SKILL.md'));
  assert.equal(skill.baseDir, join(workspace.cwd, 'review'));
  assert.equal(skill.argumentHint, '<path>');
  assert.equal(skill.content, undefined);
  assert.ok(Object.isFrozen(skill) && Object.isFrozen(loaded.skills));
  const summary = formatSkillsForPrompt(loaded.skills);
  assert.match(summary, /readSkill/);
  assert.ok(!summary.includes(workspace.cwd) && !summary.includes('secret full body'));
  assert.equal((await readSkill(skill)).content, 'secret full body\n');
  await workspace.write('review/SKILL.md', document('review', 'changed'));
  await assert.rejects(readSkill(skill), { code: 'SKILL_CHANGED' });
});

test('honors root precedence, invalid winners, reserved and disabled names without recursive discovery', async () => {
  await using workspace = await fixture({
    'first/review/SKILL.md': 'invalid', 'second/review/SKILL.md': document('review'),
    'first/disabled/SKILL.md': document('disabled'), 'second/disabled/SKILL.md': document('disabled'),
    'first/skills/SKILL.md': document('skills'), 'first/group/nested/SKILL.md': document('nested'),
    'second/group/SKILL.md': document('group'),
  });
  const loaded = await loadSkills({ roots: [root(join(workspace.cwd, 'first')), root(join(workspace.cwd, 'second'))], disabledNames: ['disabled'], reservedNames: ['skills'] });
  assert.deepEqual(loaded.skills.map(skill => skill.name), ['group']);
  for (const code of ['SKILL_FRONTMATTER_REQUIRED', 'SKILL_SHADOWED', 'SKILL_DISABLED', 'SKILL_RESERVED_NAME']) assert.ok(loaded.diagnostics.some(diagnostic => diagnostic.code === code));
  const untrusted = await loadSkills({ roots: [{ ...root(join(workspace.cwd, 'missing')), trusted: false }] });
  assert.equal(untrusted.diagnostics[0].code, 'SKILL_ROOT_UNTRUSTED');
  assert.deepEqual(await loadSkills({ roots: [root(join(workspace.cwd, 'missing'))] }), { skills: [], diagnostics: [] });
});

for (const [title, text, code] of [
  ['duplicate', document('review', '', 'name: review\n'), 'SKILL_INVALID_YAML'],
  ['alias', document('review', '', 'metadata: &anchor {key: value}\nextra: *anchor\n'), 'SKILL_INVALID_YAML'],
  ['tag', document('review', '', 'extra: !custom value\n'), 'SKILL_INVALID_YAML'],
  ['merge', document('review', '', 'metadata: {<<: {key: value}}\n'), 'SKILL_INVALID_YAML'],
  ['unsupported hook', document('review', '', 'hooks: {}\n'), 'SKILL_UNSUPPORTED_FIELD'],
  ['no entrypoint', document('review', '', 'disable-model-invocation: true\nuser-invocable: false\n'), 'SKILL_NO_ENTRYPOINT'],
  ['wrong name', document('another'), 'SKILL_NAME_MISMATCH'],
  ['invalid name', document('bad--name'), 'SKILL_INVALID_NAME'],
  ['wrong boolean', document('review', '', 'user-invocable: yes\n'), 'SKILL_INVALID_FIELD'],
  ['large header', document('review', '', `extra: ${'x'.repeat(8192)}\n`), 'SKILL_FRONTMATTER_TOO_LARGE'],
  ['large file', document('review', 'x'.repeat(32768)), 'FILE_TOO_LARGE'],
  ['invalid encoding', Buffer.from([255, 254, 253]), 'INVALID_UTF8'],
  ['binary', Buffer.from([0]), 'BINARY_FILE'],
]) test(`diagnoses ${title} without leaking body or parser excerpts`, async () => {
  await using workspace = await fixture({ 'review/SKILL.md': text });
  const loaded = await loadSkills({ roots: [root(workspace.cwd)] });
  assert.equal(loaded.skills.length, 0);
  assert.equal(loaded.diagnostics[0].code, code);
  assert.deepEqual(Object.keys(loaded.diagnostics[0]).sort(), ['code', 'name', 'path', 'severity']);
});

test('accepts BOM/CRLF, literal template syntax and informational fields; ignores allowed-tools', async () => {
  const body = 'Use $ARGUMENTS, ${HOME} and !`echo nope` literally.\r\n';
  const text = '\uFEFF' + document('review', '', 'allowed-tools: [run_command]\nlicense: MIT\nmetadata: {author: test}\ncustom-note: x\n').replaceAll('\n', '\r\n') + body;
  await using workspace = await fixture({ 'review/SKILL.md': text });
  const loaded = await loadSkills({ roots: [root(workspace.cwd)] });
  assert.equal(loaded.skills.length, 1);
  assert.deepEqual(loaded.diagnostics.map(entry => entry.code), ['SKILL_ALLOWED_TOOLS_IGNORED', 'SKILL_UNKNOWN_FIELD']);
  assert.equal((await readSkill(loaded.skills[0])).content, body);
});

test('rejects symlink and junction roots, skill directories, and post-load replacements', async () => {
  await using workspace = await fixture({ 'actual/review/SKILL.md': document('review'), 'other/review/SKILL.md': document('review') });
  await symlink(join(workspace.cwd, 'actual'), join(workspace.cwd, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const linked = await loadSkills({ roots: [root(join(workspace.cwd, 'linked'))] });
  assert.equal(linked.diagnostics[0].code, 'LINK_NOT_ALLOWED');
  await mkdir(join(workspace.cwd, 'root'));
  await symlink(join(workspace.cwd, 'actual', 'review'), join(workspace.cwd, 'root', 'review'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await loadSkills({ roots: [root(join(workspace.cwd, 'root'))] })).diagnostics[0].code, 'LINK_NOT_ALLOWED');
  const skill = (await loadSkills({ roots: [root(join(workspace.cwd, 'actual'))] })).skills[0];
  await assert.rejects(readSkill({ ...skill, filePath: join(workspace.cwd, 'other', 'review', 'SKILL.md') }), { code: 'SKILL_INVALID_METADATA' });
});

test('cancellation and global scan budgets fail the whole load', async () => {
  await using workspace = await fixture();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(loadSkills({ roots: [], signal: controller.signal }), { code: 'CANCELLED' });
  await assert.rejects(loadSkills({ roots: Array.from({ length: 17 }, () => root(workspace.cwd)) }), { code: 'SKILL_INVALID_ROOTS' });
  await assert.rejects(loadSkills({ roots: [root('relative')] }), { code: 'SKILL_INVALID_PATH' });
  await Promise.all(Array.from({ length: 257 }, (_, index) => mkdir(join(workspace.cwd, `directory-${index}`))));
  await assert.rejects(loadSkills({ roots: [root(workspace.cwd)] }), { code: 'SKILL_SCAN_LIMIT' });
});

test('formatter is deterministic, filters manual-only skills and bounds whole JSON items', () => {
  assert.equal(formatSkillsForPrompt([]), '');
  assert.equal(formatSkillsForPrompt([{ name: 'manual', description: 'hidden', disableModelInvocation: true }]), '');
  const skills = Array.from({ length: 256 }, (_, index) => ({ name: `name-${index}`, description: '中文"\n'.repeat(200), disableModelInvocation: false }));
  const output = formatSkillsForPrompt(skills);
  assert.ok(Buffer.byteLength(output) <= 16384);
  const data = JSON.parse(output.slice(output.indexOf('{')));
  assert.equal(data.skills.length + data.omittedCount, 256);
  assert.equal(data.skills[0].description, skills[0].description);
  assert.equal(formatSkillsForPrompt(skills), output);
});

test('agent adds only readSkill, injects one summary per model call, persists only tool body and obeys policy', async () => {
  await using workspace = await fixture({ 'review/SKILL.md': document('review'), 'AGENTS.md': 'Project first' });
  const { skills } = await loadSkills({ roots: [root(workspace.cwd)] });
  const model = fakeModel(request(call('readSkill', { name: 'review' })), answer(), answer());
  const store = createMemorySessionStore();
  const session = await createSession({ store, namespace: 'skills', agentKey: 'test' });
  const actions = [];
  const agent = await createCodingAgent({ cwd: workspace.cwd, skills, model, policy: { decide(action) { actions.push(action); return 'allow'; } }, plugins: [createSessionPlugin({ session })] });
  const completed = await agent.prompt('review', { requestId: 'first' });
  await agent.prompt('again');
  assert.equal(codingTools.length, 6);
  assert.equal(model.inputs[0].tools.length, 7);
  assert.equal(actions[0].kind, 'read');
  assert.equal(actions[0].preview.path, skills[0].filePath);
  assert.equal(results(agent)[0].data.data.content, 'Full instructions\n');
  for (const input of model.inputs) assert.equal(input.messages.filter(message => message.content?.includes('Available skills are listed')).length, 1);
  assert.ok(!JSON.stringify((await session.getSnapshot()).data).includes('Available skills are listed'));
  await agent.close();
  await workspace.write('review/SKILL.md', 'invalid after completion');
  const replayModel = fakeModel();
  const replay = await createCodingAgent({ cwd: workspace.cwd, skills, model: replayModel, plugins: [createSessionPlugin({ session })] });
  assert.deepEqual(await replay.prompt('review', { requestId: 'first' }), completed);
  assert.equal(replayModel.inputs.length, 0);
  await replay.close(); await session.close(); await store.close();
});

test('skills are always available with an immutable empty registry when unconfigured', async () => {
  await using workspace = await fixture({});
  for (const options of [{}, { skills: [] }, { tools: [readSkillTool] }]) {
    const context = createCodingContext({ cwd: workspace.cwd, shell: false, ...options });
    assert.deepEqual(context.skills, []);
    assert.ok(Object.isFrozen(context.skills));
    const model = fakeModel(request(call('readSkill', { name: 'missing' })), answer());
    const agent = await createCodingAgent({ cwd: workspace.cwd, model, ...options });
    try {
      await agent.prompt('hi');
      assert.equal(model.inputs[0].tools.length, options.tools ? 1 : 7);
      assert.ok(model.inputs[0].tools.some(tool => tool.name === 'readSkill'));
      assert.ok(!JSON.stringify(model.inputs[0].messages).includes('Available skills are listed'));
      assert.equal(results(agent)[0].data.code, 'SKILL_NOT_FOUND');
    } finally { await agent.close(); }
  }
  await assert.rejects(createCodingAgent({ cwd: workspace.cwd, model: fakeModel(), skills: false }), { code: 'SKILL_INVALID_METADATA' });
});

test('explicit tools override defaults and custom same-name tools remain custom', async () => {
  await using workspace = await fixture({ 'review/SKILL.md': document('review') });
  const { skills } = await loadSkills({ roots: [root(workspace.cwd)] });
  await assert.rejects(createCodingAgent({ cwd: workspace.cwd, model: fakeModel(), skills: [...skills, ...skills] }), { code: 'SKILL_DUPLICATE_NAME' });
  const model = fakeModel(answer());
  const agent = await createCodingAgent({ cwd: workspace.cwd, model, skills, tools: [] });
  await agent.prompt('hi');
  assert.equal(model.inputs[0].tools.length, 0);
  assert.ok(!JSON.stringify(model.inputs[0].messages).includes('Available skills are listed'));
  await agent.close();
  const custom = createTool({ name: 'readSkill', description: 'Custom', input: z.object({}), execute: () => 'custom' });
  const customAgent = await createCodingAgent({ cwd: workspace.cwd, model: fakeModel(request(call('readSkill')), answer()), skills, tools: [custom] });
  await customAgent.prompt('hi');
  assert.equal(results(customAgent)[0].execution, 'denied');
  await customAgent.close();
});

test('readSkill respects approval, invocation flags and changes made after approval', async () => {
  await using workspace = await fixture({ 'review/SKILL.md': document('review'), 'manual/SKILL.md': document('manual', 'manual body', 'disable-model-invocation: true\n') });
  const { skills } = await loadSkills({ roots: [root(workspace.cwd)] });
  const agent = await createCodingAgent({ cwd: workspace.cwd, skills, model: fakeModel(request(call('readSkill', { name: 'review' })), answer()), policy: { decide: () => 'ask' }, approve: async () => {
    await workspace.write('review/SKILL.md', document('review', 'changed')); return 'allow';
  } });
  await agent.prompt('hi');
  assert.equal(results(agent)[0].data.code, 'SKILL_CHANGED');
  await agent.close();
  const denied = await createCodingAgent({ cwd: workspace.cwd, skills, model: fakeModel(request(call('readSkill', { name: 'review' })), answer()), policy: { decide: () => 'deny' } });
  await denied.prompt('hi'); assert.equal(results(denied)[0].execution, 'denied'); await denied.close();
  const manual = skills.find(skill => skill.name === 'manual');
  assert.equal((await readSkill(manual)).content, 'manual body');
  const flagged = await createCodingAgent({ cwd: workspace.cwd, skills, model: fakeModel(request(call('readSkill', { name: 'manual' })), request(call('readSkill', { name: 'missing' })), answer()) });
  await flagged.prompt('hi');
  assert.deepEqual(results(flagged).map(result => result.data.code), ['SKILL_MODEL_INVOCATION_DISABLED', 'SKILL_NOT_FOUND']);
  await flagged.close();
});

test('tool never truncates success, counts failed executions, resets budgets and grants no edit observation', async () => {
  await using workspace = await fixture({ 'review/SKILL.md': document('review', '"'.repeat(30000)) });
  const { skills } = await loadSkills({ roots: [root(workspace.cwd)] });
  const app = createCodingContext({ cwd: workspace.cwd, skills, shell: false });
  const signal = new AbortController().signal;
  const prepared = await readSkillTool.prepare({ name: 'review' }, signal);
  const ctx = { agentId: 'agent', runId: 'run', assistantId: 'assistant', callId: 'call', signal, app };
  assert.deepEqual(JSON.parse(await prepared.execute(ctx)), { ok: false, code: 'SKILL_CONTENT_TOO_LARGE' });
  assert.equal(app.state.observations.size, 0);
  for (let index = 0; index < 7; index++) await prepared.execute(ctx);
  assert.equal(JSON.parse(await prepared.execute(ctx)).code, 'SKILL_READ_LIMIT');
  await writeFile(skills[0].filePath, document('review'));
  const current = await loadSkills({ roots: [root(workspace.cwd)] });
  const steps = [...Array.from({ length: 9 }, () => request(call('readSkill', { name: 'review' }))), answer(), request(call('readSkill', { name: 'review' })), answer()];
  const agent = await createCodingAgent({ cwd: workspace.cwd, skills: current.skills, model: fakeModel(...steps) });
  await agent.prompt('one');
  assert.equal(results(agent).at(-1).data.code, 'SKILL_READ_LIMIT');
  await agent.prompt('two');
  assert.equal(results(agent).at(-1).data.ok, true);
  await agent.close();
});

test('successful byte budget is cumulative and strict tool schema rejects paths', async () => {
  await using workspace = await fixture({ 'review/SKILL.md': document('review', 'a'.repeat(23000)) });
  const { skills } = await loadSkills({ roots: [root(workspace.cwd)] });
  const app = createCodingContext({ cwd: workspace.cwd, skills, shell: false });
  const signal = new AbortController().signal;
  await assert.rejects(readSkillTool.prepare({ name: 'review', path: skills[0].filePath }, signal), { code: 'TOOL_INPUT_INVALID' });
  const prepared = await readSkillTool.prepare({ name: 'review' }, signal);
  const ctx = { agentId: 'agent', runId: 'run', assistantId: 'assistant', callId: 'call', signal, app };
  for (let index = 0; index < 5; index++) assert.equal(JSON.parse(await prepared.execute(ctx)).ok, true);
  assert.equal(JSON.parse(await prepared.execute(ctx)).code, 'SKILL_READ_LIMIT');
  assert.equal(app.state.observations.size, 0);
});
