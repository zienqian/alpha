import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createRun } from '../dist/core/internal/run-controller';
import { createEvents } from '../dist/core/internal/events';
import { createHistory } from '../dist/core/internal/history';
import { createAssistant } from '../dist/core/internal/messages';
import { defaultLimits } from '../dist/core/internal/config';
import { callTool } from '../dist/core/internal/tool-gateway';
import { request, call, tool, deferred, turn } from './helpers';

function fixture() {
  const history = createHistory(defaultLimits), events = createEvents(), seen = [];
  events.subscribe(e => seen.push(e));
  const run = createRun('test', undefined, history, events, defaultLimits, () => {});
  run.begin(); return { history, run, seen };
}
test('internal duplicate calls return the same result without repeating effects or events', async () => {
  const { run, history, seen } = fixture();
  const message = createAssistant(request(call()), 'a1', 32);
  history.commitAssistant(message); run.recordAssistant(message);
  let count = 0; const tools = new Map([['lookup', tool(() => { count++; return 'ok'; })]]);
  const first = await callTool(run, tools, {}, 'a1', 'c1'), eventCount = seen.length;
  assert.equal(await callTool(run, tools, {}, 'a1', 'c1'), first);
  assert.equal(count, 1); assert.equal(seen.length, eventCount);
  await assert.rejects(callTool(run, tools, {}, 'forged', 'c1'));
  assert.equal((await run.finish()).error.code, 'CALL_NOT_PENDING');
});

test('overlapping internal operations fail and wait for accepted work', async () => {
  const { run } = fixture(), entered = deferred(), release = deferred();
  const first = run.operate(async () => { entered.resolve(); await release.promise; run.check(); });
  first.catch(() => undefined);
  await entered.promise;
  assert.throws(() => run.operate(async () => undefined));
  let finished = false;
  const result = run.finish().then(r => { finished = true; return r; });
  await turn(); assert.equal(finished, false);
  release.resolve(); await first.catch(() => undefined);
  assert.equal((await result).error.code, 'RUN_OPERATION_BUSY');
});

test('detached operation is an invariant failure, and cleanup waits for it', async () => {
  const { run } = fixture(), release = deferred();
  const work = run.operate(async () => { await release.promise; });
  let settled = false; const result = run.finish().then(r => { settled = true; return r; });
  await turn(); assert.equal(settled, false);
  release.resolve(); await work;
  assert.equal((await result).error.code, 'INTERNAL_INVARIANT');
});
