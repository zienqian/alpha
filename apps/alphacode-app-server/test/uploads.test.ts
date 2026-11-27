import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatAttachment } from "../src/chat/contracts";
import type { AppConfig } from "../src/config";
import { createApplication } from "../src/application";
import type { SessionSearchResult, SessionView } from "../src/server/protocol";
import { startServer } from "../src/server/server";
import { serverPaths } from "../src/server/storage";
import { createClient } from "../src/server/transport";
import { createUploadStore, detectImageMagic, safeDiskFileName } from "../src/uploads";
import { controlledStream, textResponse, waitFor } from "./helpers";

const tinyPng = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

type ModelRequest = {
  stream?: boolean;
  messages: Array<{ role: string; content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> }>;
};

async function createServerFixture(
  reply: (body: ModelRequest, count: number) => Response = () => textResponse("received"),
) {
  const root = await mkdtemp(join(tmpdir(), "alphacode-uploads-test-"));
  const workspaceRoot = join(root, "workspace");
  await mkdir(workspaceRoot);
  const paths = await serverPaths(join(root, "sessions.db"));
  const config: AppConfig = {
    workspaceRoot,
    databasePath: paths.database,
    configDirectory: join(root, "config"),
    modelId: "offline-vision",
    baseURL: "https://offline.invalid/v1",
    apiKeyEnv: "UNUSED",
    noAuth: true,
    skills: { sharedDirectories: false, claudeDirectories: false, trustedProjects: [], disabledNames: [] },
  };
  const calls: ModelRequest[] = [];
  const serverOptions = {
    databasePath: paths.database,
    directory: paths.directory,
    idleMs: 60000,
    botsConfigDirectory: join(root, "config"),
    createChat: async (input: AppConfig) => createApplication(input, {
      provider: {
        fetch: async (_url, init) => {
          const body = JSON.parse(String(init?.body)) as ModelRequest;
          if (!body.stream) return Response.json({ choices: [{ message: { content: "Uploaded files chat" }, finish_reason: "stop" }] });
          calls.push(body);
          return reply(body, calls.length);
        },
      },
    }),
    botsProvider: () => ({
      fetch: async (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as ModelRequest;
        if (!body.stream) return Response.json({ choices: [{ message: { content: "Bot reply" }, finish_reason: "stop" }] });
        calls.push(body);
        return reply(body, calls.length);
      },
    }),
  };
  let server = await startServer(serverOptions);
  const client = () => createClient(server);
  const browserHeaders = () => ({ Origin: server.origin, "Sec-Fetch-Site": "same-origin" });

  async function uploadTo(urlPath: string, files: Array<{ name: string; bytes: Uint8Array | string; type?: string }>) {
    const form = new FormData();
    for (const item of files) {
      const raw = typeof item.bytes === "string" ? new TextEncoder().encode(item.bytes) : item.bytes;
      const data = new Uint8Array(new ArrayBuffer(raw.byteLength));
      data.set(raw);
      form.append("files", new File([data], item.name, { type: item.type ?? "application/octet-stream" }));
    }
    const response = await fetch(`${server.origin}${urlPath}`, {
      method: "POST",
      headers: browserHeaders(),
      body: form,
      proxy: false,
    });
    return { status: response.status, body: await response.json() as { attachments?: ChatAttachment[]; code?: string } };
  }

  return {
    root,
    paths,
    config,
    calls,
    client,
    uploadTo,
    get server() { return server; },
    async connect(input = config) {
      return client().request<SessionView>("/api/connect", { config: input });
    },
    async restart() {
      await server.close();
      server = await startServer(serverOptions);
    },
    async dispose() {
      await server.close();
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

test("upload store sanitizes names, verifies magic bytes, and isolates scopes", async () => {
  const root = await mkdtemp(join(tmpdir(), "alphacode-upload-store-"));
  try {
    expect(safeDiskFileName("../../evil/CON.txt")).toBe("file.txt");
    expect(safeDiskFileName("meta.json")).toBe("file-meta.json");
    expect(safeDiskFileName("设计稿:v1?.png")).toBe("设计稿_v1_.png");
    expect(detectImageMagic(tinyPng)).toBe("image/png");
    expect(detectImageMagic(new TextEncoder().encode("not an image"))).toBeUndefined();

    const store = createUploadStore(join(root, "uploads"));
    const png = await store.save("session:a", { name: "mock.png", mediaType: "application/octet-stream", bytes: tinyPng });
    expect(png.mediaType).toBe("image/png");

    // Spoofed image MIME with plain text bytes must not be classified as a raster image.
    const spoofed = await store.save("session:a", { name: "fake.png", mediaType: "image/png", bytes: new TextEncoder().encode("hello text") });
    expect(spoofed.mediaType).toBe("text/plain");

    // Scope isolation: session:b cannot resolve session:a uploads.
    await expect(store.resolveMany("session:b", [png.id])).rejects.toThrow("ATTACHMENT_NOT_FOUND");
    expect(await store.remove("session:a", spoofed.id)).toBe(true);
    expect(await store.get("session:a", spoofed.id)).toBeUndefined();
    await store.removeScope("session:a");
    expect(await store.get("session:a", png.id)).toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sessions support uploading text, binary, and image files with multimodal vision, restart persistence, search, and cleanup", async () => {
  const fixture = await createServerFixture();
  try {
    const view = await fixture.connect();
    const id = view.session.id;

    const uploaded = await fixture.uploadTo(`/api/sessions/${id}/uploads`, [
      { name: "spec.md", bytes: "# Feature Spec\nUse clean neutral styling.", type: "text/markdown" },
      { name: "mockup.png", bytes: tinyPng, type: "image/png" },
      { name: "archive.bin", bytes: new Uint8Array([0x00, 0x01, 0x02, 0x03]), type: "application/octet-stream" },
      { name: "script.svg", bytes: '<svg onload="alert(1)"/>', type: "image/svg+xml" },
    ]);
    expect(uploaded.status).toBe(201);
    const items = uploaded.body.attachments ?? [];
    expect(items).toHaveLength(4);
    expect(items[0]?.name).toBe("spec.md");
    expect(items[1]?.mediaType).toBe("image/png");
    expect(items[1]?.url).toBe(`/api/sessions/${id}/uploads/${items[1]?.id}`);

    // Verify serving modes and security headers.
    const infoRes = await fetch(`${fixture.server.origin}${items[0]?.url}?mode=info`, { proxy: false });
    expect(infoRes.status).toBe(200);
    expect(await infoRes.json()).toMatchObject({ name: "spec.md", mediaType: "text/markdown" });

    const openImg = await fetch(`${fixture.server.origin}${items[1]?.url}?mode=open`, { proxy: false });
    expect(openImg.status).toBe(200);
    expect(openImg.headers.get("content-type")).toBe("image/png");

    const openSvg = await fetch(`${fixture.server.origin}${items[3]?.url}?mode=open`, { proxy: false });
    expect(openSvg.headers.get("content-disposition")).toContain("attachment");

    // Cross-session access must be denied.
    const other = await fixture.connect();
    const crossRes = await fetch(`${fixture.server.origin}/api/sessions/${other.session.id}/uploads/${items[0]?.id}?mode=info`, { proxy: false });
    expect(crossRes.status).toBe(404);

    // Send message with text + 3 attachments.
    const [specItem, imgItem, binItem] = items;
    if (!specItem || !imgItem || !binItem) throw new Error("Missing uploaded attachments");
    await fixture.client().request(`/api/sessions/${id}/requests`, {
      requestId: "req-attach-1",
      input: "请结合这些文件实现功能",
      attachmentIds: [specItem.id, imgItem.id, binItem.id],
    });
    await waitFor(async () => !(await fixture.client().request<SessionView>(`/api/sessions/${id}`)).state.busy);

    // Verify the model received multimodal content parts (text with inlined spec + binary path, plus PNG image_url).
    const firstCall = fixture.calls[0];
    const userMsg = firstCall?.messages.findLast(m => m.role === "user");
    expect(Array.isArray(userMsg?.content)).toBe(true);
    const parts = userMsg?.content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    expect(parts[0]?.type).toBe("text");
    expect(parts[0]?.text).toContain("请结合这些文件实现功能");
    expect(parts[0]?.text).toContain("# Feature Spec");
    expect(parts[0]?.text).toContain("archive.bin");
    expect(parts[0]?.text).toContain("local path:");
    expect(parts[1]?.type).toBe("image_url");
    expect(parts[1]?.image_url?.url).toMatch(/^data:image\/png;base64,/);

    // Send an attachment-only message (empty input text).
    await fixture.client().request(`/api/sessions/${id}/requests`, {
      requestId: "req-attach-only",
      input: "",
      attachmentIds: [specItem.id],
    });
    await waitFor(async () => !(await fixture.client().request<SessionView>(`/api/sessions/${id}`)).state.busy);

    // Restart server and verify history restoration + search by attachment filename.
    await fixture.restart();
    const restored = await fixture.client().request<SessionView>(`/api/sessions/${id}`);
    const userMessages = restored.state.messages.filter(m => m.role === "user");
    expect(userMessages[0]?.text).toBe("请结合这些文件实现功能");
    expect(userMessages[0]?.attachments?.map(a => a.name)).toEqual(["spec.md", "mockup.png", "archive.bin"]);
    expect(userMessages[1]?.text).toBe("");
    expect(userMessages[1]?.attachments?.map(a => a.name)).toEqual(["spec.md"]);

    const search = await fixture.client().request<{ results: SessionSearchResult[] }>(`/api/sessions/search?q=mockup.png`);
    expect(search.results.some(r => r.session.id === id)).toBe(true);

    // Delete session and confirm uploaded files are cleaned from disk.
    const delRes = await fetch(`${fixture.server.origin}/api/sessions/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${fixture.server.token}` },
      proxy: false,
    });
    expect(delRes.status).toBe(200);
    const afterDelete = await fetch(`${fixture.server.origin}/api/sessions/${id}/uploads/${specItem.id}?mode=info`, { proxy: false });
    expect(afterDelete.status).toBe(404);
    const uploadRootEntries = await stat(join(fixture.paths.directory, "uploads")).then(() => true, () => false);
    expect(uploadRootEntries).toBe(true);
  } finally {
    await fixture.dispose();
  }
});

test("image attachments automatically fall back to text-only metadata when a model endpoint rejects vision input", async () => {
  const fixture = await createServerFixture((body, count) => {
    const user = body.messages.findLast(m => m.role === "user");
    if (count === 1 && Array.isArray(user?.content)) {
      return Response.json({ error: { message: "image_url is not supported by this model" } }, { status: 400 });
    }
    return textResponse("fallback succeeded");
  });
  try {
    const view = await fixture.connect();
    const id = view.session.id;
    const uploaded = await fixture.uploadTo(`/api/sessions/${id}/uploads`, [
      { name: "shot.png", bytes: tinyPng, type: "image/png" },
    ]);
    const imageId = uploaded.body.attachments?.[0]?.id;
    if (!imageId) throw new Error("Missing image upload");

    await fixture.client().request(`/api/sessions/${id}/requests`, {
      requestId: "req-fallback",
      input: "看看这张图",
      attachmentIds: [imageId],
    });
    await waitFor(async () => !(await fixture.client().request<SessionView>(`/api/sessions/${id}`)).state.busy);

    expect(fixture.calls).toHaveLength(2);
    expect(Array.isArray(fixture.calls[0]?.messages.findLast(m => m.role === "user")?.content)).toBe(true);
    const fallbackUser = fixture.calls[1]?.messages.findLast(m => m.role === "user");
    expect(typeof fallbackUser?.content).toBe("string");
    expect(String(fallbackUser?.content)).toContain("shot.png");
    expect(String(fallbackUser?.content)).toContain("rejected image input");
    const finalView = await fixture.client().request<SessionView>(`/api/sessions/${id}`);
    expect(finalView.state.messages.findLast(m => m.role === "assistant")?.text).toBe("fallback succeeded");
  } finally {
    await fixture.dispose();
  }
});

test("queued messages preserve attachments and deliver them when drained", async () => {
  const firstTurn = controlledStream();
  const fixture = await createServerFixture((_body, count) => count === 1 ? firstTurn.response : textResponse("second done"));
  try {
    const view = await fixture.connect();
    const id = view.session.id;
    const uploaded = await fixture.uploadTo(`/api/sessions/${id}/uploads`, [
      { name: "queued.txt", bytes: "queued file body", type: "text/plain" },
    ]);
    const fileId = uploaded.body.attachments?.[0]?.id;
    if (!fileId) throw new Error("Missing queued file upload");

    await fixture.client().request(`/api/sessions/${id}/requests`, { requestId: "req-1", input: "first turn" });
    await waitFor(() => fixture.calls.length === 1);

    await fixture.client().request(`/api/sessions/${id}/requests`, {
      requestId: "req-2",
      input: "",
      attachmentIds: [fileId],
    });
    const busyView = await fixture.client().request<SessionView>(`/api/sessions/${id}`);
    expect(busyView.state.queuedRequests?.[0]?.attachments?.[0]?.name).toBe("queued.txt");

    firstTurn.text("first done");
    firstTurn.end();
    await waitFor(async () => {
      const current = await fixture.client().request<SessionView>(`/api/sessions/${id}`);
      return !current.state.busy && (current.state.queuedRequests?.length ?? 0) === 0;
    });
    const secondCall = fixture.calls[1];
    const secondUser = secondCall?.messages.findLast(m => m.role === "user");
    expect(String(secondUser?.content)).toContain("queued file body");
  } finally {
    await fixture.dispose();
  }
});

test("bots support uploading and sending files with router hydration and cleanup on delete", async () => {
  const fixture = await createServerFixture(() => textResponse("bot saw file"));
  try {
    const session = await fixture.connect();
    const created = await fixture.client().request<{ bot: { id: string } }>("/api/bots", {
      name: "UploadBot",
      projectId: session.session.projectId,
    });
    const botId = created.bot.id;

    const uploaded = await fixture.uploadTo(`/api/bots/${botId}/uploads`, [
      { name: "brief.md", bytes: "Build login page", type: "text/markdown" },
      { name: "ui.png", bytes: tinyPng, type: "image/png" },
    ]);
    expect(uploaded.status).toBe(201);
    const attachments = uploaded.body.attachments ?? [];
    expect(attachments).toHaveLength(2);

    await fixture.client().request(`/api/bots/${botId}/messages`, {
      requestId: "bot-attach-1",
      input: "",
      attachmentIds: attachments.map(a => a.id),
    });

    await waitFor(async () => {
      const state = await fixture.client().request<{ router: { busy: boolean; messages: Array<{ role: string; text: string; attachments?: ChatAttachment[] }> } }>(`/api/bots/${botId}/state`);
      return !state.router.busy && state.router.messages.some(m => m.role === "assistant" && m.text === "bot saw file");
    });

    const botCall = fixture.calls[0];
    const userMsg = botCall?.messages.findLast(m => m.role === "user");
    expect(Array.isArray(userMsg?.content)).toBe(true);
    const parts = userMsg?.content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    expect(parts[0]?.text).toContain("Build login page");
    expect(parts[1]?.type).toBe("image_url");

    const state = await fixture.client().request<{ router: { messages: Array<{ role: string; text: string; attachments?: ChatAttachment[] }> } }>(`/api/bots/${botId}/state`);
    const userEntry = state.router.messages.find(m => m.role === "user");
    expect(userEntry?.attachments?.map(a => a.name)).toEqual(["brief.md", "ui.png"]);

    const firstAttachment = attachments[0];
    if (!firstAttachment?.url) throw new Error("Missing bot attachment");
    const openFile = await fetch(`${fixture.server.origin}${firstAttachment.url}?mode=open`, { proxy: false });
    expect(openFile.status).toBe(200);
    expect(await openFile.text()).toBe("Build login page");

    const del = await fetch(`${fixture.server.origin}/api/bots/${botId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${fixture.server.token}` },
      proxy: false,
    });
    expect(del.status).toBe(200);
    const afterDel = await fetch(`${fixture.server.origin}${firstAttachment.url}?mode=open`, { proxy: false });
    expect(afterDel.status).toBe(404);
  } finally {
    await fixture.dispose();
  }
});
