import { accessSync, constants, realpathSync } from 'node:fs';
import { basename, win32 } from 'node:path';
import { failure } from '../internal';

export interface Shell {
  readonly path: string;
  readonly family: 'posix' | 'powershell' | 'cmd';
}

const family = (path: string): Shell['family'] | undefined => {
  const name = basename(path.replaceAll('\\', '/')).toLowerCase().replace(/\.exe$/, '');
  if (['pwsh', 'powershell'].includes(name)) return 'powershell';
  if (name === 'cmd') return 'cmd';
  if (['bash', 'zsh', 'sh', 'dash', 'ksh'].includes(name)) return 'posix';
  return undefined;
};

// Selection order follows OpenCode; see THIRD_PARTY_NOTICES.md for the pinned source.
// The resolved executable is retained for the agent's lifetime, including approval.
export function selectShell(options: {
  configured?: string | false;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  locate?: (candidate: string) => string | undefined;
} = {}): Shell | null {
  if (options.configured === false) return null;
  const platform = options.platform ?? process.platform, env = options.env ?? process.env;
  const locate = options.locate ?? ((candidate: string) => {
    const path = Bun.which(candidate, { PATH: env.PATH ?? env.Path ?? '' });
    if (!path) return undefined;
    try { accessSync(path, platform === 'win32' ? constants.F_OK : constants.X_OK); return realpathSync(path); }
    catch { return undefined; }
  });
  const choose = (candidate?: string): Shell | null => {
    if (!candidate || candidate.includes('\0')) return null;
    const path = locate(candidate), kind = path && family(path);
    // Windows' system bash/sh are WSL launchers, not host-compatible shells.
    if (!path || !kind || (platform === 'win32' && /[\\/]Windows[\\/](System32|Sysnative)[\\/](bash|sh)\.exe$/i.test(path))) return null;
    return Object.freeze({ path, family: kind });
  };
  if (options.configured) {
    const selected = choose(options.configured);
    if (!selected) throw failure('INVALID_SHELL');
    return selected;
  }
  const preferred = choose(env.SHELL);
  if (preferred) return preferred;
  if (platform === 'win32') {
    const systemRoot = env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows';
    const git = locate('git.exe');
    const gitBash = git && win32.join(win32.dirname(win32.dirname(git)), 'bin', 'bash.exe');
    for (const candidate of ['pwsh.exe', 'powershell.exe', win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), gitBash, 'bash.exe', env.ComSpec ?? env.COMSPEC, win32.join(systemRoot, 'System32', 'cmd.exe')]) {
      const selected = choose(candidate);
      if (selected) return selected;
    }
    return null;
  }
  for (const candidate of [...(platform === 'darwin' ? ['/bin/zsh', '/bin/bash'] : []), 'bash', '/bin/sh']) {
    const selected = choose(candidate);
    if (selected) return selected;
  }
  return null;
}

export function shellArgs(shell: Shell, command: string): string[] {
  if (shell.family === 'cmd') return ['/d', '/s', '/c', `"${command}"`];
  if (shell.family === 'powershell') return ['-NoLogo', '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-Command',
    // PS 5.1 otherwise encodes redirected output with a legacy code page.
    'try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [Console]::OutputEncoding } catch {}\n' + command];
  return ['-c', command];
}

/** Keep host credentials out of model-issued commands; explicit additions are host-owned. */
export function commandEnv(extra: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv {
  const allowed = /^(path|pathext|systemroot|windir|comspec|temp|tmp|tmpdir|userprofile|appdata|localappdata|programfiles|programfiles\(x86\)|programdata|homedrive|homepath|home|lang|lc_.*|term|number_of_processors|processor_architecture)$/i;
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (allowed.test(key) && value !== undefined) env[key] = value;
  for (const [key, value] of Object.entries({ CI: '1', NO_COLOR: '1', GIT_TERMINAL_PROMPT: '0', ...extra })) {
    if (!key || /[=\0]/.test(key) || value.includes('\0')) throw failure('INVALID_ENV');
    if (process.platform === 'win32') for (const existing of Object.keys(env)) if (existing.toLowerCase() === key.toLowerCase()) delete env[existing];
    env[key] = value;
  }
  return env;
}
