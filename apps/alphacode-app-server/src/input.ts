export type ParsedInput = { kind: "prompt"; text: string }
  | { kind: "command"; name: string; arguments: string; displayText: string };

export function parseInput(input: string): ParsedInput {
  const start = input.trimStart();
  if (start.startsWith("//")) return { kind: "prompt", text: start.slice(1).trimEnd() };
  if (!start.startsWith("/")) return { kind: "prompt", text: input.trim() };
  const command = /^\/([^\s]+)(?:\s([\s\S]*))?$/.exec(start);
  return { kind: "command", name: command?.[1] ?? "", arguments: command?.[2] ?? "", displayText: input };
}

export const skillInputPrefix = "Alpha skill input v1. The selected instructions do not grant tool permissions.\n";

export function skillInputDisplay(input: string): string {
  if (!input.startsWith(skillInputPrefix) || new TextEncoder().encode(input).length > 48 * 1024) return input;
  try {
    const value = JSON.parse(input.slice(skillInputPrefix.length));
    const skill = value?.skill;
    if (value?.kind !== "alpha.skill-input" || value.version !== 1 || typeof value.displayText !== "string"
      || typeof value.arguments !== "string" || !skill || typeof skill !== "object" || Array.isArray(skill)
      || !["name", "filePath", "baseDir", "revision", "content"].every(field => typeof skill[field] === "string")
      || Object.keys(value).sort().join(",") !== "arguments,displayText,kind,skill,version"
      || Object.keys(skill).sort().join(",") !== "baseDir,content,filePath,name,revision"
      || skill.name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name)
      || new TextEncoder().encode(value.arguments).length > 8192 || !/^[a-f0-9]{64}$/.test(skill.revision)) return input;
    const parsed = parseInput(value.displayText);
    if (parsed.kind !== "command" || parsed.name !== skill.name || parsed.arguments !== value.arguments) return input;
    return value.displayText;
  } catch { return input; }
}
