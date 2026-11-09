import { randomBytes, timingSafeEqual } from "node:crypto";

export const secret = () => randomBytes(32).toString("base64url");
export const fail = (status: number, code: string): never => { throw Object.assign(new Error(code), { status, code }); };

export function equals(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") fail(415, "JSON_REQUIRED");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > 256 * 1024) fail(413, "BODY_TOO_LARGE");
  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { fail(400, "INVALID_JSON"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) fail(400, "INVALID_BODY");
  return body as Record<string, unknown>;
}

export function requiredString(body: Record<string, unknown>, key: string, maximum = 100000) {
  const value = body[key];
  if (typeof value !== "string" || !value.trim() || value.length > maximum) return fail(400, `INVALID_${key.toUpperCase()}`);
  return value;
}

export function createSecurity(token: string, origin: () => string) {
  function native(request: Request) {
    return equals(request.headers.get("authorization") ?? "", `Bearer ${token}`);
  }
  return {
    checkHost(request: Request) {
      if (request.headers.get("host") !== new URL(origin()).host) fail(403, "INVALID_HOST");
      const source = request.headers.get("origin");
      if (source && source !== origin()) fail(403, "INVALID_ORIGIN");
      if (request.headers.get("sec-fetch-site") === "cross-site") fail(403, "CROSS_SITE_REQUEST");
    },
    checkAccess(request: Request, nativeOnly = false) {
      if (native(request)) return;
      if (nativeOnly) fail(401, "NATIVE_CLIENT_REQUIRED");
      if (request.method !== "GET" && request.headers.get("origin") !== origin()) fail(403, "INVALID_ORIGIN");
    },
  };
}
