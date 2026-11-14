import { expect, test } from "bun:test";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { forwardRequest, parseDescriptor } from "../src/backend";
import { assetPath, databaseArgument, developmentURL, documentPath, externalURL, isApplicationURL, isRendererURL } from "../src/policy";

test('document links map from the trusted desktop origin to a browser route without exposing credentials', () => {
  const path = '/api/sessions/s/files?path=C%3A%2Fdoc.html&mode=open&replyId=reply#section';
  expect(documentPath('alphacode-app://app' + path)).toBe(path);
  expect(documentPath('http://127.0.0.1:5173' + path, 'http://127.0.0.1:5173/')).toBe(path);
  expect(documentPath('alphacode-app://app/api/sessions/s/artifacts?reference=context%3A%2F%2Ftest&mode=open')).toContain('/artifacts?');
  for (const value of ['https://evil.test' + path, 'alphacode-app://other' + path,
    'alphacode-app://app/api/info?mode=open', 'alphacode-app://app/api/sessions/s/files?mode=info',
    'alphacode-app://app/api/sessions/s/files?mode=preview', 'file:///C:/doc.html']) {
    expect(documentPath(value)).toBeUndefined();
  }
  expect(documentPath('http://127.0.0.1:5174' + path, 'http://127.0.0.1:5173/')).toBeUndefined();
});

test("development navigation is limited to the selected loopback origin and disabled in packages", () => {
  const url = "http://127.0.0.1:5173/";
  expect(developmentURL(url, false)).toBe(url);
  expect(developmentURL(url, true)).toBeUndefined();
  expect(developmentURL(undefined, false)).toBeUndefined();
  expect(isRendererURL(`${url}?session=test`, url)).toBe(true);
  expect(isRendererURL("alphacode-app://app/", undefined)).toBe(true);
  for (const other of ["http://127.0.0.1:5174/", "https://evil.test/", "http://user@127.0.0.1:5173/", "alphacode-app://app/"]) {
    expect(isRendererURL(other, url)).toBe(false);
  }
  for (const invalid of ["https://evil.test/", "http://localhost:5173/", "http://127.0.0.1/", `${url}?token=secret`]) {
    expect(() => developmentURL(invalid, false)).toThrow("INVALID_DEVELOPMENT_URL");
  }
});

test("only the application's scheme and host can reach the desktop bridge", () => {
  expect(isApplicationURL("alphacode-app://app/?session=hello")).toBe(true);
  for (const url of ["https://app/", "alphacode-app://evil/", "alphacode-app://app.evil/", "alphacode-app://user@app/", "alphacode-app://app:123/", "file:///tmp/index.html"]) {
    expect(isApplicationURL(url)).toBe(false);
  }
  for (const url of ["file:///C:/Windows/notepad.exe", "javascript:alert(1)", "ms-settings:privacy", "https://user:password@example.com"]) expect(externalURL(url)).toBeUndefined();
  expect(externalURL("https://example.com/docs")).toBe("https://example.com/docs");
});

test("local assets cannot escape the Web build directory", () => {
  const root = resolve("web");
  expect(assetPath(root, "/")).toBe(resolve(root, "index.html"));
  for (const route of ["/settings", "/settings/", "/skills", "/skills/"]) {
    expect(assetPath(root, route)).toBe(resolve(root, "index.html"));
    expect(isApplicationURL(`alphacode-app://app${route}`)).toBe(true);
  }
  expect(assetPath(root, "/assets/app.js")).toBe(resolve(root, "assets/app.js"));
  expect(assetPath(root, "/api/missing")).toBe(resolve(root, "api/missing"));
  for (const path of ["/../secret", "/%2e%2e/secret", "/%5c..%5csecret", "/%00", "/%ZZ"]) expect(() => assetPath(root, path)).toThrow();
  expect(databaseArgument(["--database", "sessions.db"])).toBe(resolve("sessions.db"));
  expect(() => databaseArgument(["--database"])).toThrow("DATABASE_REQUIRED");
});

test("server discovery rejects remote, malformed and incompatible descriptors", () => {
  const descriptor = { origin: "http://127.0.0.1:12345", token: "x".repeat(43), instanceId: "test", protocolVersion: 2 };
  expect(parseDescriptor(descriptor)).toEqual(descriptor);
  for (const origin of ["https://127.0.0.1:12345", "http://localhost:12345", "http://evil.test:12345", "http://127.0.0.1:99999", "http://127.0.0.1:12345/path"]) {
    expect(() => parseDescriptor({ ...descriptor, origin })).toThrow();
  }
  expect(() => parseDescriptor({ ...descriptor, protocolVersion: 1 })).toThrow();
  expect(() => parseDescriptor({ ...descriptor, token: "\r\ninvalid" })).toThrow();
});

test("the bridge forwards JSON, preserves API errors, and refuses redirects", async () => {
  const server = createServer(async (request, response) => {
    expect(request.headers.authorization).toBe(`Bearer ${"x".repeat(43)}`);
    expect(request.headers.origin).toBe(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
    if (request.url === "/api/redirect") { response.writeHead(302, { location: "https://example.com" }); response.end(); return; }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    response.writeHead(409, { "content-type": "application/json", "set-cookie": "secret=hidden",
      "content-security-policy": "sandbox allow-scripts; default-src 'none'", "content-disposition": "attachment; filename=doc.html", "x-content-type-options": "nosniff" });
    response.end(JSON.stringify({ code: "STALE_REQUEST", body: Buffer.concat(chunks).toString() }));
  });
  await new Promise<void>(ready => server.listen(0, "127.0.0.1", ready));
  const descriptor = { origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`, token: "x".repeat(43), instanceId: "test", protocolVersion: 2 };
  try {
    const response = await forwardRequest(descriptor, "/api/send", "POST", new TextEncoder().encode('{"text":"你好"}'), "application/json");
    expect(response.status).toBe(409);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(response.headers.get("content-security-policy")).toBe("sandbox allow-scripts; default-src 'none'");
    expect(response.headers.get("content-disposition")).toBe("attachment; filename=doc.html");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.json()).toEqual({ code: "STALE_REQUEST", body: '{"text":"你好"}' });
    await expect(forwardRequest(descriptor, "/api/redirect", "GET")).rejects.toThrow("SERVER_REDIRECT_REJECTED");
  } finally { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
});

test("SSE arrives before the response ends and cancellation releases the server connection", async () => {
  const closed = Promise.withResolvers<void>();
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write('data: {"connected":true}\n\n');
    response.on("close", () => closed.resolve());
  });
  await new Promise<void>(ready => server.listen(0, "127.0.0.1", ready));
  const descriptor = { origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`, token: "x".repeat(43), instanceId: "test", protocolVersion: 2 };
  try {
    const response = await forwardRequest(descriptor, "/api/events", "GET");
    if (!response.body) throw new Error("Missing SSE response body");
    const reader = response.body.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('"connected":true');
    await reader.cancel();
    await Promise.race([closed.promise, Bun.sleep(2000).then(() => { throw new Error("SSE connection leaked"); })]);
  } finally { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
});
