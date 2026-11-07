import { homedir } from "node:os";
import { isAbsolute, relative, sep } from "node:path";

export function formatWorkspacePath(workspace: string, home = homedir()): string {
  if (!isAbsolute(workspace) || !isAbsolute(home)) return workspace;
  const path = relative(home, workspace);
  if (!path) return "~";
  if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) return workspace;
  return `~/${path.split(sep).join("/")}`;
}
