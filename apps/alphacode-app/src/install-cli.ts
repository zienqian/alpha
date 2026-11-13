import { execFile } from "node:child_process";
import { appendFile, chmod, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { cliBridge, cliCommandName, findInstalledCli, isAppCliBridge, quoteShell } from "./cli-command";

const execute = promisify(execFile);
const pathMarker = "# AlphaCode App terminal command";
const exists = async (path: string) => lstat(path).then(() => true, (error: NodeJS.ErrnoException) => {
  if (error.code === "ENOENT") return false;
  throw error;
});

export async function registerCliPath(directory: string, home: string, env: NodeJS.ProcessEnv) {
  if (process.platform === "win32") {
    // Update only the current user's PATH. Never copy the merged process PATH to the registry.
    await execute(join(env.SystemRoot || "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", `
      $ErrorActionPreference = 'Stop'
      $directory = $env:ALPHACODE_CLI_INSTALL_DIRECTORY
      $current = [Environment]::GetEnvironmentVariable('Path', 'User')
      $entries = @($current -split ';' | Where-Object { $_ })
      $present = $entries | Where-Object { [Environment]::ExpandEnvironmentVariables($_).TrimEnd('\\') -ieq $directory.TrimEnd('\\') }
      if (-not $present) {
        [Environment]::SetEnvironmentVariable('Path', (($entries + $directory) -join ';'), 'User')
      }
    `], { windowsHide: true, timeout: 30000, env: { ...env, ALPHACODE_CLI_INSTALL_DIRECTORY: directory } });
    return;
  }
  await registerShellCliPath(directory, home, env);
}

export async function registerShellCliPath(directory: string, home: string, env: NodeJS.ProcessEnv) {
  const shell = basename(env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash"));
  let files: string[];
  let snippet = `${pathMarker}\ncase ":$PATH:" in\n  *${quoteShell(`:${directory}:`)}*) ;;\n  *) export PATH="\${PATH:+$PATH:}"${quoteShell(directory)} ;;\nesac\n`;
  if (shell === "fish") {
    files = [join(env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : join(home, ".config"), "fish/conf.d/alphacode.fish")];
    const quoted = `'${directory.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
    snippet = `${pathMarker}\nif not contains -- ${quoted} $PATH\n  set -gx PATH $PATH ${quoted}\nend\n`;
  } else if (shell === "zsh") {
    const dot = env.ZDOTDIR && isAbsolute(env.ZDOTDIR) ? env.ZDOTDIR : home;
    files = [join(dot, ".zprofile"), join(dot, ".zshrc")];
  } else if (shell === "bash") {
    const login = await exists(join(home, ".bash_profile")) ? ".bash_profile"
      : await exists(join(home, ".bash_login")) ? ".bash_login" : ".profile";
    files = [join(home, login), join(home, ".bashrc")];
  } else {
    // The menu reports unsupported shells without changing their configuration.
    throw new Error("UNSUPPORTED_SHELL");
  }
  for (const file of files) {
    const current = await exists(file) ? await readFile(file, "utf8") : "";
    if (current.includes(pathMarker)) continue;
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, `\n${snippet}`, { mode: 0o600 });
  }
}

export async function installCliCommand(options: {
  root: string; home: string; env?: NodeJS.ProcessEnv;
  registerPath?: typeof registerCliPath;
}): Promise<{ kind: "installed" | "existing"; command: string }> {
  const env = options.env ?? process.env;
  const existing = await findInstalledCli(env);
  if (existing) return { kind: "existing", command: existing };
  const directory = join(options.home, ".alphacode/bin");
  const command = join(directory, cliCommandName);
  await mkdir(directory, { recursive: true });
  // Never replace a user's binary, symlink or unrelated launcher, even off PATH.
  if (await exists(command)) {
    if ((await lstat(command)).isSymbolicLink() || !await isAppCliBridge(command)) {
      return { kind: "existing", command };
    }
    await writeFile(command, cliBridge(options.root));
  } else {
    await writeFile(command, cliBridge(options.root), { flag: "wx", mode: 0o755 });
  }
  if (process.platform !== "win32") await chmod(command, 0o755);
  await (options.registerPath ?? registerCliPath)(directory, options.home, env);
  return { kind: "installed", command };
}
