import type { CodingAction, CodingDecision } from "@alpha/coding-agent";
import type { PermissionMode } from "../chat/contracts";

// Complete commands only: never approve a prefix that could hide another command,
// shell expansion, redirection, a script, or arbitrary arguments. Unknowns ask.
const routineCommands = [
  /^(?:pwd|Get-Location)$/,
  /^(?:bun|node|git|rg) --version$/,
  /^git status(?: --short| --porcelain(?:=v1|=v2)?)?(?: --branch)?$/,
  /^git diff --no-ext-diff --no-textconv(?: --stat| --name-only| --name-status)?$/,
  /^git log --no-ext-diff --no-textconv --oneline(?: -[1-9][0-9]?)?$/,
];

export function permissionDecision(mode: PermissionMode, action: CodingAction): CodingDecision {
  if (mode === "full") return "allow";
  if (action.kind === "custom") return "deny";
  if (action.kind !== "command") return "allow";
  if (mode === "auto" && action.preview.type === "command") {
    const command = action.preview.command;
    // No newline/escape normalization: the shell must see the exact inspected input.
    const hasControl = Array.from(command).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
    if (!hasControl && routineCommands.some(pattern => pattern.test(command.trim()))) return "allow";
  }
  return "ask";
}
