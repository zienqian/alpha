import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { fail } from "./security";
import { documentResponse, fileMediaType } from './document-response';

const hasControl = (value: string) => [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);

function within(root: string, path: string) {
  const part = relative(root, path);
  return part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part);
}

export function localPath(value: string) {
  if (!value || value.length > 8192 || hasControl(value)) return fail(400, "INVALID_FILE_PATH");
  let path: string;
  try {
    if (/^file:/i.test(value)) {
      const url = new URL(value);
      if (url.hostname && url.hostname !== "localhost") return fail(400, "INVALID_FILE_PATH");
      path = fileURLToPath(url);
    } else {
      path = decodeURIComponent(value.split(/[?#]/, 1)[0] ?? "");
    }
  } catch { return fail(400, "INVALID_FILE_PATH"); }
  // Strip optional editor line/column suffixes, but never admit UNC/device paths,
  // alternate data streams or a URL disguised as a local filename.
  path = path.replace(/:\d+(?::\d+)?$/, "");
  const rest = /^[a-z]:[\\/]/i.test(path) ? path.slice(2) : path;
  if (!path || hasControl(rest) || rest.includes(":") || /^[\\/]{2}/.test(path)) return fail(400, "INVALID_FILE_PATH");
  return path;
}

/** Files are resolved in the owning session's workspace, never in the server cwd. */
export async function sessionFile(workspace: string, url: URL) {
  const mode = url.searchParams.get("mode") ?? "info";
  if (!["info", "open", "download"].includes(mode)) return fail(400, "INVALID_FILE_MODE");
  const input = localPath(url.searchParams.get("path") ?? "");
  const root = await realpath(workspace).catch(() => fail(404, "FILE_NOT_FOUND"));
  const requested = resolve(root, input);
  if (!within(root, requested)) return fail(403, "FILE_OUTSIDE_WORKSPACE");
  const path = await realpath(requested).catch(() => fail(404, "FILE_NOT_FOUND"));
  if (!within(root, path)) return fail(403, "FILE_OUTSIDE_WORKSPACE");
  const info = await stat(path).catch(() => fail(404, "FILE_NOT_FOUND"));
  if (!info.isFile()) return fail(400, "NOT_A_FILE");
  return documentResponse({ path, name: basename(path), size: info.size, mediaType: fileMediaType(path), body: Bun.file(path) }, url);
}
