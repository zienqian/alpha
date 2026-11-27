import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ChatAttachment } from "./chat/contracts";
import { fail } from "./server/security";

export const maxUploadFileBytes = 20 * 1024 * 1024;
export const maxUploadFilesPerMessage = 10;
export const maxSessionUploadBytes = 200 * 1024 * 1024;
export const maxRequestUploadBytes = 25 * 1024 * 1024;

const uploadIdPattern = /^[a-f0-9-]{8,64}$/;
const windowsReserved = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i;

const extensionMediaTypes: Readonly<Record<string, string>> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".json": "application/json",
  ".jsonl": "application/json",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".log": "text/plain",
  ".yaml": "text/plain",
  ".yml": "text/plain",
  ".toml": "text/plain",
  ".ini": "text/plain",
  ".conf": "text/plain",
  ".env": "text/plain",
  ".xml": "application/xml",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".scss": "text/plain",
  ".less": "text/plain",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".cjs": "text/javascript",
  ".jsx": "text/plain",
  ".ts": "text/plain",
  ".tsx": "text/plain",
  ".mts": "text/plain",
  ".py": "text/plain",
  ".rs": "text/plain",
  ".go": "text/plain",
  ".java": "text/plain",
  ".kt": "text/plain",
  ".swift": "text/plain",
  ".c": "text/plain",
  ".cc": "text/plain",
  ".cpp": "text/plain",
  ".h": "text/plain",
  ".hpp": "text/plain",
  ".cs": "text/plain",
  ".rb": "text/plain",
  ".php": "text/plain",
  ".sh": "text/plain",
  ".bash": "text/plain",
  ".zsh": "text/plain",
  ".ps1": "text/plain",
  ".sql": "text/plain",
  ".vue": "text/plain",
  ".svelte": "text/plain",
  ".graphql": "text/plain",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".gz": "application/gzip",
  ".tar": "application/x-tar",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const visionMediaTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export interface StoredUpload {
  readonly id: string;
  readonly name: string;
  readonly safeName: string;
  readonly mediaType: string;
  readonly size: number;
  readonly sha256: string;
  readonly createdAt: string;
  readonly path: string;
}

interface StoredUploadMeta {
  id: string;
  name: string;
  safeName: string;
  mediaType: string;
  size: number;
  sha256: string;
  createdAt: string;
}

export interface UploadStore {
  readonly rootDirectory: string;
  save(scopeId: string, input: { name: string; mediaType?: string; bytes: Uint8Array }): Promise<StoredUpload>;
  get(scopeId: string, uploadId: string): Promise<StoredUpload | undefined>;
  resolveMany(scopeId: string, uploadIds: readonly string[]): Promise<StoredUpload[]>;
  readBytes(scopeId: string, uploadId: string): Promise<{ upload: StoredUpload; bytes: Uint8Array<ArrayBuffer> } | undefined>;
  remove(scopeId: string, uploadId: string): Promise<boolean>;
  removeScope(scopeId: string): Promise<void>;
}

const sha256Hex = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

function within(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export function sessionUploadScope(sessionId: string): string {
  return `session:${sessionId}`;
}

export function botUploadScope(botId: string): string {
  return `bot:${botId}`;
}

export function sessionUploadUrl(sessionId: string, uploadId: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}/uploads/${encodeURIComponent(uploadId)}`;
}

export function botUploadUrl(botId: string, uploadId: string): string {
  return `/api/bots/${encodeURIComponent(botId)}/uploads/${encodeURIComponent(uploadId)}`;
}

export function toChatAttachment(upload: Pick<StoredUpload, "id" | "name" | "mediaType" | "size" | "sha256">, url: string): ChatAttachment {
  return {
    id: upload.id,
    name: upload.name,
    mediaType: upload.mediaType,
    size: upload.size,
    sha256: upload.sha256,
    url,
  };
}

export function detectImageMagic(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/gif" | "image/webp" | undefined {
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 6
    && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38
    && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) {
    return "image/gif";
  }
  if (bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return "image/webp";
  }
  return undefined;
}

export function isVisionImage(mediaType: string, bytes: Uint8Array): boolean {
  const normalized = mediaType.split(";")[0]?.trim().toLowerCase() ?? "";
  return visionMediaTypes.has(normalized) && detectImageMagic(bytes) !== undefined;
}

export function isLikelyUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return true;
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export function detectUploadMediaType(filename: string, declaredType: string | undefined, bytes: Uint8Array): string {
  const magic = detectImageMagic(bytes);
  if (magic) return magic;
  const ext = extname(filename).toLowerCase();
  const mapped = extensionMediaTypes[ext];
  if (mapped && !visionMediaTypes.has(mapped)) return mapped;
  const cleaned = declaredType?.split(";")[0]?.trim().toLowerCase();
  if (cleaned && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(cleaned) && !visionMediaTypes.has(cleaned)) {
    return cleaned;
  }
  if (bytes.length <= 256 * 1024 && isLikelyUtf8Text(bytes)) return "text/plain";
  return "application/octet-stream";
}

export function displayFileName(raw: string): string {
  const leaf = raw.split(/[\\/]/).filter(Boolean).at(-1) ?? "";
  const cleaned = [...leaf]
    .filter(char => {
      const code = char.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .trim()
    .slice(0, 255);
  return cleaned || "file";
}

export function safeDiskFileName(raw: string): string {
  const display = displayFileName(raw);
  const rawExt = extname(display);
  const cleanExt = rawExt.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 24);
  const stemSource = rawExt ? display.slice(0, -rawExt.length) : display;
  let stem = stemSource
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  if (!stem || stem === "." || stem === ".." || windowsReserved.test(stem)) {
    stem = "file";
  }
  const maxStem = Math.max(1, 160 - cleanExt.length);
  stem = stem.slice(0, maxStem).replace(/[. ]+$/g, "") || "file";
  let result = `${stem}${cleanExt}`;
  if (result.toLowerCase() === "meta.json") result = "file-meta.json";
  return result;
}

export function defaultUploadsDirectory(databasePath: string): string {
  const resolved = resolve(databasePath);
  const canonical = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  return join(dirname(canonical), `.${basename(canonical)}.server`, "uploads");
}

async function atomicWriteFile(path: string, content: Uint8Array | string) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, content, { mode: 0o600 });
  await rename(temp, path);
}

function parseMeta(raw: unknown): StoredUploadMeta | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "string" || !uploadIdPattern.test(value.id)) return undefined;
  if (typeof value.name !== "string" || !value.name || value.name.length > 255) return undefined;
  if (typeof value.safeName !== "string" || !value.safeName || value.safeName.includes("/") || value.safeName.includes("\\")) return undefined;
  if (typeof value.mediaType !== "string" || !value.mediaType || value.mediaType.length > 256) return undefined;
  if (typeof value.size !== "number" || !Number.isSafeInteger(value.size) || value.size < 0 || value.size > maxUploadFileBytes) return undefined;
  if (typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)) return undefined;
  if (typeof value.createdAt !== "string" || !value.createdAt) return undefined;
  return {
    id: value.id,
    name: value.name,
    safeName: value.safeName,
    mediaType: value.mediaType,
    size: value.size,
    sha256: value.sha256,
    createdAt: value.createdAt,
  };
}

export function createUploadStore(rootDirectory: string): UploadStore {
  const root = resolve(rootDirectory);

  function scopeDir(scopeId: string): string {
    if (!scopeId || scopeId.length > 1024) fail(400, "INVALID_UPLOAD_SCOPE");
    return join(root, sha256Hex(scopeId));
  }

  function entryDir(scopeId: string, uploadId: string): string {
    if (!uploadIdPattern.test(uploadId)) fail(400, "INVALID_ATTACHMENT");
    return join(scopeDir(scopeId), uploadId);
  }

  async function scopeUsedBytes(scopeId: string): Promise<number> {
    const dir = scopeDir(scopeId);
    const items = await readdir(dir, { withFileTypes: true }).catch(() => []);
    let total = 0;
    for (const item of items) {
      if (!item.isDirectory() || item.isSymbolicLink() || !uploadIdPattern.test(item.name)) continue;
      try {
        const raw = JSON.parse(await readFile(join(dir, item.name, "meta.json"), "utf8"));
        const meta = parseMeta(raw);
        if (meta) total += meta.size;
      } catch {
        continue;
      }
    }
    return total;
  }

  async function get(scopeId: string, uploadId: string): Promise<StoredUpload | undefined> {
    if (!uploadIdPattern.test(uploadId)) return undefined;
    const dir = join(scopeDir(scopeId), uploadId);
    let meta: StoredUploadMeta | undefined;
    try {
      meta = parseMeta(JSON.parse(await readFile(join(dir, "meta.json"), "utf8")));
    } catch {
      return undefined;
    }
    if (!meta || meta.id !== uploadId) return undefined;
    const filePath = resolve(dir, meta.safeName);
    if (!within(dir, filePath)) return undefined;
    try {
      const linkStat = await lstat(filePath);
      if (!linkStat.isFile() || linkStat.isSymbolicLink()) return undefined;
      const resolvedDir = await realpath(dir);
      const resolvedFile = await realpath(filePath);
      if (!within(resolvedDir, resolvedFile)) return undefined;
      return { ...meta, path: resolvedFile };
    } catch {
      return undefined;
    }
  }

  return {
    rootDirectory: root,
    async save(scopeId, input) {
      const bytes = input.bytes;
      if (bytes.byteLength > maxUploadFileBytes) fail(413, "UPLOAD_TOO_LARGE");
      const used = await scopeUsedBytes(scopeId);
      if (used + bytes.byteLength > maxSessionUploadBytes) fail(413, "UPLOAD_QUOTA_EXCEEDED");

      const id = randomUUID();
      const name = displayFileName(input.name);
      const safeName = safeDiskFileName(name);
      const mediaType = detectUploadMediaType(name, input.mediaType, bytes);
      const sha256 = sha256Hex(bytes);
      const createdAt = new Date().toISOString();
      const dir = entryDir(scopeId, id);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const filePath = join(dir, safeName);
      const meta: StoredUploadMeta = { id, name, safeName, mediaType, size: bytes.byteLength, sha256, createdAt };
      await atomicWriteFile(filePath, bytes);
      await atomicWriteFile(join(dir, "meta.json"), JSON.stringify(meta));
      const resolvedFile = await realpath(filePath);
      return { ...meta, path: resolvedFile };
    },
    get,
    async resolveMany(scopeId, uploadIds) {
      if (uploadIds.length > maxUploadFilesPerMessage) return fail(400, "TOO_MANY_ATTACHMENTS");
      const seen = new Set<string>();
      const uploads: StoredUpload[] = [];
      for (const id of uploadIds) {
        if (typeof id !== "string" || !uploadIdPattern.test(id) || seen.has(id)) {
          return fail(400, "INVALID_ATTACHMENT");
        }
        seen.add(id);
        const found = await get(scopeId, id);
        if (!found) return fail(404, "ATTACHMENT_NOT_FOUND");
        uploads.push(found);
      }
      return uploads;
    },
    async readBytes(scopeId, uploadId) {
      const upload = await get(scopeId, uploadId);
      if (!upload) return undefined;
      try {
        const info = await stat(upload.path);
        if (!info.isFile() || info.size > maxUploadFileBytes) return undefined;
        const raw = await readFile(upload.path);
        const bytes = new Uint8Array(new ArrayBuffer(raw.byteLength));
        bytes.set(raw);
        if (sha256Hex(bytes) !== upload.sha256) return undefined;
        return { upload, bytes };
      } catch {
        return undefined;
      }
    },
    async remove(scopeId, uploadId) {
      if (!uploadIdPattern.test(uploadId)) fail(400, "INVALID_ATTACHMENT");
      const dir = entryDir(scopeId, uploadId);
      const exists = await lstat(dir).then(entry => entry.isDirectory() && !entry.isSymbolicLink(), () => false);
      if (!exists) return false;
      await rm(dir, { recursive: true, force: true });
      return true;
    },
    async removeScope(scopeId) {
      const dir = scopeDir(scopeId);
      if (!within(root, dir)) return;
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export async function parseUploadRequest(request: Request): Promise<Array<{ name: string; mediaType?: string; bytes: Uint8Array }>> {
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "multipart/form-data") return fail(415, "MULTIPART_REQUIRED");
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "INVALID_MULTIPART");
  }
  const files: File[] = [];
  form.forEach(entry => {
    const candidate: unknown = entry;
    if (candidate instanceof File) files.push(candidate);
  });
  if (files.length === 0) return fail(400, "UPLOAD_FILE_REQUIRED");
  if (files.length > maxUploadFilesPerMessage) return fail(400, "TOO_MANY_ATTACHMENTS");
  const result: Array<{ name: string; mediaType?: string; bytes: Uint8Array }> = [];
  let batchBytes = 0;
  for (const file of files) {
    if (file.size > maxUploadFileBytes) return fail(413, "UPLOAD_TOO_LARGE");
    batchBytes += file.size;
    if (batchBytes > maxRequestUploadBytes) return fail(413, "UPLOAD_TOO_LARGE");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > maxUploadFileBytes) return fail(413, "UPLOAD_TOO_LARGE");
    result.push({
      name: file.name || "file",
      mediaType: file.type || undefined,
      bytes,
    });
  }
  return result;
}

export function parseAttachmentIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return fail(400, "INVALID_ATTACHMENT");
  if (value.length > maxUploadFilesPerMessage) return fail(400, "TOO_MANY_ATTACHMENTS");
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !uploadIdPattern.test(entry) || seen.has(entry)) {
      return fail(400, "INVALID_ATTACHMENT");
    }
    seen.add(entry);
    ids.push(entry);
  }
  return ids;
}
