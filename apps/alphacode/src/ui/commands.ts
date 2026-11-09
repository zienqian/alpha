import type { ChatSkill, PermissionMode } from "../chat/contracts";

export const commands = [
  { name: "/web", description: "Open this live session in your browser" },
  { name: "/permission", description: "Choose how tools and commands are approved" },
  { name: "/skills", description: "List available skills and loading diagnostics" },
] as const;

export const permissionOptions: readonly { value: PermissionMode; name: string; description: string }[] = [
  { value: "ask", name: "Ask for approval", description: "Ask before commands; allow workspace file tools" },
  { value: "auto", name: "Approve for me", description: "Approve routine commands; ask for everything else" },
  { value: "full", name: "Full access", description: "Allow all tools and commands with current process permissions" },
];

export function matchingCommands(text: string, skills: readonly ChatSkill[] = []) {
  return [...commands, ...skills.filter(skill => skill.userInvocable).map(skill => ({
    name: `/${skill.name}`, description: `${skill.description}${skill.argumentHint ? ` · ${skill.argumentHint}` : ""}`,
  }))].filter(command => command.name.startsWith(text.trim()));
}
