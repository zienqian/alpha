import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createBackend, parseDescriptor } from "../src/backend";

const runtime = process.env.ALPHACODE_APP_TEST_RUNTIME;
async function cleanup(root: string) {
  if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("alphacode-app-package-test-")) throw new Error("Unsafe cleanup");
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
test.skipIf(!runtime)("packaged Bun starts outside the repository and serves sessions, Skills, Trace and SSE", async () => {
  if (!runtime) return;
  const root = await mkdtemp(join(tmpdir(), "alphacode-app-package-test-"));
  const bun = join(runtime, "bin", process.platform === "win32" ? "bun.exe" : "bun");
  const child = Bun.spawn([bun, "--no-env-file", "--conditions=alpha-source", join(runtime, "apps/alphacode-app-server/src/main.ts"), "--database", join(root, "sessions.db")], {
    cwd: root, env: { ...process.env, ALPHACODE_HOME: join(root, "home"), ALPHACODE_DB: undefined },
    stdout: "pipe", stderr: "pipe", windowsHide: true,
  });
  const stderr = new Response(child.stderr).text();
  try {
    const output = child.stdout.getReader();
    let line = "";
    const decoder = new TextDecoder();
    while (!line.includes("\n")) {
      const next = await output.read();
      if (next.done) throw new Error(`Packaged server exited: ${await stderr}`);
      line += decoder.decode(next.value, { stream: true });
    }
    output.releaseLock();
    const event = JSON.parse(line.trim()) as { descriptorPath: string };
    const raw = JSON.parse(await readFile(event.descriptorPath, "utf8"));
    const descriptor = parseDescriptor(raw);
    expect(line).not.toContain(descriptor.token);
    const backend = createBackend({ root: runtime, bun, database: join(root, "sessions.db") });
    expect((await backend.connect()).instanceId).toBe(descriptor.instanceId);
    const request = (path: string, body?: object) => backend.forward(new Request(`alphacode-app://app${path}`, {
      method: body ? "POST" : "GET", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined,
    }));
    expect(await (await request("/api/sessions")).json()).toEqual({ sessions: [] });
    const connected = await request("/api/connect", { config: {
      workspaceRoot: root, databasePath: raw.databasePath, configDirectory: join(root, "home"),
      modelId: "offline-test", baseURL: "https://offline.invalid/v1", apiKeyEnv: "UNUSED", noAuth: true,
      skills: { sharedDirectories: false, claudeDirectories: false, trustedProjects: [], disabledNames: [] },
    } });
    expect(connected.status).toBe(200);
    const { session } = await connected.json() as { session: { id: string; projectId: string } };
    expect((await request(`/api/skills?projectId=${session.projectId}`)).status).toBe(200);
    expect((await request(`/api/sessions/${session.id}/traces`)).status).toBe(200);
    expect((await request(`/api/sessions/${session.id}/requests`, { requestId: "packaged-offline-skills", input: "/skills" })).ok).toBe(true);
    const response = await request(`/api/sessions/${session.id}/events`);
    if (!response.body) throw new Error("Missing SSE stream");
    const reader = response.body.getReader();
    let text = "";
    try {
      while (!text.includes('"localResult":{"kind":"skills"')) {
        const next = await reader.read();
        if (next.done) throw new Error("SSE closed before local command completed");
        text += decoder.decode(next.value, { stream: true });
      }
    } finally { await reader.cancel(); }
    expect(text).toContain('"kind":"skills"');
  } finally {
    child.kill(); await child.exited; await stderr;
    await cleanup(root);
  }
}, 30000);
