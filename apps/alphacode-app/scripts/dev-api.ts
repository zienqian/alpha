import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { createBackend } from "../src/backend";

// Development-only, same-origin bridge. Native credentials stay in the tool
// process and never enter Vite's client environment or the renderer bundle.
export function developmentAPI(backend: Pick<ReturnType<typeof createBackend>, "forward">, origin: () => string) {
  return async (incoming: IncomingMessage, outgoing: ServerResponse, next: () => void) => {
    if (!incoming.url?.startsWith("/api/")) { next(); return; }
    const base = origin();
    if (incoming.headers.host !== new URL(base).host
      || (incoming.headers.origin && incoming.headers.origin !== base)
      || incoming.headers["sec-fetch-site"] === "cross-site") {
      outgoing.writeHead(403).end();
      return;
    }
    const abort = new AbortController();
    outgoing.once("close", () => abort.abort());
    incoming.once("aborted", () => abort.abort());
    try {
      const method = incoming.method ?? "GET";
      const request = new Request(new URL(incoming.url, base), {
        method, signal: abort.signal,
        headers: incoming.headers["content-type"] ? { "content-type": incoming.headers["content-type"] } : {},
        ...(!["GET", "HEAD"].includes(method) ? { body: Readable.toWeb(incoming) as unknown as ReadableStream<Uint8Array>, duplex: "half" } : {}),
      });
      const response = await backend.forward(request);
      if (outgoing.destroyed) { await response.body?.cancel(); return; }
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (!response.body) { outgoing.end(); return; }
      const stream = Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0]);
      stream.on("error", () => outgoing.destroy());
      outgoing.once("close", () => stream.destroy());
      stream.pipe(outgoing);
    } catch {
      if (!outgoing.headersSent) outgoing.writeHead(503, { "content-type": "application/json" });
      outgoing.end(JSON.stringify({ code: "SERVER_UNAVAILABLE" }));
    }
  };
}
