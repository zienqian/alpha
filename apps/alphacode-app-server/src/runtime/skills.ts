import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadSkills, readSkill, type LoadSkillsResult, type SkillMetadata, type SkillRoot } from "@alpha/coding-agent";
import type { AppConfig } from "../config";
import { defaultSkillsSettings } from "../global-config";
import { parseInput, skillInputPrefix } from "../input";
import { settingsError } from "./session-settings";
import { displayText } from "./tool-records";

export interface RuntimeSkillRoot extends SkillRoot {
  id: string;
  kind: "local" | "shared" | "claude";
  enabled: boolean;
}

export async function runtimeSkillRoots(config: AppConfig, cwd: string): Promise<RuntimeSkillRoot[]> {
  const settings = config.skills ?? defaultSkillsSettings;
  const canonical = (path: string) => process.platform === "win32" ? path.toLowerCase() : path;
  let trusted = false;
  for (const project of settings.trustedProjects) {
    try { if (canonical(await realpath(project)) === canonical(cwd)) trusted = true; }
    catch { continue; }
  }
  const roots: RuntimeSkillRoot[] = [];
  const add = (path: string, source: SkillRoot["source"], kind: RuntimeSkillRoot["kind"], enabled = true) =>
    roots.push({ id: `${source}-${kind}`, path, source, kind, enabled, trusted: source === "user" || trusted });
  add(join(cwd, ".alphacode", "skills"), "project", "local");
  add(join(cwd, ".agents", "skills"), "project", "shared", settings.sharedDirectories);
  add(join(cwd, ".claude", "skills"), "project", "claude", settings.claudeDirectories);
  add(join(config.configDirectory ?? join(homedir(), ".alphacode"), "skills"), "user", "local");
  add(join(homedir(), ".agents", "skills"), "user", "shared", settings.sharedDirectories);
  add(join(homedir(), ".claude", "skills"), "user", "claude", settings.claudeDirectories);
  return roots;
}

export async function loadRuntimeSkills(config: AppConfig, cwd: string): Promise<LoadSkillsResult> {
  return loadSkills({ roots: (await runtimeSkillRoots(config, cwd)).filter(root => root.enabled),
    disabledNames: (config.skills ?? defaultSkillsSettings).disabledNames, reservedNames: ["skills", "permission", "web", "compact"] });
}

export function skillStatus(loaded: LoadSkillsResult): string {
  return ["Available skills", ...loaded.skills.map(skill => `/${skill.name}${skill.argumentHint ? ` ${displayText(skill.argumentHint, 256)}` : ""} — ${displayText(skill.description, 1024)}${!skill.userInvocable ? " (model only)" : skill.disableModelInvocation ? " (manual only)" : ""}`),
    ...(!loaded.skills.length ? ["No skills loaded."] : []),
    ...loaded.diagnostics.map(diagnostic => `${diagnostic.severity}: ${diagnostic.code} — ${displayText(diagnostic.path, 1024)}${diagnostic.field ? ` (${displayText(diagnostic.field)})` : ""}`),
    "Configure skills in the global config.yaml. Project skills require an exact trustedProjects entry. Restart to reload."].join("\n");
}

export async function prepareSkillInput(input: string, skills: readonly SkillMetadata[], signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const parsed = parseInput(input);
  if (parsed.kind === "prompt") return parsed.text;
  const skill = skills.find(entry => entry.name === parsed.name);
  if (!skill) throw settingsError("SKILL_NOT_FOUND");
  if (!skill.userInvocable) throw settingsError("SKILL_USER_INVOCATION_DISABLED");
  if (Buffer.byteLength(parsed.arguments) > 8192) throw settingsError("SKILL_ARGUMENTS_TOO_LARGE");
  const content = await readSkill(skill, { signal });
  signal.throwIfAborted();
  const result = skillInputPrefix + JSON.stringify({ kind: "alpha.skill-input", version: 1, displayText: parsed.displayText, skill: content, arguments: parsed.arguments });
  if (Buffer.byteLength(result) > 48 * 1024) throw settingsError("SKILL_CONTENT_TOO_LARGE");
  return result;
}
