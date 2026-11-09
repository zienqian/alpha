import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { protocolVersion, type SessionView } from "../src/server/protocol";
import { createClient } from "../src/server/transport";
import { ensureServer } from "../src/server/lifecycle";
import { waitFor } from "./helpers";

function running(pid: number) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function cleanup(root: string) {
  if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("alphacode-lifecycle-test-")) throw new Error("Unsafe fixture cleanup");
  for (let attempt = 0; ; attempt++) {
    try { await rm(root, { recursive: true, force: true }); return; }
    catch (error) {
      if (attempt >= 25 || !["EBUSY", "EPERM", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      await Bun.sleep(100);
    }
  }
}

test("concurrent CLI startups share one child; a stale dead owner can be restarted", async () => {
  const root = await mkdtemp(join(tmpdir(), "alphacode-lifecycle-test-"));
  const workspaceRoot = join(root, "workspace");
  await mkdir(workspaceRoot);
  const databasePath = join(root, "sessions.db");
  const owned = new Set<number>();
  try {
    const descriptors = await Promise.all(Array.from({ length: 4 }, async (_value, index) => {
      const descriptor = await ensureServer(process.platform === "win32" && index % 2 ? databasePath.toUpperCase() : databasePath);
      owned.add(descriptor.pid);
      return descriptor;
    }));
    expect(owned.size).toBe(1);
    const server = descriptors[0];
    if (!server) throw new Error("Missing server");
    expect(server.pid).not.toBe(process.pid);
    expect(new Set(descriptors.map(descriptor => descriptor.instanceId)).size).toBe(1);
    expect((await createClient(server).request<{ protocolVersion: number }>("/api/info")).protocolVersion).toBe(protocolVersion);
    const config = { workspaceRoot, databasePath: server.databasePath, configDirectory: join(root, "config"), modelId: "offline-test", baseURL: "https://offline.invalid/v1", apiKeyEnv: "UNUSED", noAuth: true,
      skills: { sharedDirectories: false, claudeDirectories: false, trustedProjects: [], disabledNames: [] } };
    const session = await createClient(server).request<SessionView>("/api/connect", { config });
    expect(session.state.canSend).toBe(true);
    expect((await fetch(server.origin)).status).toBe(404);
    const launch = await createClient(server).request<{ url: string }>("/api/web", { sessionId: session.session.id });
    expect(new URL(launch.url).origin).toBe(server.origin);
    expect(new URL(launch.url).searchParams.get("session")).toBe(session.session.id);
    expect(new URL(launch.url).hash).toBe("");
    expect((await fetch(launch.url)).headers.get("set-cookie")).toBeNull();
    expect(await (await fetch(server.origin)).text()).toContain("AlphaCode");
    process.kill(server.pid, "SIGKILL");
    await waitFor(() => !running(server.pid));
    const replacement = await ensureServer(databasePath);
    owned.add(replacement.pid);
    expect(replacement.instanceId).not.toBe(server.instanceId);
    const resumed = await createClient(replacement).request<SessionView>("/api/connect", { config, credential: undefined });
    expect(resumed.session.id).not.toBe(session.session.id);
    const restored = await createClient(replacement).request<SessionView>(`/api/sessions/${session.session.id}`);
    expect(restored.state.canSend).toBe(true);
  } finally {
    for (const pid of owned) if (running(pid)) process.kill(pid, "SIGKILL");
    await waitFor(() => [...owned].every(pid => !running(pid)));
    await cleanup(root);
  }
}, 60000);
