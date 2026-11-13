import { isAbsolute, relative, resolve } from "node:path";

export const applicationURL = "alphacode-app://app/";

export function developmentURL(value: string | undefined, packaged: boolean) {
  if (!value || packaged) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port
      && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash) return url.origin + "/";
  } catch { /* An invalid development URL must never become a navigation target. */ }
  throw new Error("INVALID_DEVELOPMENT_URL");
}

export function isRendererURL(value: string, development?: string) {
  if (!development) return isApplicationURL(value);
  try {
    const url = new URL(value);
    return url.origin === new URL(development).origin && !url.username && !url.password;
  } catch { return false; }
}

export function isApplicationURL(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "alphacode-app:" && url.hostname === "app" && !url.port && !url.username && !url.password;
  } catch { return false; }
}

export function externalURL(value: string) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

export function assetPath(directory: string, pathname: string) {
  const decoded = decodeURIComponent(pathname);
  if (decoded.includes("\0") || decoded.includes("\\")) throw new Error("INVALID_ASSET_PATH");
  const file = resolve(directory, decoded === "/" ? "index.html" : `.${decoded}`);
  const within = relative(directory, file);
  if (!within || within.startsWith("..") || isAbsolute(within)) throw new Error("INVALID_ASSET_PATH");
  return file;
}

export function databaseArgument(args: string[]) {
  const index = args.indexOf("--database");
  if (index < 0) return undefined;
  const path = args[index + 1];
  if (!path || path.startsWith("--")) throw new Error("DATABASE_REQUIRED");
  return resolve(path);
}
