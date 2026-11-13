import { test, expect } from 'bun:test';
import { encode, headTail } from '../dist/internal';

test('exact and passthrough refuse oversized content; compact preserves complete records and operation facts', () => {
  const content = { ok: true, data: { content: '"\t中文😀'.repeat(1000) } };
  for (const mode of ['exact', 'passthrough']) expect(() => encode(content, 1024, mode)).toThrow('RESULT_TOO_LARGE');
  const matches = Array.from({ length: 100 }, (_, i) => ({ path: `src/${i}.ts`, line: i + 1, text: 'exact "match" 中文😀'.repeat(10) }));
  const output = JSON.parse(encode({ ok: true, data: { matches, truncated: false } }, 2048, 'compact'));
  expect(output.data.truncated).toBe(true); expect(output.data.matches).toEqual(matches.slice(0, output.data.matches.length));
  const command = JSON.parse(encode({ ok: false, code: 'COMMAND_EXIT_NONZERO', detail: {
    exitCode: 9, outputIncomplete: true, truncated: false, stdout: 'FIRST' + 'x'.repeat(10000) + 'LAST', stderr: 'critical failure',
  } }, 1024, 'compact'));
  expect(command).toMatchObject({ ok: false, code: 'COMMAND_EXIT_NONZERO', detail: { exitCode: 9, outputIncomplete: true, truncated: true, stderr: 'critical failure' } });
  expect(command.detail.stdout.startsWith('FIRST')).toBe(true); expect(command.detail.stdout.endsWith('LAST')).toBe(true);
  expect(headTail('汉😀'.repeat(100), 100)).not.toContain('\ufffd');
});
