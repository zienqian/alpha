import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { connectApplication, ensureServer, createNativeClient, type ServerDescriptor } from "../src/client";
import { waitFor } from "./helpers";

async function temporary() {
  const root = await mkdtemp(join(tmpdir(), "alphacode-standalone-"));
  return { root, async dispose() {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("alphacode-standalone-")) throw new Error("Unsafe cleanup");
    await rm(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
  } };
}

function launch(root: string, built: boolean, args: string[], extraEnv: Record<string, string | undefined> = {}) {
  const child = Bun.spawn([process.execPath, "--no-env-file", ...(!built ? ["--conditions=alpha-source"] : []),
    resolve(import.meta.dir, built ? "../dist/main.js" : "../src/main.ts"), ...args], {
    cwd: root, env: { ...process.env, ALPHACODE_HOME: join(root, "home"), ALPHACODE_DB: undefined, ...extraEnv },
    stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  return { child, stderr: new Response(child.stderr).text() };
}

async function ready(child: ReturnType<typeof launch>["child"]) {
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([(async () => {
      while (!text.includes("\n")) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error(`Server exited without readiness: ${text}`);
        text += decoder.decode(chunk.value, { stream: true });
      }
    })(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Server readiness timed out")), 20000); })]);
    return { text, event: JSON.parse(text.trim()) as { event: string; origin: string; pid: number; descriptorPath: string; protocolVersion: number } };
  } finally { clearTimeout(timer); reader.releaseLock(); }
}

for (const built of [false, true]) {
  test(`${built ? "built" : "source"} standalone service starts outside the repo and is shared by native clients`, async () => {
    const temporaryFiles = await temporary();
    const { root } = temporaryFiles;
    const databasePath = join(root, "sessions.db");
    const { child, stderr } = launch(root, built, ["--database", databasePath]);
    let chat: Awaited<ReturnType<typeof connectApplication>> | undefined;
    try {
      const { event, text } = await ready(child);
      expect(event).toMatchObject({ event: "ready", protocolVersion: 2, pid: child.pid });
      const descriptor = JSON.parse(await readFile(event.descriptorPath, "utf8")) as ServerDescriptor;
      expect(text).not.toContain(descriptor.token);
      expect((await ensureServer(databasePath)).instanceId).toBe(descriptor.instanceId);
      // The desktop launcher discovers the same server and exits without
      // printing its native bearer token or starting a second supervisor.
      const ensured = launch(root, built, ["--ensure", "--database", databasePath]);
      const ensuredOutput = new Response(ensured.child.stdout).text();
      expect(await ensured.child.exited).toBe(0);
      const ensuredText = await ensuredOutput;
      expect(JSON.parse(ensuredText)).toMatchObject({ event: "ready", pid: descriptor.pid, descriptorPath: event.descriptorPath });
      expect(ensuredText).not.toContain(descriptor.token);
      expect(await ensured.stderr).toBe("");
      const client = createNativeClient(descriptor);
      expect(await client.request("/api/sessions")).toEqual({ sessions: [] });
      chat = await connectApplication({ workspaceRoot: root, databasePath, configDirectory: join(root, "home"),
        modelId: "offline-test", baseURL: "https://offline.invalid/v1", apiKeyEnv: "UNUSED", noAuth: true,
        skills: { sharedDirectories: false, claudeDirectories: false, trustedProjects: [], disabledNames: [] } });
      await waitFor(() => chat?.state.connection === "connected");
      await chat.send("/skills");
      await waitFor(() => Boolean(chat?.state.messages.some(message => message.localResult?.kind === "skills")));
      await chat.close();
      // Detaching a client does not kill the service or materialize an empty session.
      expect(await client.request("/api/info")).toMatchObject({ instanceId: descriptor.instanceId });
      expect(await client.request("/api/sessions")).toEqual({ sessions: [] });
      const duplicate = launch(root, built, ["--database", databasePath]);
      try {
        expect(await duplicate.child.exited).toBe(1);
        expect(await duplicate.stderr).toContain("SERVER_ALREADY_RUNNING");
        expect(await client.request("/api/info")).toMatchObject({ instanceId: descriptor.instanceId });
      } finally { if (duplicate.child.exitCode === null) duplicate.child.kill(); await duplicate.child.exited; }
    } finally {
      await chat?.close();
      if (child.exitCode === null) child.kill();
      await child.exited;
      await stderr;
      await temporaryFiles.dispose();
    }
  }, 30000);
}

test("standalone defaults resolve database paths from config without requiring a model", async () => {
  const temporaryFiles = await temporary();
  const { root } = temporaryFiles;
  const home = join(root, "home");
  await mkdir(home);
  await writeFile(join(home, "config.yaml"), "databasePath: archive/sessions.db\n");
  const { child, stderr } = launch(root, false, []);
  try {
    const { event } = await ready(child);
    const descriptor = JSON.parse(await readFile(event.descriptorPath, "utf8")) as ServerDescriptor;
    const expected = join(home, "archive/sessions.db");
    expect(descriptor.databasePath).toBe(process.platform === "win32" ? expected.toLowerCase() : expected);
  } finally {
    if (child.exitCode === null) child.kill();
    await child.exited; await stderr; await temporaryFiles.dispose();
  }
});

test("standalone help is read-only and invalid flags fail before starting a server", async () => {
  const temporaryFiles = await temporary();
  try {
    for (const args of [["--help"], ["--database"], ["--unknown"]]) {
      const { child, stderr } = launch(temporaryFiles.root, true, args);
      const stdout = new Response(child.stdout).text();
      expect(await child.exited).toBe(args[0] === "--help" ? 0 : 1);
      expect((await stdout) + (await stderr)).toContain("Usage: alphacode-app-server");
      expect(await Bun.file(join(temporaryFiles.root, "home/config.yaml")).exists()).toBe(false);
    }
  } finally { await temporaryFiles.dispose(); }
});
