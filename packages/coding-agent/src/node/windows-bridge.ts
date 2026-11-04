import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import type { CommandOutcome } from '../contracts.js';
import { failure } from '../internal.js';

const base64 = (value: string) => Buffer.from(value, 'utf8').toString('base64');
export interface WindowsBridge {
  isAlive(): boolean;
  run(input: { command: string; cwd: string; timeoutMs: number; maxOutputBytes: number; env: Readonly<Record<string, string>> },
    options: { signal: AbortSignal; onOutput?: (channel: 'stdout' | 'stderr', text: string) => void }): Promise<CommandOutcome>;
  close(): Promise<void>;
}
export async function createWindowsBridge(shell: string, lockPath: string, signal?: AbortSignal): Promise<WindowsBridge> {
  const child = spawn(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('./bridge.ps1', import.meta.url))], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    // The trusted bridge compiles C#; it never evaluates model code in this environment.
  });
  let closed = false, closing = false, next = 0;
  let pending: { id: string; stdout: string; stderr: string; onOutput?: (channel: 'stdout' | 'stderr', text: string) => void;
    finish: (value: CommandOutcome) => void } | undefined;
  let readyResolve!: () => void, readyReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const exited = new Promise<void>(resolve => {
    child.once('close', () => {
      closed = true; readyReject(failure('WORKSPACE_BRIDGE_CLOSED'));
      pending?.finish({ status: 'unknown', code: 'COMMAND_BRIDGE_LOST' }); pending = undefined;
      resolve();
    });
  });
  child.on('error', () => readyReject(failure('WORKSPACE_BRIDGE_FAILED')));
  child.stdin.on('error', () => { /* close event reconciles every pending operation. */ });
  child.stderr.resume(); // Never retain unbounded compiler / runtime diagnostics.
  const send = (line: string) => { if (!closed && !child.stdin.destroyed) child.stdin.write(line + '\n'); };
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    const fields = line.split('|');
    if (fields[0] === 'BOOT') send(`LOCK|${base64(lockPath)}`);
    else if (fields[0] === 'LOCKED') readyResolve();
    else if (fields[0] === 'BUSY') readyReject(failure('WORKSPACE_BUSY'));
    else if (fields[0] === 'OUT' && pending && fields[1] === pending.id && (fields[2] === 'stdout' || fields[2] === 'stderr')) {
      const channel = fields[2], text = Buffer.from(fields[3], 'base64').toString('utf8');
      pending[channel] += text;
      try { void Promise.resolve(pending.onOutput?.(channel, text)).catch(() => { /* Async observation only. */ }); }
      catch { /* Observation only. */ }
    } else if (fields[0] === 'END' && pending && fields[1] === pending.id) {
      const current = pending; pending = undefined;
      current.finish(fields[2] === 'exited'
        ? { status: 'exited', exitCode: Number(fields[3]), stdout: current.stdout, stderr: current.stderr, truncated: fields[4] === '1' }
        : { status: fields[2] === 'not_started' ? 'not_started' : 'unknown', code: fields[5] || 'COMMAND_FAILED' });
    }
  });
  const close = async () => {
    if (!closing) { closing = true; send('CLOSE'); child.stdin.end(); }
    await exited;
  };
  const abort = () => { readyReject(failure('CANCELLED')); void close(); };
  signal?.addEventListener('abort', abort, { once: true });
  const startupTimeout = setTimeout(() => { readyReject(failure('WORKSPACE_BRIDGE_TIMEOUT')); void close(); }, 30000);
  try {
    if (signal?.aborted) abort();
    await ready;
  } catch (cause) { await close(); throw cause; }
  finally { clearTimeout(startupTimeout); signal?.removeEventListener('abort', abort); }
  return {
    isAlive: () => !closed && !closing,
    async run(input, options) {
      if (closing || closed || pending) return { status: 'not_started', code: 'WORKSPACE_UNAVAILABLE' };
      if (options.signal.aborted) return { status: 'not_started', code: 'COMMAND_CANCELLED' };
      const id = String(++next);
      const cancel = () => send(`CANCEL|${id}`);
      const promise = new Promise<CommandOutcome>(resolve => {
        pending = { id, stdout: '', stderr: '', onOutput: options.onOutput, finish: resolve };
      });
      const env = Object.entries(input.env).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\0') + '\0\0';
      // Force UTF-8 output, leave native exit codes and explicit PowerShell exit intact.
      const script = `[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)\n$OutputEncoding = [Console]::OutputEncoding\n$ErrorActionPreference = 'Stop'\n${input.command}\nif ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }\n`;
      send(['RUN', id, base64(shell), base64(input.cwd), base64(script), input.timeoutMs, input.maxOutputBytes, base64(env)].join('|'));
      options.signal.addEventListener('abort', cancel, { once: true });
      if (options.signal.aborted) cancel();
      try { return await promise; } finally { options.signal.removeEventListener('abort', cancel); }
    },
    close,
  };
}
