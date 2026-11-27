import { isAbsolute, relative, resolve } from "node:path";

export const applicationURL = "alphacode-app://app/";

export const applicationContentSecurityPolicy = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'; frame-ancestors 'none'";

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

/** Only document routes from the trusted renderer can be translated to the local server. */
export function documentPath(value: string, development?: string) {
  if (!isRendererURL(value, development)) return undefined;
  const url = new URL(value);
  if (!/^\/api\/(?:sessions\/[^/]+\/(?:files|artifacts|uploads\/[^/]+)|bots\/[^/]+\/uploads\/[^/]+)$/.test(url.pathname)
    || !['open', 'download'].includes(url.searchParams.get('mode') ?? '')) return undefined;
  return url.pathname + url.search + url.hash;
}

export function assetPath(directory: string, pathname: string) {
  const decoded = decodeURIComponent(pathname);
  if (decoded.includes("\0") || decoded.includes("\\")) throw new Error("INVALID_ASSET_PATH");
  const appRoute = /^\/(?:settings\/?|skills\/?|bots(?:\/[^/]+(?:\/settings)?)?\/?)?$/.test(decoded);
  const file = resolve(directory, appRoute ? "index.html" : `.${decoded}`);
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

/** Native sidebar translucency requires macOS vibrancy or Windows 11 22H2+ Acrylic. */
export function supportsNativeGlass(platform: string, release: string) {
  if (platform === "darwin") return true;
  if (platform !== "win32") return false;
  const [major = 0, , build = 0] = release.split(".").map(part => Number.parseInt(part, 10) || 0);
  return major > 10 || (major === 10 && build >= 22621);
}
