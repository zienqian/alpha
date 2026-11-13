// Isolated CLI pilot; intentionally does not import or replace the production tool.
// See docs/search-ast-grep-evaluation.md for setup, scope, and interpretation.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus, platform, release, tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  'ast-grep': { type: 'string' },
  'tokenizer-root': { type: 'string' },
  output: { type: 'string' },
  repetitions: { type: 'string', default: '15' },
  rg: { type: 'string', default: 'rg' },
} });
if (!values['ast-grep'] || !values['tokenizer-root'] || !values.output) {
  throw new Error('Required: --ast-grep <executable> --tokenizer-root <npm prefix> --output <json>');
}
const repetitions = Number(values.repetitions);
if (!Number.isInteger(repetitions) || repetitions < 3) throw new Error('repetitions must be >= 3');
const require = createRequire(join(resolve(values['tokenizer-root']), 'package.json'));
const { getEncoding } = require('js-tiktoken');
const tokenizer = getEncoding('o200k_base');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = mkdtempSync(join(tmpdir(), 'alpha-search-pilot-'));
const config = join(scratch, 'sgconfig.yml');
writeFileSync(config, 'ruleDirs: []\n');
const normalize = path => path.replaceAll('\\', '/').replace(/^\.\//, '');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const invoke = (exe, args, cwd) => {
  const result = spawnSync(exe, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  if (result.error || ![0, 1].includes(result.status)) {
    throw new Error(`${exe}: ${result.error?.message ?? result.stderr ?? result.status}`);
  }
  return result.stdout;
};
const ignoreArgs = ['--no-config', '--hidden', '--glob', '!.git/**'];
const manifest = [];
// Freeze one ignore-aware .ts corpus for all arms, including current uncommitted content.
const files = invoke(values.rg, [...ignoreArgs, '--files', '--sort', 'path', 'packages', 'apps'], root)
  .trim().split(/\r?\n/).filter(path => path.endsWith('.ts'));
const repoSnapshot = join(scratch, 'repo');
for (const file of files) {
  const source = join(root, file);
  const stat = lstatSync(source);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1048576) continue;
  const target = join(repoSnapshot, file);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  const bytes = readFileSync(target);
  manifest.push({ path: normalize(file), bytes: bytes.length, sha256: hash(bytes) });
}
// Independently specified line-level truth: direct, non-optional calls named createTool.
// This is syntax truth, not import/type/binding identity.
const fixtureLines = [
  "import { createTool } from 'example';",
  '// createTool({ comment: true });',
  'const text = "createTool({ string: true })";',
  'const first = createTool({});',
  'const multiline = createTool',
  '(',
  '  { name: "multiline" }',
  ');',
  'const generic = createTool<Context>({});',
  'const member = other.createTool({});',
  'const similar = createToolbox({});',
  'const reference = createTool;',
  'const nested = createTool({ run: () => createTool({}) });',
];
const fixture = join(scratch, 'fixture');
mkdirSync(fixture);
writeFileSync(join(fixture, 'fixture.ts'), fixtureLines.join('\n') + '\n');
const expectedLines = [4, 5, 9, 13];
const queries = [
  ['createTool', 'createTool($$$ARGS)'],
  ['failure', 'failure($$$ARGS)'],
  ['JSON.parse', 'JSON.parse($$$ARGS)'],
  ['runProcess', 'runProcess($$$ARGS)'],
  ['resolvePath', 'resolvePath($$$ARGS)'],
  ['ALPHA_SEARCH_PILOT_ABSENT_7812', 'ALPHA_SEARCH_PILOT_ABSENT_7812($$$ARGS)'],
];
const scopes = [
  { name: 'coding-agent-src', cwd: join(repoSnapshot, 'packages/coding-agent/src') },
  { name: 'repo-ts', cwd: repoSnapshot },
  { name: 'fixture', cwd: fixture },
];
const arms = ['rg-current-cli', 'rg-unsorted-cli', 'ast-grep-cli'];
const compare = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || a.line - b.line || (a.column ?? 0) - (b.column ?? 0);
function encode(matches, rawTruncated) {
  const data = { matches: matches.slice(0, 100), truncated: rawTruncated || matches.length > 100 };
  let output = JSON.stringify({ ok: true, data });
  // Same array-halving behavior and default 128 KiB core budget as the current wrapper.
  while (Buffer.byteLength(output) > 128 * 1024) {
    data.truncated = true;
    data.matches = data.matches.slice(0, Math.floor(data.matches.length / 2));
    output = JSON.stringify({ ok: true, data });
  }
  return { text: output, returned: data.matches.length, truncated: data.truncated };
}
function execute(job) {
  const { arm, scope, query, pattern } = job;
  const ast = arm === 'ast-grep-cli';
  const args = ast
    ? ['run', '--config', config, '--custom-languages', 'ignore', '--pattern', pattern, '--lang', 'ts', '--json=stream', '--color', 'never', '--no-ignore', 'hidden', '.']
    : [...ignoreArgs, '--json', '--fixed-strings', ...(arm === 'rg-current-cli' ? ['--sort', 'path'] : []), '--max-filesize', '1048576', '--', query, '.'];
  const start = performance.now();
  const raw = invoke(ast ? values['ast-grep'] : values.rg, args, scope.cwd);
  const processMs = performance.now() - start;
  const rawBytes = Buffer.byteLength(raw);
  const rawTruncated = rawBytes > 4 * 1024 * 1024;
  let lines = (rawTruncated ? Buffer.from(raw).subarray(0, 4 * 1024 * 1024).toString('utf8') : raw).split('\n');
  if (rawTruncated) lines.pop();
  const events = lines.filter(Boolean).map(line => JSON.parse(line));
  const matches = (ast ? events.map(event => ({ path: normalize(event.file), line: event.range.start.line + 1, column: event.range.start.column, text: event.text }))
    : events.filter(event => event.type === 'match' && event.data.path?.text && event.data.lines?.text !== undefined)
      .map(event => ({ path: normalize(event.data.path.text), line: event.data.line_number, text: event.data.lines.text.replace(/\r?\n$/, '') }))).sort(compare);
  const full = encode(matches.map(({ path, line, text }) => ({ path, line, text })), rawTruncated);
  const locations = [...new Map(matches.map(({ path, line }) => [`${path}\0${line}`, { path, line }])).values()];
  const compact = encode(locations, rawTruncated);
  const adapterMs = performance.now() - start;
  return { processMs, adapterMs, rawBytes, rawTruncated, matches: matches.length, uniqueLocations: locations.length, full, compact,
    ...(scope.name === 'fixture' ? { foundLines: [...new Set(locations.map(item => item.line))] } : {}) };
}
const jobs = scopes.flatMap(scope => (scope.name === 'fixture' ? queries.slice(0, 1) : queries)
  .flatMap(([query, pattern]) => arms.map(arm => ({ scope, query, pattern, arm, samples: [] }))));
// Fixed-seed interleaving avoids running every rg measurement before every AST measurement.
let seed = 20261113;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
const shuffled = items => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
  return copy;
};
for (let round = -2; round < repetitions; round++) {
  for (const job of shuffled(jobs)) {
    const result = execute(job);
    if (job.result && (job.result.full.text !== result.full.text || job.result.compact.text !== result.compact.text)) throw new Error(`Unstable results: ${job.scope.name}/${job.query}/${job.arm}`);
    job.result = result;
    if (round >= 0) job.samples.push({ processMs: result.processMs, adapterMs: result.adapterMs });
  }
}
for (const baseline of jobs.filter(job => job.arm === 'rg-current-cli')) {
  const parallel = jobs.find(job => job.scope.name === baseline.scope.name && job.query === baseline.query && job.arm === 'rg-unsorted-cli');
  if (baseline.result.full.text !== parallel.result.full.text || baseline.result.compact.text !== parallel.result.compact.text) {
    throw new Error(`rg output mismatch: ${baseline.scope.name}/${baseline.query}`);
  }
}
const quantile = (numbers, p) => [...numbers].sort((a, b) => a - b)[Math.ceil(numbers.length * p) - 1];
const rows = jobs.map(job => {
  const r = job.result;
  const row = { scope: job.scope.name, query: job.query, pattern: job.pattern, arm: job.arm,
    p50Ms: quantile(job.samples.map(x => x.adapterMs), 0.5), p95Ms: quantile(job.samples.map(x => x.adapterMs), 0.95),
    processP50Ms: quantile(job.samples.map(x => x.processMs), 0.5), rawBytes: r.rawBytes, rawTruncated: r.rawTruncated,
    matches: r.matches, uniqueLocations: r.uniqueLocations,
    full: { tokens: tokenizer.encode(r.full.text).length, bytes: Buffer.byteLength(r.full.text), returned: r.full.returned, truncated: r.full.truncated },
    locations: { tokens: tokenizer.encode(r.compact.text).length, bytes: Buffer.byteLength(r.compact.text), returned: r.compact.returned, truncated: r.compact.truncated },
    samples: job.samples };
  if (r.foundLines) {
    const truePositives = r.foundLines.filter(line => expectedLines.includes(line)).length;
    row.fixtureQuality = { expectedLines, foundLines: r.foundLines, precision: truePositives / r.foundLines.length, recall: truePositives / expectedLines.length };
  }
  return row;
});
const report = { schemaVersion: 1, generatedAt: new Date().toISOString(),
  gitHead: invoke('git', ['rev-parse', 'HEAD'], root).trim(), dirtyWorktree: invoke('git', ['status', '--short'], root).trim(),
  environment: { platform: platform(), release: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, node: process.version,
    rg: invoke(values.rg, ['--version'], root).split('\n')[0], astGrep: invoke(values['ast-grep'], ['--version'], root).trim(), tokenizer: 'js-tiktoken@1.0.21/o200k_base (proxy, not model usage)' },
  methodology: { repetitions, warmups: 2, cache: 'OS warm; fresh CLI processes; no persistent AST cache', corpus: '.ts only, ignore-aware, regular files <= 1 MiB',
    limit: 100, rawBudgetBytes: 4 * 1024 * 1024, resultBudgetBytes: 128 * 1024, snapshot: scratch,
    timing: 'process startup + complete CLI output + JSON parsing/sorting + both output encodings; excludes tokenizer, snapshots, production path checks and ADK',
    quality: 'line-level fixture gold only; real repository counts do not establish precision or recall' },
  manifest, fixture: { source: fixtureLines.join('\n') + '\n', expectedLines }, rows };
writeFileSync(resolve(values.output), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output: relative(root, resolve(values.output)), files: manifest.length, bytes: manifest.reduce((n, f) => n + f.bytes, 0), cases: rows.length, repetitions, snapshot: scratch }));
console.table(rows.filter(row => row.scope !== 'fixture').map(row => ({ scope: row.scope, query: row.query, arm: row.arm, p50Ms: +row.p50Ms.toFixed(2), hits: row.matches, fullTokens: row.full.tokens, locationTokens: row.locations.tokens, truncated: row.full.truncated })));
console.log(JSON.stringify(rows.filter(row => row.scope === 'fixture').map(({ arm, fixtureQuality }) => ({ arm, fixtureQuality }))));
