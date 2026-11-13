import { expect, test } from "bun:test";
import { chmod, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sync as spawnSync } from "cross-spawn";
import { createBackend, parseDescriptor } from "../src/backend";
import { cliBridge, cliCommandName } from "../src/cli-command";
import { installCliCommand } from "../src/install-cli";

const runtime = process.env.ALPHACODE_APP_TEST_RUNTIME;
async function temporaryDirectory() {
  // macOS exposes /var through /private/var. Bun resolves imported modules to
  // their real paths, so fixture paths and child working directories must agree.
  return mkdtemp(join(await realpath(tmpdir()), "alphacode-app-package-test-"));
}

async function cleanup(root: string) {
  if (dirname(resolve(root)) !== await realpath(tmpdir()) || !basename(root).startsWith("alphacode-app-package-test-")) throw new Error("Unsafe cleanup");
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
test.skipIf(!runtime)("packaged Bun starts outside the repository and serves sessions, Skills, Trace and SSE", async () => {
  if (!runtime) return;
  const root = await temporaryDirectory();
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

test.skipIf(!runtime)("relocated App CLI works without global Bun and delegates to a later user installation", async () => {
  if (!runtime) return;
  const root = await temporaryDirectory();
  try {
    const moved = join(root, "moved runtime with spaces");
    await cp(runtime, moved, { recursive: true });
    const work = join(root, "user project");
    await mkdir(work);
    // A project .env must not silently reconfigure a packaged CLI.
    await writeFile(join(work, ".env"), "ALPHACODE_LANG=invalid\n");
    const systemPath = process.platform === "win32" ? join(process.env.SystemRoot || "C:\\Windows", "System32") : "/usr/bin:/bin";
    const env: NodeJS.ProcessEnv = { ...process.env, ALPHACODE_HOME: join(root, "home"),
      ALPHACODE_LANG: undefined, ALPHACODE_DB: undefined };
    for (const key of Object.keys(env)) if (key.toUpperCase() === "PATH") delete env[key];
    env.PATH = systemPath;
    const bundled = join(moved, "cli", cliCommandName);
    for (const args of [["--help"], ["--version"]]) {
      const result = spawnSync(bundled, args, { cwd: work, env, encoding: "utf8", timeout: 15000 });
      expect(result.error).toBeFalsy();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.toLowerCase()).toContain("alphacode");
      if (args[0] === "--version" && process.env.ALPHACODE_RELEASE_VERSION) {
        expect(result.stdout.trim()).toBe(`alphacode ${process.env.ALPHACODE_RELEASE_VERSION}`);
      }
    }
    // The materialized workspace copy must locate the canonical server/Web paths.
    const revision = pathToFileURL(join(moved, "node_modules/@alpha/alphacode-app-server/src/server/revision.ts")).href;
    const layout = spawnSync(join(moved, "bin", process.platform === "win32" ? "bun.exe" : "bun"),
      ["--no-env-file", "--conditions=alpha-source", "-e", `const {serverLayout} = await import(${JSON.stringify(revision)}); console.log(JSON.stringify(await serverLayout()));`],
      { cwd: work, env, encoding: "utf8", timeout: 15000 });
    expect(layout.status, layout.stderr).toBe(0);
    expect(JSON.parse(layout.stdout).root).toBe(moved);

    const installed = await installCliCommand({ root: moved, home: join(root, "home"), env,
      registerPath: async () => { /* Never edit the test machine's user PATH. */ } });
    const result = spawnSync(installed.command, ["--version"], { cwd: work, env, encoding: "utf8", timeout: 15000 });
    expect(result.status, result.stderr).toBe(0);
    const userBin = join(root, "separate user CLI");
    await mkdir(userBin);
    const userCommand = join(userBin, cliCommandName);
    await writeFile(userCommand, process.platform === "win32"
      ? '@echo off\r\necho USER_CLI\r\necho "%CD%"\r\necho "%~1"\r\nexit /b 23\r\n'
      : '#!/bin/sh\nprintf "USER_CLI\\n%s\\n%s\\n" "$PWD" "$1"\nexit 23\n');
    await chmod(userCommand, 0o755);
    // Even if the App bridge appears first in PATH, a separately installed CLI wins.
    const priorityEnv = { ...env, PATH: [dirname(installed.command), userBin, systemPath].join(delimiter) };
    const delegated = spawnSync(installed.command, ["argument with spaces & symbols"], { cwd: work, env: priorityEnv, encoding: "utf8", timeout: 15000 });
    expect(delegated.status, delegated.stderr).toBe(23);
    expect(delegated.stdout).toContain("USER_CLI");
    expect(delegated.stdout).toContain(work);
    expect(delegated.stdout).toContain("argument with spaces & symbols");
    expect(await readFile(bundled, "utf8")).toBe(cliBridge());
  } finally { await cleanup(root); }
}, 60000);
