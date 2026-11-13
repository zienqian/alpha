import { constants } from "node:fs";
import { access, open, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";

export const cliBridgeMarker = "AlphaCode App CLI bridge v1";
export const cliCommandName = process.platform === "win32" ? "alphacode.cmd" : "alphacode";

export function withBundledCommands(root: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const key = Object.keys(env).find(key => key.toUpperCase() === "PATH") ?? "PATH";
  const paths = (env[key] || "").split(delimiter).filter(Boolean);
  // Existing commands (including the user's Bun and CLI) keep their precedence.
  for (const directory of [join(root, "bin"), join(root, "cli")]) {
    if (!paths.includes(directory)) paths.push(directory);
  }
  return { ...env, [key]: paths.join(delimiter) };
}

export async function isAppCliBridge(path: string) {
  const file = await open(path, "r");
  try {
    const prefix = Buffer.alloc(256);
    const { bytesRead } = await file.read(prefix, 0, prefix.length, 0);
    return prefix.subarray(0, bytesRead).toString().split(/\r?\n/).slice(0, 3)
      .some(line => line === `# ${cliBridgeMarker}` || line === `@rem ${cliBridgeMarker}`);
  } finally { await file.close(); }
}

export async function findInstalledCli(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const pathKey = Object.keys(env).find(key => key.toUpperCase() === "PATH") ?? "PATH";
  const names = process.platform === "win32" ? ["alphacode.exe", "alphacode.cmd", "alphacode.bat", "alphacode.com"] : ["alphacode"];
  for (const entry of (env[pathKey] || "").split(delimiter)) {
    const directory = entry.replace(/^"(.*)"$/, "$1");
    // Do not execute a command from the caller's project via an empty/relative PATH entry.
    if (!isAbsolute(directory)) continue;
    for (const name of names) {
      const candidate = join(directory, name);
      try {
        if (!(await stat(candidate)).isFile()) continue;
        await access(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
        // Skip all App-owned bridges, including older/moved App installations.
        if (!await isAppCliBridge(candidate)) return candidate;
      } catch { /* Missing, broken or inaccessible PATH entry. */ }
    }
  }
  return undefined;
}

export const quoteShell = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export function cliBridge(root?: string, platform = process.platform): string {
  if (platform === "win32") {
    const quote = (value: string) => `"${value.replaceAll("%", "%%")}"`;
    const bun = root ? quote(join(root, "bin/bun.exe")) : '"%~dp0..\\bin\\bun.exe"';
    const launcher = root ? quote(join(root, "cli/launcher.js")) : '"%~dp0launcher.js"';
    return `@echo off\r\n@rem ${cliBridgeMarker}\r\nsetlocal DisableDelayedExpansion\r\n${bun} --no-env-file ${launcher} %*\r\nexit /b %errorlevel%\r\n`;
  }
  const paths = root
    ? `exec ${quoteShell(join(root, "bin/bun"))} --no-env-file ${quoteShell(join(root, "cli/launcher.js"))} "$@"`
    : 'directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$directory/../bin/bun" --no-env-file "$directory/launcher.js" "$@"';
  return `#!/bin/sh\n# ${cliBridgeMarker}\n${paths}\n`;
}
