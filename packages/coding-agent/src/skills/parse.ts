import { isMap, isScalar, parseDocument, visit } from 'yaml';
import { byteLength, failure } from '../internal';

export const skillName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const validName = (value: unknown): value is string => typeof value === 'string' && value.length <= 64 && skillName.test(value);
const stringWithin = (value: unknown, limit: number): value is string => typeof value === 'string' && value.trim().length > 0 && [...value].length <= limit;
const unsupported = new Set(['context', 'agent', 'hooks', 'model', 'effort']);
const known = new Set(['name', 'description', 'argument-hint', 'disable-model-invocation', 'user-invocable', 'license', 'compatibility', 'metadata']);

export function parseSkill(text: string) {
  const source = text.replace(/^\uFEFF/, '');
  const opening = /^---\r?\n/.exec(source);
  if (!opening) throw failure('SKILL_FRONTMATTER_REQUIRED');
  const closing = /^---\r?$(?:\n|$)/m.exec(source.slice(opening[0].length));
  if (!closing) throw failure('SKILL_FRONTMATTER_REQUIRED');
  const header = source.slice(opening[0].length, opening[0].length + closing.index);
  if (byteLength(header) > 8192) throw failure('SKILL_FRONTMATTER_TOO_LARGE');
  const document = parseDocument(header, { prettyErrors: false, uniqueKeys: true, stringKeys: true, merge: false });
  if (document.errors.length || document.warnings.length || !isMap(document.contents)) throw failure('SKILL_INVALID_YAML');
  visit(document, {
    Alias() { throw failure('SKILL_INVALID_YAML'); },
    Node(_key, node) { if (node.tag) throw failure('SKILL_INVALID_YAML'); },
    Pair(_key, pair) { if (isScalar(pair.key) && pair.key.value === '<<') throw failure('SKILL_INVALID_YAML'); },
  });
  const value = document.toJS({ maxAliasCount: 0 }) as Record<string, unknown>;
  if (!validName(value.name)) throw failure('SKILL_INVALID_NAME');
  if (!stringWithin(value.description, 1024)) throw failure('SKILL_INVALID_DESCRIPTION');
  for (const field of ['disable-model-invocation', 'user-invocable']) {
    if (value[field] !== undefined && typeof value[field] !== 'boolean') throw failure('SKILL_INVALID_FIELD');
  }
  if (value['argument-hint'] !== undefined && !stringWithin(value['argument-hint'], 256)) throw failure('SKILL_INVALID_FIELD');
  for (const field of ['license', 'compatibility']) {
    if (value[field] !== undefined && !stringWithin(value[field], 1024)) throw failure('SKILL_INVALID_FIELD');
  }
  if (value.metadata !== undefined && (!value.metadata || typeof value.metadata !== 'object' || Array.isArray(value.metadata)
    || Object.values(value.metadata).some(entry => typeof entry !== 'string'))) throw failure('SKILL_INVALID_FIELD');
  const warnings: { code: string; field: string }[] = [];
  for (const field of Object.keys(value)) {
    if (unsupported.has(field)) throw failure('SKILL_UNSUPPORTED_FIELD');
    if (!known.has(field)) warnings.push({ code: field === 'allowed-tools' ? 'SKILL_ALLOWED_TOOLS_IGNORED' : 'SKILL_UNKNOWN_FIELD', field });
  }
  const disableModelInvocation = value['disable-model-invocation'] === true;
  const userInvocable = value['user-invocable'] !== false;
  if (disableModelInvocation && !userInvocable) throw failure('SKILL_NO_ENTRYPOINT');
  return {
    name: value.name, description: value.description, disableModelInvocation, userInvocable,
    ...(value['argument-hint'] === undefined ? {} : { argumentHint: value['argument-hint'] as string }),
    content: source.slice(opening[0].length + closing.index + closing[0].length), warnings,
  };
}
