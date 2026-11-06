import type { PermissionMode } from "../chat/contracts";

export const commands = [
  { name: "/permission", description: "Choose how tools and commands are approved" },
] as const;

export const permissionOptions: readonly { value: PermissionMode; name: string; description: string }[] = [
  { value: "ask", name: "Ask for approval", description: "Ask before commands; allow workspace file tools" },
  { value: "auto", name: "Approve for me", description: "Approve routine commands; ask for everything else" },
  { value: "full", name: "Full access", description: "Allow all tools and commands with current process permissions" },
];

export function matchingCommands(text: string) {
  return commands.filter(command => command.name.startsWith(text.trim()));
}
