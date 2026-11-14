import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";

const execute = promisify(execFile);
export interface Descriptor { origin: string; token: string; instanceId: string; protocolVersion: number }
export interface BackendOptions { root: string; bun: string; database?: string }

export function parseDescriptor(value: unknown): Descriptor {
  if (!value || typeof value !== "object") throw new Error("SERVER_INCOMPATIBLE");
  const descriptor = value as Descriptor;
  if (descriptor.protocolVersion !== 2 || typeof descriptor.origin !== "string"
    || !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(descriptor.origin)
    || Number(new URL(descriptor.origin).port) > 65535 || typeof descriptor.token !== "string"
    || !/^[\w-]{32,256}$/.test(descriptor.token) || typeof descriptor.instanceId !== "string" || !descriptor.instanceId) {
    throw new Error("SERVER_INCOMPATIBLE");
  }
  return descriptor;
}

// node:http connects directly to loopback, regardless of the system proxy.
// The native credential stays in the main process; renderer headers are not forwarded.
export function forwardRequest(descriptor: Descriptor, path: string, method: string,
  body?: Uint8Array, contentType?: string, signal?: AbortSignal): Promise<Response> {
  if (!path.startsWith("/api/") || path.includes("\r") || path.includes("\n")) return Promise.reject(new Error("INVALID_API_PATH"));
  const origin = new URL(descriptor.origin);
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port: origin.port, path, method, signal,
      headers: { authorization: `Bearer ${descriptor.token}`, origin: descriptor.origin,
        ...(contentType ? { "content-type": contentType } : {}), ...(body ? { "content-length": body.byteLength } : {}) },
    }, incoming => {
      clearTimeout(timer);
      const headers = new Headers({ "cache-control": "no-store" });
      for (const name of ["content-type", "content-disposition", "content-security-policy", "x-content-type-options", "referrer-policy"] as const) {
        const value = incoming.headers[name];
        if (typeof value === "string") headers.set(name, value);
      }
      const status = incoming.statusCode ?? 502;
      // Never follow backend redirects or expose cookies/native credentials.
      if (status >= 300 && status < 400) { incoming.destroy(); reject(new Error("SERVER_REDIRECT_REJECTED")); return; }
      const stream = Readable.toWeb(incoming) as unknown as ReadableStream<Uint8Array>;
      resolve(new Response(status === 204 ? null : stream, { status, headers }));
    });
    const timer = setTimeout(() => request.destroy(new Error("SERVER_REQUEST_TIMEOUT")), 30000);
    request.once("error", error => { clearTimeout(timer); reject(error); });
    request.end(body);
  });
}

export function createBackend(options: BackendOptions) {
  let connection: Promise<Descriptor> | undefined;
  const connect = () => connection ??= (async () => {
    const entry = join(options.root, "apps/alphacode-app-server/src/main.ts");
    const args = ["--no-env-file", "--conditions=alpha-source", entry, "--ensure"];
    if (options.database) args.push("--database", options.database);
    const { stdout } = await execute(options.bun, args, {
      cwd: options.root, windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    }).catch(() => { throw new Error("SERVER_START_FAILED"); });
    const ready = stdout.split(/\r?\n/).map(line => { try { return JSON.parse(line); } catch { return null; } })
      .find(value => value?.event === "ready" && typeof value.descriptorPath === "string");
    if (!ready) throw new Error("SERVER_START_FAILED");
    const descriptor = parseDescriptor(JSON.parse(await readFile(ready.descriptorPath, "utf8")));
    const response = await forwardRequest(descriptor, "/api/info", "GET", undefined, undefined, AbortSignal.timeout(5000));
    const info = await response.json() as { instanceId?: string; protocolVersion?: number };
    if (!response.ok || info.instanceId !== descriptor.instanceId || info.protocolVersion !== 2) throw new Error("SERVER_IDENTITY_MISMATCH");
    return descriptor;
  })().catch(error => { connection = undefined; throw error; });

  return {
    connect,
    async forward(request: Request) {
      const url = new URL(request.url);
      const body = ["GET", "HEAD"].includes(request.method) ? undefined : new Uint8Array(await request.arrayBuffer());
      try {
        return await forwardRequest(await connect(), url.pathname + url.search, request.method,
          body, request.headers.get("content-type") ?? undefined, request.signal);
      } catch {
        // A failed POST may already have been accepted. Let the existing Web UI
        // retry with its original requestId rather than silently replaying it.
        if (!request.signal.aborted) connection = undefined;
        return Response.json({ code: "SERVER_UNAVAILABLE" }, { status: 503 });
      }
    },
  };
}
