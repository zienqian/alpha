import type { Translate } from "../i18n/instance";
import type { ChatSkill } from "@alpha/alphacode-app-server/contracts";

export const commands = [
  { name: "/web", description: "chat:commands.web" },
  { name: "/permission", description: "chat:commands.permission" },
  { name: "/skills", description: "chat:commands.skills" },
  { name: "/compact", description: "chat:commands.compact" },
] as const;

export const permissionOptions = [
  { value: "ask", name: "permissions:ask.name", description: "permissions:ask.description" },
  { value: "auto", name: "permissions:auto.name", description: "permissions:auto.description" },
  { value: "full", name: "permissions:full.name", description: "permissions:full.description" },
] as const;

export function matchingCommands(text: string, skills: readonly ChatSkill[] = [], t?: Translate) {
  return [...commands.map(command => ({ ...command, description: t ? t(command.description) : command.description })), ...skills.filter(skill => skill.userInvocable).map(skill => ({
    name: `/${skill.name}`, description: `${skill.description}${skill.argumentHint ? ` · ${skill.argumentHint}` : ""}`,
  }))].filter(command => command.name.startsWith(text.trim()));
}
