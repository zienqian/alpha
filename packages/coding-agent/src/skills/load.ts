import { lstat, opendir } from 'node:fs/promises';
import { join } from 'node:path';
import { readFile } from '../files';
import { checkSignal, codeOf, failure } from '../internal';
import type { LoadSkillsOptions, LoadSkillsResult, SkillDiagnostic, SkillMetadata } from './contracts';
import { parseSkill, validName } from './parse';
import { validateSkillDirectory, validateSkillFile, validateSkillPath } from './read';

export async function loadSkills(options: LoadSkillsOptions): Promise<LoadSkillsResult> {
  checkSignal(options.signal);
  if (!Array.isArray(options.roots) || options.roots.length > 16) throw failure('SKILL_INVALID_ROOTS');
  const roots = options.roots.map(root => {
    if (!root || !['project', 'user'].includes(root.source) || typeof root.trusted !== 'boolean') throw failure('SKILL_INVALID_ROOT');
    validateSkillPath(root.path);
    return { ...root };
  });
  for (const names of [options.disabledNames, options.reservedNames]) {
    if (names !== undefined && (!Array.isArray(names) || names.some(name => !validName(name)))) throw failure('SKILL_INVALID_NAMES');
  }
  const disabled = new Set(options.disabledNames), reserved = new Set(options.reservedNames), seen = new Set<string>();
  const skills: SkillMetadata[] = [], diagnostics: SkillDiagnostic[] = [];
  let entries = 0, candidates = 0;
  for (const root of roots) {
    checkSignal(options.signal);
    if (!root.trusted) { diagnostics.push({ code: 'SKILL_ROOT_UNTRUSTED', severity: 'warning', path: root.path }); continue; }
    const directories: string[] = [];
    try {
      await validateSkillDirectory(root.path, options.signal);
      for await (const entry of await opendir(root.path)) {
        checkSignal(options.signal);
        if (++entries > 2048) throw failure('SKILL_SCAN_LIMIT');
        if (entry.isDirectory() || entry.isSymbolicLink()) {
          if (++candidates > 256) throw failure('SKILL_SCAN_LIMIT');
          directories.push(entry.name);
        }
      }
    } catch (cause) {
      checkSignal(options.signal);
      const code = codeOf(cause, 'SKILL_ROOT_UNREADABLE');
      if (code === 'SKILL_SCAN_LIMIT') throw cause;
      if (code !== 'ENOENT') diagnostics.push({ code, severity: 'error', path: root.path });
      continue;
    }
    for (const name of directories.sort()) {
      checkSignal(options.signal);
      const baseDir = join(root.path, name), filePath = join(baseDir, 'SKILL.md');
      try {
        await lstat(filePath);
      } catch (cause) {
        checkSignal(options.signal);
        if (codeOf(cause, 'SKILL_UNREADABLE') === 'ENOENT') continue;
        seen.add(name);
        diagnostics.push({ code: 'SKILL_UNREADABLE', severity: 'error', path: filePath, name });
        continue;
      }
      const skip = seen.has(name) ? 'SKILL_SHADOWED' : disabled.has(name) ? 'SKILL_DISABLED' : reserved.has(name) ? 'SKILL_RESERVED_NAME' : undefined;
      seen.add(name);
      if (skip) { diagnostics.push({ code: skip, severity: 'warning', path: filePath, name }); continue; }
      try {
        await validateSkillFile({ baseDir, filePath }, options.signal);
        const snapshot = await readFile(baseDir, 'SKILL.md', options.signal, 32768);
        if (!snapshot) throw failure('SKILL_NOT_FOUND');
        const parsed = parseSkill(snapshot.content);
        if (parsed.name !== name) throw failure('SKILL_NAME_MISMATCH');
        skills.push(Object.freeze({ name, description: parsed.description, disableModelInvocation: parsed.disableModelInvocation,
          userInvocable: parsed.userInvocable, ...(parsed.argumentHint === undefined ? {} : { argumentHint: parsed.argumentHint }),
          filePath, baseDir, source: root.source, revision: snapshot.revision }));
        diagnostics.push(...parsed.warnings.map(warning => ({ ...warning, severity: 'warning' as const, path: filePath, name })));
      } catch (cause) {
        checkSignal(options.signal);
        diagnostics.push({ code: codeOf(cause, 'SKILL_UNREADABLE'), severity: 'error', path: filePath, name });
      }
    }
  }
  checkSignal(options.signal);
  return Object.freeze({ skills: Object.freeze(skills), diagnostics: Object.freeze(diagnostics.map(diagnostic => Object.freeze(diagnostic))) });
}
