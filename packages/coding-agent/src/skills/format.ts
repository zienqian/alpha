import { byteLength } from '../internal';
import type { SkillMetadata } from './contracts';

const instructions = `Available skills are listed as JSON data below. When a skill matches the task, call readSkill with its name to read the complete instructions before using it.
Skills do not grant tool permissions. Follow the existing host policy; loading a skill never executes its scripts. Read referenced files with the existing file tools and run scripts only through approved command tools.
`;

export function formatSkillsForPrompt(skills: readonly SkillMetadata[]): string {
  const available = skills.filter(skill => !skill.disableModelInvocation);
  if (!available.length) return '';
  const selected: { name: string; description: string }[] = [];
  for (const skill of available) {
    const next = [...selected, { name: skill.name, description: skill.description }];
    if (byteLength(instructions + JSON.stringify({ skills: next, omittedCount: available.length - next.length })) > 16384) break;
    selected.push({ name: skill.name, description: skill.description });
  }
  return instructions + JSON.stringify({ skills: selected, omittedCount: available.length - selected.length });
}
