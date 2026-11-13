import spawn from 'cross-spawn';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { ChildProcess } from 'node:child_process';
import type { CommandInput, CommandOutcome, FileAccess } from '../contracts';
import { byteLength, checkSignal, clip, codeOf, failure, positive, headTail } from '../internal';
import { resolvePath } from '../files';
import { commandEnv, shellArgs, type Shell } from './shell';

interface ProcessOptions {
  cwd: string;
  signal?: AbortSignal;
  timeoutMs?: number | null;
  maxOutputBytes?: number;
  outputMode?: 'prefix' | 'head-tail';
  env?: NodeJS.ProcessEnv;
  windowsVerbatimArguments?: boolean;
  onOutput?: (channel: 'stdout' | 'stderr', text: string) => void;
}

async function killTree(child: ChildProcess, signal: NodeJS.Signals): Promise<void> {
  if (!child.pid) return;
  if (process.platform !== 'win32') {
    try { process.kill(-child.pid, signal); return; } catch { /* Already gone, or no process group. */ }
  } else {
    const taskkill = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
    const killed = await new Promise<boolean>(resolve => {
      let killer: ChildProcess;
      try { killer = spawn(taskkill, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); }
      catch { resolve(false); return; }
      const timer = setTimeout(() => { killer.kill(); resolve(false); }, 5000);
      const finish = (ok: boolean) => { clearTimeout(timer); resolve(ok); };
      killer.once('error', () => finish(false));
      killer.once('close', code => finish(code === 0));
    });
    if (killed) return;
  }
  try { child.kill(signal); } catch { /* Best effort after tree termination. */ }
}

/** OpenCode's cross-spawn/process-group approach, without its Effect service layer. */
export async function runProcess(executable: string, args: readonly string[], options: ProcessOptions): Promise<CommandOutcome> {
  if (options.signal?.aborted) return { status: 'not_started', code: 'CANCELLED' };
  const max = positive(options.maxOutputBytes ?? 49152, 'OUTPUT_LIMIT', 4 * 1024 * 1024);
  const timeoutMs = options.timeoutMs === null ? null : positive(options.timeoutMs ?? 60000, 'COMMAND_TIMEOUT', 2_147_483_647);
  return new Promise(resolve => {
    let child: ChildProcess;
    let spawned = false, spawnFailed = false, exited = false, settled = false, closeSeen = false;
    let exitCode: number | null = null, reason: string | undefined;
    let stdout = '', stderr = '', truncated = false, outputIncomplete = false;
    let captured = 0;
    const observed = { stdout: 0, stderr: 0 };
    const channelMax = Math.floor(max / 2);
    let stop: Promise<void> | undefined;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
    const capture = (channel: 'stdout' | 'stderr', text: string) => {
      if (settled || !text) return;
      if (options.outputMode !== 'head-tail') {
        if (truncated) return;
        const retained = clip(text, Math.max(0, max - captured));
        if (retained.length < text.length) truncated = true;
        captured += byteLength(retained);
        if (channel === 'stdout') stdout += retained; else stderr += retained;
        if (retained) { try { void Promise.resolve(options.onOutput?.(channel, retained)).catch(() => undefined); } catch { /* Observation only. */ } }
        return;
      }
      const previous = channel === 'stdout' ? stdout : stderr;
      const combined = previous + text;
      if (byteLength(combined) > channelMax) truncated = true;
      if (channel === 'stdout') stdout = headTail(combined, channelMax); else stderr = headTail(combined, channelMax);
      const retained = clip(text, Math.max(0, channelMax - observed[channel]));
      observed[channel] += byteLength(retained);
      if (retained) {
        try { void Promise.resolve(options.onOutput?.(channel, retained)).catch(() => { /* Observation only. */ }); } catch { /* Observation only. */ }
      }
    };
    const cleanup = () => {
      clearTimeout(timeout); clearTimeout(closeTimer); clearTimeout(forceTimer);
      options.signal?.removeEventListener('abort', abort);
      // We attached readers immediately, including on Bun, and drained past the cap.
      child.stdout?.destroy(); child.stderr?.destroy();
    };
    const finish = async () => {
      if (settled) return;
      if (stop) await stop;
      if (settled) return;
      capture('stdout', decoders.stdout.end()); capture('stderr', decoders.stderr.end());
      settled = true; cleanup();
      if (reason) resolve({ status: spawned && !spawnFailed ? 'unknown' : 'not_started', code: reason });
      else if (exitCode === null) resolve({ status: 'unknown', code: 'COMMAND_SIGNALLED' });
      else resolve({ status: 'exited', exitCode, stdout, stderr, truncated, outputIncomplete });
    };
    const terminate = (code: string) => {
      if (settled || reason) return;
      reason = code;
      // Do not cancel escalation just because the root exits: its group may remain.
      stop = (async () => {
        await killTree(child, 'SIGTERM');
        if (process.platform !== 'win32') {
          await new Promise<void>(done => { forceTimer = setTimeout(done, 3000); });
          await killTree(child, 'SIGKILL');
        }
      })();
      void stop.then(() => {
        if (closeSeen) void finish();
        else { closeTimer = setTimeout(() => { outputIncomplete = true; void finish(); }, 1000); }
      });
    };
    const abort = () => terminate('COMMAND_CANCELLED');
    try {
      child = spawn(executable, [...args], {
        cwd: options.cwd, env: options.env ?? commandEnv(), windowsHide: true,
        windowsVerbatimArguments: options.windowsVerbatimArguments,
        detached: process.platform !== 'win32',
        stdio: ['ignore', process.platform === 'win32' ? 'overlapped' : 'pipe', process.platform === 'win32' ? 'overlapped' : 'pipe'],
      });
    } catch { resolve({ status: 'not_started', code: 'COMMAND_SPAWN_FAILED' }); return; }
    child.stdout?.on('data', (chunk: Buffer) => capture('stdout', decoders.stdout.write(chunk)));
    child.stderr?.on('data', (chunk: Buffer) => capture('stderr', decoders.stderr.write(chunk)));
    child.stdout?.on('error', () => { outputIncomplete = true; });
    child.stderr?.on('error', () => { outputIncomplete = true; });
    child.once('spawn', () => { spawned = true; if (options.signal?.aborted) abort(); });
    child.once('error', (error: NodeJS.ErrnoException) => {
      // cross-spawn may start cmd.exe before reporting that the requested program was absent.
      spawnFailed = !spawned || ['ENOENT', 'EACCES', 'ENOEXEC'].includes(error.code ?? '');
      reason ??= 'COMMAND_SPAWN_FAILED'; void finish();
    });
    child.once('exit', code => {
      exited = true; exitCode = code;
      // A descendant can retain the pipes after root exit. Bound the drain wait.
      if (!stop) closeTimer = setTimeout(() => { outputIncomplete = true; void finish(); }, 1000);
    });
    child.once('close', code => { closeSeen = true; if (!exited) exitCode = code; void finish(); });
    const timeout = timeoutMs === null ? undefined : setTimeout(() => terminate('COMMAND_TIMEOUT'), timeoutMs);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
  });
}

export async function runCommand(root: string, shell: Shell | null, input: CommandInput, options: Omit<ProcessOptions, 'cwd'>, access: FileAccess = 'workspace'): Promise<CommandOutcome> {
  let cwd: string;
  try {
    checkSignal(options.signal);
    if (!shell) throw failure('SHELL_UNAVAILABLE');
    if (!input.command || input.command.length > 16384 || input.command.includes('\0')) throw failure('INVALID_COMMAND');
    if (input.timeoutMs !== undefined) positive(input.timeoutMs, 'COMMAND_TIMEOUT', options.timeoutMs === null ? 2_147_483_647 : options.timeoutMs ?? 60000);
    cwd = await resolvePath(root, input.cwd ?? '.', false, true, access);
  } catch (cause) { return { status: 'not_started', code: codeOf(cause, 'COMMAND_PREFLIGHT_FAILED') }; }
  return runProcess(shell.path, shellArgs(shell, input.command), {
    ...options, outputMode: 'head-tail', cwd, timeoutMs: options.timeoutMs === null ? null : input.timeoutMs ?? options.timeoutMs, windowsVerbatimArguments: shell.family === 'cmd',
  });
}
