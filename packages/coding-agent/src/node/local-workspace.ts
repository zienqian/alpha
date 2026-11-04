import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, lstat, realpath, open, mkdir, rename, link, unlink } from 'node:fs/promises';
import { dirname, join, relative, isAbsolute, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { minimatch } from 'minimatch';
import type { CodingWorkspace, CommandOutcome, FileSnapshot, FileWriteOutcome, WorkspaceLease } from '../contracts.js';
import { checkSignal, codeOf, failure, positive, relativePath } from '../internal.js';
import { createWindowsBridge } from './windows-bridge.js';

export interface LocalWorkspaceOptions {
  readonly root: string;
  /** C1 supports Windows + PowerShell 7; other shells explicitly reject. */
  readonly shell: 'powershell' | 'bash';
  readonly env?: Readonly<Record<string, string>>;
  readonly limits?: { readonly maxFileBytes?: number; readonly maxOutputBytes?: number; readonly commandTimeoutMs?: number };
}
const hash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const errorCode = (cause: unknown) => (cause as { code?: string })?.code;
const canonical = (path: string) => path.toLowerCase();
const inside = (root: string, path: string) => { const rel = relative(root, path); return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel); };

async function locate(name: string): Promise<string> {
  for (const directory of (process.env.PATH ?? '').split(';')) {
    if (!directory || !isAbsolute(directory)) continue;
    const path = join(directory.replace(/^"|"$/g, ''), name);
    try { await access(path); return await realpath(path); } catch { /* Try next PATH entry. */ }
  }
  throw failure(`${name === 'pwsh.exe' ? 'POWERSHELL' : 'RIPGREP'}_NOT_FOUND`);
}

// Fixed executable / argv only. This read-only child cannot interpret a shell command.
async function capture(executable: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv,
  signal?: AbortSignal, maxBytes = 4 * 1024 * 1024): Promise<{ text: string; exitCode: number; truncated: boolean }> {
  checkSignal(signal);
  const child = spawn(executable, [...args], { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks: Buffer[] = []; let bytes = 0, truncated = false, failed = false;
  child.stderr.resume();
  child.stdout.on('data', (chunk: Buffer) => {
    if (truncated) return;
    if (bytes + chunk.length > maxBytes) { truncated = true; child.kill(); return; }
    bytes += chunk.length; chunks.push(chunk);
  });
  const abort = () => child.kill(); signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const code = await new Promise<number>(resolve => {
    child.on('error', () => { failed = true; });
    child.on('close', code => resolve(code ?? -1));
  });
  signal?.removeEventListener('abort', abort); checkSignal(signal);
  if (failed) throw failure('READ_PROCESS_FAILED');
  return { text: Buffer.concat(chunks).toString('utf8'), exitCode: code, truncated };
}

export async function createLocalWorkspace(options: LocalWorkspaceOptions): Promise<CodingWorkspace> {
  if (process.platform !== 'win32' || options.shell !== 'powershell') throw failure('PLATFORM_UNSUPPORTED');
  const root = await realpath(options.root);
  if (!(await lstat(root)).isDirectory()) throw failure('WORKSPACE_NOT_DIRECTORY');
  const maxFile = positive(options.limits?.maxFileBytes ?? 1048576, 'FILE_LIMIT', 16 * 1048576);
  const maxOutput = positive(options.limits?.maxOutputBytes ?? 49152, 'OUTPUT_LIMIT', 1048576);
  const timeout = positive(options.limits?.commandTimeoutMs ?? 60000, 'COMMAND_TIMEOUT', 3600000);
  const [shell, rg] = await Promise.all([locate('pwsh.exe'), locate('rg.exe')]);
  const env: Record<string, string> = {};
  const allowed = new Set(['path', 'pathext', 'systemroot', 'windir', 'comspec', 'temp', 'tmp', 'userprofile', 'appdata', 'localappdata', 'programfiles', 'programfiles(x86)', 'programdata', 'homedrive', 'homepath', 'number_of_processors', 'processor_architecture']);
  for (const [key, value] of Object.entries(process.env)) if (allowed.has(key.toLowerCase()) && value !== undefined) env[key] = value;
  for (const [key, value] of Object.entries({ CI: '1', NO_COLOR: '1', GIT_TERMINAL_PROMPT: '0', ...options.env })) {
    if (!key || /[=\0]/.test(key) || typeof value !== 'string' || value.includes('\0')) throw failure('INVALID_ENV');
    const existing = Object.keys(env).find(k => k.toLowerCase() === key.toLowerCase()); if (existing) delete env[existing];
    env[key] = value;
  }
  const version = await capture(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'], root, env);
  if (version.exitCode !== 0 || Number(version.text.trim()) < 7) throw failure('POWERSHELL_VERSION_UNSUPPORTED');
  const rgVersion = await capture(rg, ['--version'], root, env);
  if (rgVersion.exitCode !== 0) throw failure('RIPGREP_UNAVAILABLE');
  const id = `local:${hash(canonical(root))}`;
  const lockDir = join(tmpdir(), 'alpha-coding-workspace-locks'); await mkdir(lockDir, { recursive: true });
  let closing = false, acquiring = false, active: WorkspaceLease | undefined;
  const operations = new Set<Promise<unknown>>();
  let closePromise: Promise<void> | undefined, leaseDone: Promise<void> = Promise.resolve(), leaseResolve: () => void = () => { /* No lease yet. */ };
  function tracked<T>(task: () => Promise<T>): Promise<T> {
    if (closing) return Promise.reject(failure('WORKSPACE_CLOSED'));
    const promise = task(); operations.add(promise);
    void promise.then(() => operations.delete(promise), () => operations.delete(promise));
    return promise;
  }
  async function resolve(path: string, missingLeaf = false, directory = false): Promise<string> {
    const rel = relativePath(path, directory);
    if (canonical(await realpath(root)) !== canonical(root)) throw failure('WORKSPACE_MOVED');
    if (rel === '.') return root;
    let target = root;
    const segments = rel.split('/');
    for (let i = 0; i < segments.length; i++) {
      target = join(target, segments[i]);
      try {
        const stat = await lstat(target);
        if (stat.isSymbolicLink()) throw failure('LINK_NOT_ALLOWED');
        const resolved = await realpath(target);
        if (!inside(root, resolved)) throw failure('PATH_OUTSIDE_WORKSPACE');
        target = resolved;
        if ((i < segments.length - 1 || directory) && !stat.isDirectory()) throw failure('PARENT_NOT_DIRECTORY');
      } catch (cause) {
        if (errorCode(cause) === 'ENOENT' && missingLeaf && i === segments.length - 1) return target;
        if (errorCode(cause) === 'ENOENT') throw failure('FILE_NOT_FOUND');
        throw cause;
      }
    }
    return target;
  }
  async function read(path: string, signal?: AbortSignal): Promise<FileSnapshot | undefined> {
    checkSignal(signal);
    let target: string;
    try { target = await resolve(path, true); }
    catch (cause) { if (errorCode(cause) === 'FILE_NOT_FOUND') return undefined; throw cause; }
    let file;
    try { file = await open(target, 'r'); } catch (cause) { if (errorCode(cause) === 'ENOENT') return undefined; throw cause; }
    try {
      if (!(await file.stat()).isFile()) throw failure('NOT_A_FILE');
      const data = Buffer.alloc(maxFile + 1); let length = 0;
      while (length < data.length) { checkSignal(signal); const { bytesRead } = await file.read(data, length, data.length - length, null); if (!bytesRead) break; length += bytesRead; }
      if (length > maxFile) throw failure('FILE_TOO_LARGE');
      const bytes = data.subarray(0, length);
      if (bytes.includes(0)) throw failure('BINARY_FILE');
      let content: string;
      try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { throw failure('INVALID_UTF8'); }
      return { path: relative(root, target).replaceAll('\\', '/'), content, revision: hash(bytes) };
    } finally { await file.close(); }
  }
  const rgOptions = (glob?: string) => {
    if (glob !== undefined && (!glob || glob.length > 1024 || glob.includes('\0') || isAbsolute(glob) || glob.replaceAll('\\', '/').split('/').includes('..'))) throw failure('INVALID_GLOB');
    // Positive rg --glob would override .gitignore. Filter the already-ignored results instead.
    return ['--no-config', '--hidden', '--glob', '!.git/**'];
  };
  const workspace: CodingWorkspace = {
    id, root, shell, isolation: 'none',
    readFile: (path, opts) => tracked(() => read(path, opts?.signal)),
    listFiles: (input, opts) => tracked(async () => {
      const limit = positive(input.limit ?? 200, 'LIST_LIMIT', 1000); await resolve('.', false, true);
      const result = await capture(rg, [...rgOptions(input.glob), '--files', '--sort', 'path', '.'], root, env, opts?.signal);
      if (!result.truncated && ![0, 1].includes(result.exitCode)) throw failure('LIST_FAILED');
      const lines = result.text.split(/\r?\n/); if (result.truncated) lines.pop();
      const paths: string[] = [];
      for (const line of lines.filter(Boolean)) {
        const path = line.replace(/^[.]?[\\/]/, '').replaceAll('\\', '/');
        if (input.glob && !minimatch(path, input.glob.replaceAll('\\', '/'), { dot: true, matchBase: true })) continue;
        try { await resolve(path); paths.push(path); } catch { /* Exclude links and files that disappeared. */ }
        if (paths.length > limit) break;
      }
      return { paths: paths.slice(0, limit), truncated: result.truncated || paths.length > limit };
    }),
    search: (input, opts) => tracked(async () => {
      if (!input.query || input.query.length > 4096 || /[\0\r\n]/.test(input.query)) throw failure('INVALID_QUERY');
      const limit = positive(input.limit ?? 100, 'SEARCH_LIMIT', 1000); await resolve('.', false, true);
      const result = await capture(rg, [...rgOptions(input.glob), '--json', '--fixed-strings', '--sort', 'path', '--max-filesize', String(maxFile), '--', input.query, '.'], root, env, opts?.signal);
      if (!result.truncated && ![0, 1].includes(result.exitCode)) throw failure('SEARCH_FAILED');
      const matches: { path: string; line: number; text: string }[] = [];
      const lines = result.text.split('\n'); if (result.truncated) lines.pop();
      for (const line of lines.filter(Boolean)) {
        const event = JSON.parse(line) as { type: string; data: { path?: { text?: string }; lines?: { text?: string }; line_number?: number } };
        if (event.type !== 'match' || !event.data.path?.text || event.data.lines?.text === undefined) continue;
        const path = event.data.path.text.replace(/^[.]?[\\/]/, '').replaceAll('\\', '/');
        if (input.glob && !minimatch(path, input.glob.replaceAll('\\', '/'), { dot: true, matchBase: true })) continue;
        try { await resolve(path); } catch { continue; }
        if (!Number.isSafeInteger(event.data.line_number)) continue;
        matches.push({ path, line: event.data.line_number as number, text: event.data.lines.text.replace(/\r?\n$/, '') });
        if (matches.length > limit) break;
      }
      return { matches: matches.slice(0, limit), truncated: result.truncated || matches.length > limit };
    }),
    async acquire(opts) {
      if (closing) throw failure('WORKSPACE_CLOSED');
      if (active || acquiring) throw failure('WORKSPACE_BUSY');
      acquiring = true; leaseDone = new Promise(resolve => { leaseResolve = resolve; });
      try {
        await resolve('.', false, true);
        const bridge = await createWindowsBridge(shell, join(lockDir, `${hash(canonical(root))}.lock`), opts?.signal);
        if (closing || opts?.signal?.aborted || !bridge.isAlive()) { await bridge.close(); throw failure('WORKSPACE_CLOSED'); }
        let releasing = false, releasePromise: Promise<void> | undefined;
        const running = new Set<Promise<unknown>>();
        function run<T>(task: () => Promise<T>): Promise<T> {
          if (releasing) return Promise.reject(failure('LEASE_RELEASED'));
          if (running.size) return Promise.reject(failure('LEASE_BUSY'));
          const promise = task(); running.add(promise);
          void promise.then(() => running.delete(promise), () => running.delete(promise)); return promise;
        }
        active = {
          writeFile: (input, opts) => run(async (): Promise<FileWriteOutcome> => {
            let temp: string | undefined, effectStarted = false;
            try {
              if (!bridge.isAlive()) throw failure('WORKSPACE_LEASE_LOST');
              checkSignal(opts?.signal);
              const bytes = Buffer.from(input.content, 'utf8');
              if (bytes.length > maxFile) return { status: 'rejected', code: 'FILE_TOO_LARGE' };
              if (bytes.toString('utf8') !== input.content || bytes.includes(0)) return { status: 'rejected', code: 'INVALID_UTF8' };
              const target = await resolve(input.path, true), snapshot = await read(input.path, opts?.signal);
              if (input.expectedRevision === null ? snapshot !== undefined : snapshot?.revision !== input.expectedRevision) return { status: 'rejected', code: input.expectedRevision === null ? 'FILE_EXISTS' : snapshot ? 'FILE_CONFLICT' : 'FILE_NOT_FOUND' };
              await resolve(input.path, true); checkSignal(opts?.signal);
              temp = join(dirname(target), `.alpha-${randomUUID()}.tmp`);
              const handle = await open(temp, 'wx', snapshot ? (await lstat(target)).mode : 0o666);
              try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
              // A cooperative external editor may have changed the file while the temp was written.
              const current = await read(input.path, opts?.signal);
              if ((current?.revision ?? null) !== input.expectedRevision) return { status: 'rejected', code: 'FILE_CONFLICT' };
              await resolve(input.path, true); checkSignal(opts?.signal);
              if (!bridge.isAlive()) throw failure('WORKSPACE_LEASE_LOST');
              effectStarted = true;
              if (input.expectedRevision === null) await link(temp, target); else await rename(temp, target);
              return { status: 'applied', revision: hash(bytes) };
            } catch (cause) {
              if (errorCode(cause) === 'EEXIST') return { status: 'rejected', code: 'FILE_EXISTS' };
              return { status: effectStarted ? 'unknown' : 'rejected', code: codeOf(cause, effectStarted ? 'WRITE_OUTCOME_UNKNOWN' : 'WRITE_REJECTED') };
            } finally { if (temp) await unlink(temp).catch(() => { /* Successful rename already removed the temp. */ }); }
          }),
          runCommand: (input, opts) => run(async (): Promise<CommandOutcome> => {
            let cwd: string;
            try {
              checkSignal(opts.signal);
              if (!input.command || input.command.length > 16384 || input.command.includes('\0')) throw failure('INVALID_COMMAND');
              if (input.timeoutMs !== undefined) positive(input.timeoutMs, 'COMMAND_TIMEOUT', timeout);
              cwd = await resolve(input.cwd ?? '.', false, true);
            } catch (cause) { return { status: 'not_started', code: codeOf(cause, 'COMMAND_PREFLIGHT_FAILED') }; }
            return bridge.run({ command: input.command, cwd, timeoutMs: input.timeoutMs ?? timeout, maxOutputBytes: maxOutput, env }, opts);
          }),
          release() {
            if (!releasePromise) {
              releasing = true;
              releasePromise = (async () => { await Promise.allSettled([...running]); await bridge.close(); active = undefined; leaseResolve(); })();
            }
            return releasePromise;
          },
        };
        return active;
      } catch (cause) { leaseResolve(); throw cause; }
      finally { acquiring = false; }
    },
    close() {
      if (!closePromise) { closing = true; closePromise = (async () => { await Promise.allSettled([...operations]); await leaseDone; })(); }
      return closePromise;
    },
  };
  return Object.freeze(workspace);
}
