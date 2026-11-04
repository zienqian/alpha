export function resolve(specifier, context, nextResolve) {
  if (specifier === 'better-sqlite3') throw Object.assign(new Error('driver deliberately unavailable'), { code: 'ERR_MODULE_NOT_FOUND' });
  return nextResolve(specifier, context);
}
