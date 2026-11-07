import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import { readFile } from '../files';
import { checkSignal, failure, relativePath } from '../internal';
import type { ReadSkillOptions, SkillContent, SkillMetadata } from './contracts';
import { parseSkill, validName } from './parse';

export function validateSkillPath(path: string): void {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0') || resolve(path) !== path) throw failure('SKILL_INVALID_PATH');
  relativePath(relative(parse(path).root, path), true);
}

export async function validateSkillDirectory(path: string, signal?: AbortSignal): Promise<void> {
  validateSkillPath(path);
  let current = path;
  while (true) {
    checkSignal(signal);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw failure('LINK_NOT_ALLOWED');
    if (!stat.isDirectory()) throw failure('NOT_A_DIRECTORY');
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const canonical = await realpath(path);
  if ((process.platform === 'win32' ? canonical.toLowerCase() !== path.toLowerCase() : canonical !== path)) throw failure('SKILL_INVALID_PATH');
}

export function validateSkillMetadata(skill: SkillMetadata): void {
  if (!skill || !validName(skill.name) || typeof skill.description !== 'string' || !skill.description.trim() || [...skill.description].length > 1024
    || !['project', 'user'].includes(skill.source) || typeof skill.revision !== 'string' || !/^[a-f0-9]{64}$/.test(skill.revision)
    || typeof skill.disableModelInvocation !== 'boolean' || typeof skill.userInvocable !== 'boolean'
    || (skill.disableModelInvocation && !skill.userInvocable)
    || (skill.argumentHint !== undefined && (typeof skill.argumentHint !== 'string' || !skill.argumentHint.trim() || [...skill.argumentHint].length > 256))) throw failure('SKILL_INVALID_METADATA');
  validateSkillPath(skill.baseDir);
  validateSkillPath(skill.filePath);
  if (skill.filePath !== join(skill.baseDir, 'SKILL.md') || basename(skill.baseDir) !== skill.name) throw failure('SKILL_INVALID_METADATA');
}

export async function validateSkillFile(skill: Pick<SkillMetadata, 'baseDir' | 'filePath'>, signal?: AbortSignal): Promise<void> {
  await validateSkillDirectory(skill.baseDir, signal);
  const stat = await lstat(skill.filePath);
  if (stat.isSymbolicLink()) throw failure('LINK_NOT_ALLOWED');
  if (!stat.isFile()) throw failure('NOT_A_FILE');
  checkSignal(signal);
}

export async function readSkill(skill: SkillMetadata, options: ReadSkillOptions = {}): Promise<SkillContent> {
  checkSignal(options.signal);
  validateSkillMetadata(skill);
  skill = { ...skill };
  try { await validateSkillFile(skill, options.signal); }
  catch (cause) {
    checkSignal(options.signal);
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') throw failure('FILE_NOT_FOUND');
    throw cause;
  }
  const snapshot = await readFile(skill.baseDir, 'SKILL.md', options.signal, 32768);
  if (!snapshot) throw failure('SKILL_NOT_FOUND');
  if (snapshot.revision !== skill.revision) throw failure('SKILL_CHANGED');
  const parsed = parseSkill(snapshot.content);
  if (parsed.name !== skill.name) throw failure('SKILL_NAME_MISMATCH');
  checkSignal(options.signal);
  return Object.freeze({ name: skill.name, filePath: skill.filePath, baseDir: skill.baseDir, revision: snapshot.revision, content: parsed.content });
}
