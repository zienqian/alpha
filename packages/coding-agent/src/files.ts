import { createHash, randomUUID } from 'node:crypto';
import { lstat, realpath, open, rename, link, unlink } from 'node:fs/promises';
import { dirname, join, relative, isAbsolute, sep } from 'node:path';
import type { FileSnapshot, FileWrite, FileWriteOutcome } from './contracts';
import { checkSignal, codeOf, failure, relativePath } from './internal';

const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const errorCode = (cause: unknown) => (cause as { code?: string })?.code;
const canonical = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;
const inside = (root: string, path: string) => { const rel = relative(root, path); return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel); };

export async function canonicalCwd(cwd: string): Promise<string> {
  const root = await realpath(cwd);
  if (!(await lstat(root)).isDirectory()) throw failure('CWD_NOT_DIRECTORY');
  return root;
}

export async function resolvePath(root: string, path: string, missingLeaf = false, directory = false): Promise<string> {
  const rel = relativePath(path, directory);
  if (canonical(await realpath(root)) !== canonical(root)) throw failure('CWD_MOVED');
  if (rel === '.') return root;
  let target = root;
  const segments = rel.split('/');
  for (let i = 0; i < segments.length; i++) {
    target = join(target, segments[i]);
    try {
      const stat = await lstat(target);
      if (stat.isSymbolicLink()) throw failure('LINK_NOT_ALLOWED');
      const resolved = await realpath(target);
      if (!inside(root, resolved)) throw failure('PATH_OUTSIDE_CWD');
      target = resolved;
      if ((i < segments.length - 1 || directory) && !stat.isDirectory()) throw failure('PARENT_NOT_DIRECTORY');
    } catch (cause) {
      if (errorCode(cause) === 'ENOENT' && missingLeaf && i === segments.length - 1) return target;
      if (errorCode(cause) === 'ENOENT') throw failure('FILE_NOT_FOUND');
      throw cause;
    }
  }
  return target;
}
export async function readFile(root: string, path: string, signal?: AbortSignal, maxFile = 1048576): Promise<FileSnapshot | undefined> {
  checkSignal(signal);
  let target: string;
  try { target = await resolvePath(root, path, true); }
  catch (cause) { if (errorCode(cause) === 'FILE_NOT_FOUND') return undefined; throw cause; }
  let file;
  try { file = await open(target, 'r'); } catch (cause) { if (errorCode(cause) === 'ENOENT') return undefined; throw cause; }
  try {
    if (!(await file.stat()).isFile()) throw failure('NOT_A_FILE');
    const data = Buffer.alloc(maxFile + 1); let length = 0;
    while (length < data.length) { checkSignal(signal); const { bytesRead } = await file.read(data, length, data.length - length, null); if (!bytesRead) break; length += bytesRead; }
    if (length > maxFile) throw failure('FILE_TOO_LARGE');
    const bytes = data.subarray(0, length);
    if (bytes.includes(0)) throw failure('BINARY_FILE');
    let content: string;
    try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { throw failure('INVALID_UTF8'); }
    return { path: process.platform === 'win32' ? relative(root, target).replaceAll('\\', '/') : relative(root, target), content, revision: hash(bytes) };
  } finally { await file.close(); }
}

export async function writeFile(root: string, input: FileWrite, signal?: AbortSignal, maxFile = 1048576): Promise<FileWriteOutcome> {
  let temp: string | undefined, effectStarted = false;
  try {
    checkSignal(signal);
    const bytes = Buffer.from(input.content, 'utf8');
    if (bytes.length > maxFile) return { status: 'rejected', code: 'FILE_TOO_LARGE' };
    if (bytes.toString('utf8') !== input.content || bytes.includes(0)) return { status: 'rejected', code: 'INVALID_UTF8' };
    const target = await resolvePath(root, input.path, true), snapshot = await readFile(root, input.path, signal);
    if (input.expectedRevision === null ? snapshot !== undefined : snapshot?.revision !== input.expectedRevision) return { status: 'rejected', code: input.expectedRevision === null ? 'FILE_EXISTS' : snapshot ? 'FILE_CONFLICT' : 'FILE_NOT_FOUND' };
    await resolvePath(root, input.path, true); checkSignal(signal);
    temp = join(dirname(target), `.alpha-${randomUUID()}.tmp`);
    const handle = await open(temp, 'wx', snapshot ? (await lstat(target)).mode : 0o666);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    // A cooperative external editor may have changed the file while the temp was written.
    const current = await readFile(root, input.path, signal);
    if ((current?.revision ?? null) !== input.expectedRevision) return { status: 'rejected', code: 'FILE_CONFLICT' };
    await resolvePath(root, input.path, true); checkSignal(signal);
    effectStarted = true;
    if (input.expectedRevision === null) await link(temp, target); else await rename(temp, target);
    return { status: 'applied', revision: hash(bytes) };
  } catch (cause) {
    if (errorCode(cause) === 'EEXIST') return { status: 'rejected', code: 'FILE_EXISTS' };
    return { status: effectStarted ? 'unknown' : 'rejected', code: codeOf(cause, effectStarted ? 'WRITE_OUTCOME_UNKNOWN' : 'WRITE_REJECTED') };
  } finally { if (temp) await unlink(temp).catch(() => { /* Successful rename already removed the temp. */ }); }
}
