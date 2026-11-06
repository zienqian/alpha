import { isAbsolute, relative } from 'node:path';
import { minimatch } from 'minimatch';
import { checkSignal, failure, positive } from './internal';
import { resolvePath } from './files';
import { runProcess } from './process/run-command';
import type { CodingExecutionOptions } from './contracts';

function locateRipgrep(): string {
  const path = Bun.which('rg', { PATH: process.env.PATH ?? process.env.Path ?? '' });
  if (!path) throw failure('RIPGREP_NOT_FOUND');
  return path;
}
async function capture(executable: string, args: string[], cwd: string, signal?: AbortSignal, timeoutMs?: number | null) {
  const result = await runProcess(executable, args, { cwd, signal, timeoutMs, maxOutputBytes: 4 * 1024 * 1024 });
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
export async function listFiles(root: string, input: { path?: string; glob?: string; limit?: number }, signal?: AbortSignal, options: CodingExecutionOptions = {}) {
  const rg = locateRipgrep();
  const limit = positive(input.limit ?? 200, 'LIST_LIMIT', 1000);
  const directory = await resolvePath(root, input.path ?? '.', false, true, options.fileAccess);
  const result = await capture(rg, [...rgOptions(input.glob), ...(options.fileAccess === 'host' ? ['--follow'] : []), '--files', '--sort', 'path', '.'], directory, signal, options.commandTimeoutMs);
  if (!result.truncated && ![0, 1].includes(result.exitCode)) throw failure('LIST_FAILED');
  const lines = result.text.split(/\r?\n/); if (result.truncated) lines.pop();
  const paths: string[] = [];
  for (const line of lines.filter(Boolean)) {
    const path = normalize(line);
    if (input.glob && !minimatch(path, input.glob.replaceAll('\\', '/'), { dot: true, matchBase: true })) continue;
    try { const resolved = await resolvePath(directory, path, false, false, options.fileAccess); paths.push(normalize(options.fileAccess === 'host' ? resolved : relative(root, resolved))); } catch { /* Exclude unavailable paths. */ }
    if (paths.length > limit) break;
  }
  return { paths: paths.slice(0, limit), truncated: result.truncated || paths.length > limit };
}

export async function searchFiles(root: string, input: { path?: string; query: string; glob?: string; limit?: number }, signal?: AbortSignal, options: CodingExecutionOptions = {}) {
  const rg = locateRipgrep();
  if (!input.query || input.query.length > 4096 || /[\0\r\n]/.test(input.query)) throw failure('INVALID_QUERY');
  const limit = positive(input.limit ?? 100, 'SEARCH_LIMIT', 1000);
  const directory = await resolvePath(root, input.path ?? '.', false, true, options.fileAccess);
  const result = await capture(rg, [...rgOptions(input.glob), ...(options.fileAccess === 'host' ? ['--follow'] : []), '--json', '--fixed-strings', '--sort', 'path', '--max-filesize', String(1048576), '--', input.query, '.'], directory, signal, options.commandTimeoutMs);
  if (!result.truncated && ![0, 1].includes(result.exitCode)) throw failure('SEARCH_FAILED');
  const matches: { path: string; line: number; text: string }[] = [];
  const lines = result.text.split('\n'); if (result.truncated) lines.pop();
  for (const line of lines.filter(Boolean)) {
    const event = JSON.parse(line) as { type: string; data: { path?: { text?: string }; lines?: { text?: string }; line_number?: number } };
    if (event.type !== 'match' || !event.data.path?.text || event.data.lines?.text === undefined) continue;
    const path = normalize(event.data.path.text);
    if (input.glob && !minimatch(path, input.glob.replaceAll('\\', '/'), { dot: true, matchBase: true })) continue;
    let resolved: string;
    try { resolved = await resolvePath(directory, path, false, false, options.fileAccess); } catch { continue; }
    if (!Number.isSafeInteger(event.data.line_number)) continue;
    matches.push({ path: normalize(options.fileAccess === 'host' ? resolved : relative(root, resolved)), line: event.data.line_number as number, text: event.data.lines.text.replace(/\r?\n$/, '') });
    if (matches.length > limit) break;
  }
  return { matches: matches.slice(0, limit), truncated: result.truncated || matches.length > limit };
}
