import { expect, test } from "bun:test";
import { createServer } from "node:http";
import { developmentAPI } from "../scripts/dev-api";

test("the development bridge forwards JSON and SSE, rejects cross-site requests, and cancels streams", async () => {
  let origin = "";
  const requests: Request[] = [];
  let cancelled = false;
  const middleware = developmentAPI({ async forward(request) {
    requests.push(request);
    if (new URL(request.url).pathname === "/api/events") {
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('data: {"ready":true}\n\n')); },
        cancel() { cancelled = true; },
      }), { headers: { "content-type": "text/event-stream" } });
    }
    return Response.json({ body: await request.json(), authorization: request.headers.get("authorization") });
  } }, () => origin);
  const server = createServer((request, response) => { void middleware(request, response, () => response.writeHead(404).end()); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test address");
  origin = `http://127.0.0.1:${address.port}`;
  try {
    const post = await fetch(`${origin}/api/sessions`, { proxy: false, method: "POST",
      headers: { origin, "content-type": "application/json", authorization: "Bearer renderer-controlled" }, body: '{"projectId":"one"}' });
    expect(await post.json()).toEqual({ body: { projectId: "one" }, authorization: null });
    const rejected: Record<string, string>[] = [{ origin: "https://evil.test" }, { "sec-fetch-site": "cross-site" }, { host: "evil.test" }];
    for (const headers of rejected) {
      expect((await fetch(`${origin}/api/sessions`, { proxy: false, method: "POST", headers })).status).toBe(403);
    }
    expect(requests).toHaveLength(1);
    const abort = new AbortController();
    const events = await fetch(`${origin}/api/events`, { proxy: false, signal: abort.signal });
    expect(events.headers.get("content-type")).toBe("text/event-stream");
    const reader = events.body?.getReader();
    expect(new TextDecoder().decode((await reader?.read())?.value)).toContain('data: {"ready":true}');
    abort.abort();
    await reader?.cancel().catch(() => { /* Abort already closed the reader. */ });
    for (let i = 0; i < 100 && !cancelled; i++) await Bun.sleep(10);
    expect(cancelled).toBe(true);
    expect(requests[1]?.signal.aborted).toBe(true);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
