import { isAbsolute } from 'node:path';
import { minimatch } from 'minimatch';
import { checkSignal, failure, positive } from './internal.js';
import { resolvePath } from './files.js';
import { runProcess } from './process/run-command.js';

function locateRipgrep(): string {
  const path = Bun.which('rg', { PATH: process.env.PATH ?? process.env.Path ?? '' });
  if (!path) throw failure('RIPGREP_NOT_FOUND');
  return path;
}
async function capture(executable: string, args: string[], cwd: string, signal?: AbortSignal) {
  const result = await runProcess(executable, args, { cwd, signal, maxOutputBytes: 4 * 1024 * 1024 });
  checkSignal(signal);
  if (result.status !== 'exited') throw failure(result.code);
  if (result.outputIncomplete) throw failure('SEARCH_OUTPUT_INCOMPLETE');
  return { text: result.stdout, exitCode: result.exitCode, truncated: result.truncated };
}

const rgOptions = (glob?: string) => {
  if (glob !== undefined && (!glob || glob.length > 1024 || glob.includes('\0') || isAbsolute(glob) || glob.replaceAll('\\', '/').split('/').includes('..'))) throw failure('INVALID_GLOB');
  // Positive rg --glob would override .gitignore. Filter the already-ignored results instead.
  return ['--no-config', '--hidden', '--glob', '!.git/**'];
};
const normalize = (path: string) => process.platform === 'win32' ? path.replaceAll('\\', '/').replace(/^\.\//, '') : path.replace(/^\.\//, '');
export async function listFiles(root: string, input: { glob?: string; limit?: number }, signal?: AbortSignal) {
  const rg = locateRipgrep();
  const limit = positive(input.limit ?? 200, 'LIST_LIMIT', 1000); await resolvePath(root, '.', false, true);
  const result = await capture(rg, [...rgOptions(input.glob), '--files', '--sort', 'path', '.'], root, signal);
  if (!result.truncated && ![0, 1].includes(result.exitCode)) throw failure('LIST_FAILED');
  const lines = result.text.split(/\r?\n/); if (result.truncated) lines.pop();
  const paths: string[] = [];
  for (const line of lines.filter(Boolean)) {
    const path = normalize(line);
    if (input.glob && !minimatch(path, input.glob.replaceAll('\\', '/'), { dot: true, matchBase: true })) continue;
    try { await resolvePath(root, path); paths.push(path); } catch { /* Exclude links and files that disappeared. */ }
    if (paths.length > limit) break;
  }
  return { paths: paths.slice(0, limit), truncated: result.truncated || paths.length > limit };
}

export async function searchFiles(root: string, input: { query: string; glob?: string; limit?: number }, signal?: AbortSignal) {
  const rg = locateRipgrep();
  if (!input.query || input.query.length > 4096 || /[\0\r\n]/.test(input.query)) throw failure('INVALID_QUERY');
  const limit = positive(input.limit ?? 100, 'SEARCH_LIMIT', 1000); await resolvePath(root, '.', false, true);
  const result = await capture(rg, [...rgOptions(input.glob), '--json', '--fixed-strings', '--sort', 'path', '--max-filesize', String(1048576), '--', input.query, '.'], root, signal);
  if (!result.truncated && ![0, 1].includes(result.exitCode)) throw failure('SEARCH_FAILED');
  const matches: { path: string; line: number; text: string }[] = [];
  const lines = result.text.split('\n'); if (result.truncated) lines.pop();
  for (const line of lines.filter(Boolean)) {
    const event = JSON.parse(line) as { type: string; data: { path?: { text?: string }; lines?: { text?: string }; line_number?: number } };
    if (event.type !== 'match' || !event.data.path?.text || event.data.lines?.text === undefined) continue;
    const path = normalize(event.data.path.text);
    if (input.glob && !minimatch(path, input.glob.replaceAll('\\', '/'), { dot: true, matchBase: true })) continue;
    try { await resolvePath(root, path); } catch { continue; }
    if (!Number.isSafeInteger(event.data.line_number)) continue;
    matches.push({ path, line: event.data.line_number as number, text: event.data.lines.text.replace(/\r?\n$/, '') });
    if (matches.length > limit) break;
  }
  return { matches: matches.slice(0, limit), truncated: result.truncated || matches.length > limit };
}
