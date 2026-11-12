import { expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import type { Duplex } from "node:stream";
import { basename, dirname, join, resolve } from "node:path";
import type { AppConfig } from "../src/config";
import type { SkillsSettings } from "../src/global-config";
import { loadRuntimeSkills } from "../src/runtime/skills";
import { createSkillRoutes, installSkillFiles, skillCatalog } from "../src/server/skills";
import { safeSkillPath, skillUploadLimit, unpackSkills } from "../src/server/skill-archive";
import { downloadSkill, publicSkillAddress, skillLink } from "../src/server/skill-download";
import { startServer } from "../src/server/server";
import type { SessionView } from "../src/server/protocol";

const document = (name: string, extra = "") => Buffer.from(`---\nname: ${name}\ndescription: Test ${name}\n${extra}---\nInstructions for ${name}.\n`);

// Stored ZIP fixtures, including intentionally unsafe paths and Unix file types.
function zip(entries: { path: string; bytes: Buffer; mode?: number; size?: number }[]) {
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path), data = entry.bytes;
    let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(entry.size ?? data.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(0x0314, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(entry.size ?? data.length, 24);
    directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38); directory.writeUInt32LE(offset, 42);
    central.push(directory, name); offset += header.length + name.length + data.length;
  }
  const index = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(index.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, index, end]);
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "alphacode-market-"));
  const config: AppConfig & { configDirectory: string; skills: SkillsSettings } = { workspaceRoot: join(root, "workspace"), configDirectory: join(root, "config"), databasePath: join(root, "sessions.db"),
    modelId: "test", baseURL: "https://offline.invalid", apiKeyEnv: "UNUSED", noAuth: true,
    skills: { sharedDirectories: false, claudeDirectories: false, trustedProjects: [], disabledNames: [] } };
  await mkdir(config.workspaceRoot);
  return { root, config, async [Symbol.asyncDispose]() {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("alphacode-market-")) throw new Error("Unsafe fixture cleanup");
    await rm(root, { recursive: true, force: true });
  } };
}

test("catalog includes local and shared skills even when untrusted, disabled or shadowed", async () => {
  await using f = await fixture();
  const roots = [join(f.config.configDirectory, "skills"), join(f.config.workspaceRoot, ".alphacode", "skills"), join(f.config.workspaceRoot, ".agents", "skills")];
  for (const root of roots) { await mkdir(join(root, "market-test"), { recursive: true }); await writeFile(join(root, "market-test", "SKILL.md"), document("market-test")); }
  const first = await skillCatalog(f.config);
  const own = first.skills.filter(skill => skill.name === "market-test");
  expect(own.map(skill => [skill.directoryId, skill.status])).toEqual([["project-local", "untrusted"], ["project-shared", "disabled"], ["user-local", "available"]]);
  const config = { ...f.config, skills: { ...f.config.skills, trustedProjects: [f.config.workspaceRoot], sharedDirectories: true } };
  const trusted = await skillCatalog(config);
  expect(trusted.skills.filter(skill => skill.name === "market-test").map(skill => skill.status)).toEqual(["available", "shadowed", "shadowed"]);
  expect((await skillCatalog({ ...config, skills: { ...config.skills, disabledNames: ["market-test"] } })).skills.filter(skill => skill.name === "market-test").every(skill => skill.status === "disabled")).toBe(true);
});

test("imports a repository ZIP with resources and makes it available to new runtimes", async () => {
  await using f = await fixture();
  const files = await unpackSkills(zip([{ path: "repo-main/skills/review/SKILL.md", bytes: document("review") },
    { path: "repo-main/skills/review/references/checklist.md", bytes: Buffer.from("Checklist") },
    { path: "repo-main/skills/review/scripts/run.sh", bytes: Buffer.from("echo untouched"), mode: 0o100755 },
    { path: "repo-main/README.md", bytes: Buffer.from("not installed") }]));
  const result = await installSkillFiles(f.config, "user-local", files, { folder: "skills/review" });
  expect(result.installed).toEqual(["review"]);
  expect(await readFile(join(result.directory, "review/references/checklist.md"), "utf8")).toBe("Checklist");
  expect(await readdir(result.directory)).toEqual(["review"]);
  expect((await loadRuntimeSkills(f.config, f.config.workspaceRoot)).skills.map(skill => skill.name)).toEqual(["review"]);
});

test("all metadata is validated before publishing; existing skills are not overwritten", async () => {
  await using f = await fixture();
  const first = [{ path: "SKILL.md", bytes: document("review") }];
  await installSkillFiles(f.config, "user-local", first);
  await expect(installSkillFiles(f.config, "user-local", [{ path: "SKILL.md", bytes: document("review", "user-invocable: false\n") }])).rejects.toMatchObject({ code: "SKILL_NAME_CONFLICT" });
  expect(await readFile(join(f.config.configDirectory, "skills/review/SKILL.md"))).toEqual(document("review"));
  await expect(installSkillFiles(f.config, "user-local", [{ path: "good/SKILL.md", bytes: document("good") },
    { path: "bad/SKILL.md", bytes: document("bad", "context: fork\n") }])).rejects.toMatchObject({ code: "SKILL_INVALID_PACKAGE" });
  expect(await readdir(join(f.config.configDirectory, "skills"))).toEqual(["review"]);
});

test("selects skills.sh package names and rejects nested packages, missing metadata and reserved names", async () => {
  await using f = await fixture();
  const result = await installSkillFiles(f.config, "user-local", [{ path: "repo/one/SKILL.md", bytes: document("one") }, { path: "repo/two/SKILL.md", bytes: document("two") },
    { path: "repo/unrelated/SKILL.md", bytes: Buffer.alloc(40000, 120) }], { name: "two" });
  expect(result.installed).toEqual(["two"]);
  for (const files of [[], [{ path: "SKILL.md", bytes: Buffer.from("not a skill") }], [{ path: "SKILL.md", bytes: document("web") }],
    [{ path: "SKILL.md", bytes: document("one") }, { path: "nested/SKILL.md", bytes: document("nested") }]]) {
    await expect(installSkillFiles(f.config, "user-local", files)).rejects.toHaveProperty("status", 400);
  }
  await expect(installSkillFiles(f.config, "project-shared", [{ path: "SKILL.md", bytes: document("three") }])).rejects.toMatchObject({ code: "SKILL_DIRECTORY_DISABLED" });
});

test("ZIP import rejects traversal, aliases, links, huge entries and malformed archives", async () => {
  for (const path of ["../outside", "/absolute", "C:/outside", "x\\file", "x/../file", "aux.txt", "x/file.", "x/file:stream"]) expect(() => safeSkillPath(path)).toThrow();
  for (const entries of [[{ path: "../outside", bytes: document("outside") }],
    [{ path: "link", bytes: Buffer.from("/outside"), mode: 0o120777 }],
    [{ path: "SKILL.md", bytes: document("one") }, { path: "skill.md", bytes: document("one") }],
    [{ path: "huge", bytes: Buffer.from("x"), size: 50 * 1024 * 1024 }]]) await expect(unpackSkills(zip(entries))).rejects.toHaveProperty("status");
  await expect(unpackSkills(Buffer.from("not zip"))).rejects.toMatchObject({ code: "SKILL_INVALID_ARCHIVE" });
  expect(() => unpackSkills(Buffer.alloc(skillUploadLimit + 1))).toThrow();
});

test("skill URLs resolve GitHub folders, repositories, file links and skills.sh", () => {
  expect(skillLink("https://github.com/owner/repo/tree/main/skills/review")).toMatchObject({ folder: "skills/review" });
  expect(skillLink("https://github.com/owner/repo/blob/main/skills/review/SKILL.md").folder).toBe("skills/review");
  expect(skillLink("https://github.com/owner/repo").url.href).toBe("https://codeload.github.com/owner/repo/zip/HEAD");
  expect(skillLink("https://skills.sh/owner/repo/review").name).toBe("review");
  expect(skillLink("https://example.com/skill.zip").url.href).toBe("https://example.com/skill.zip");
  for (const url of ["file:///tmp/SKILL.md", "http://example.com/skill.zip", "https://user:password@example.com/a", "https://example.com:123/a", "not-url"]) expect(() => skillLink(url)).toThrow();
});

test("downloads reject private, reserved and mapped network addresses before connecting", async () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "192.168.1.1", "172.16.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "2001:db8::1"]) expect(publicSkillAddress(ip)).toBe(false);
  expect(publicSkillAddress("8.8.8.8")).toBe(true);
  expect(publicSkillAddress("2606:4700:4700::1111")).toBe(true);
  await expect(downloadSkill(new URL("https://127.0.0.1/skill.zip"), AbortSignal.timeout(1000))).rejects.toMatchObject({ code: "SKILL_UNSAFE_URL" });
});

test("skill downloads use the configured proxy and revalidate redirect destinations", async () => {
  const keys = ["https_proxy", "HTTPS_PROXY", "no_proxy", "NO_PROXY", "npm_config_no_proxy"];
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  const sockets = new Set<Duplex>();
  const connections: string[] = [];
  const proxy = createServer();
  proxy.on("connect", (request, socket) => {
    sockets.add(socket); socket.on("close", () => sockets.delete(socket));
    connections.push(request.url ?? "");
    // A redirect must not cause a second CONNECT into the private network.
    socket.end("HTTP/1.1 302 Found\r\nLocation: https://127.0.0.1/SKILL.md\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
  });
  await new Promise<void>(resolve => proxy.listen(0, "127.0.0.1", resolve));
  const address = proxy.address();
  if (!address || typeof address === "string") throw new Error("Missing proxy address");
  try {
    process.env.https_proxy = process.env.HTTPS_PROXY = `http://127.0.0.1:${address.port}`;
    process.env.no_proxy = process.env.NO_PROXY = process.env.npm_config_no_proxy = "";
    await expect(downloadSkill(new URL("https://8.8.8.8/SKILL.md"), AbortSignal.timeout(3000))).rejects.toMatchObject({ code: "SKILL_UNSAFE_URL" });
    expect(connections).toEqual(["8.8.8.8:443"]);
  } finally {
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => proxy.close(() => resolve()));
  }
});

test("HTTP routes list registered projects without sessions and serialize conflicting installs", async () => {
  await using f = await fixture();
  const route = createSkillRoutes(new Map([["test-project", f.config]]));
  const invoke = (path: string, init?: RequestInit) => { const url = new URL(path, "http://localhost"); return route(new Request(url.href, init), url); };
  const catalog = await (await invoke("/api/skills")).json() as { projects: { id: string; path: string }[] };
  expect(catalog.projects).toEqual([{ id: "test-project", path: f.config.workspaceRoot }]);
  const body = zip([{ path: "SKILL.md", bytes: document("route-test") }]);
  const results = await Promise.allSettled([1, 2].map(() => invoke("/api/skills/install?projectId=test-project&directoryId=user-local", { method: "POST", headers: { "Content-Type": "application/zip" }, body })));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const rejected = results.find(result => result.status === "rejected") as PromiseRejectedResult;
  expect(rejected.reason.code).toBe("SKILL_NAME_CONFLICT");
  await expect(invoke("/api/skills?projectId=unknown")).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  await expect(invoke("/api/skills/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: "https://127.0.0.1/skill.zip" }) })).rejects.toMatchObject({ code: "SKILL_UNSAFE_URL" });
  expect((await lstat(join(f.config.configDirectory, "skills/route-test/SKILL.md"))).isFile()).toBe(true);
});

test("the real server accepts ZIP uploads, protects origins and loads installs only in new sessions", async () => {
  await using f = await fixture();
  const server = await startServer({ databasePath: f.config.databasePath, directory: join(f.root, "server") });
  try {
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${server.token}` };
    const original = await (await fetch(`${server.origin}/api/connect`, { method: "POST", headers, body: JSON.stringify({ config: f.config }), proxy: false })).json() as SessionView;
    expect(original.skills).toHaveLength(0);
    const body = zip([{ path: "review/SKILL.md", bytes: document("review") }, { path: "review/references/large.txt", bytes: Buffer.alloc(300_000, 120) }]);
    const endpoint = `${server.origin}/api/skills/install?projectId=${original.session.projectId}`;
    const forbidden = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/zip", Origin: "https://untrusted.example" }, body, proxy: false });
    expect(forbidden.status).toBe(403);
    const installed = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/zip", Origin: server.origin }, body, proxy: false });
    expect(installed.status).toBe(201);
    const catalog = await (await fetch(`${server.origin}/api/skills`, { proxy: false })).json() as Awaited<ReturnType<typeof skillCatalog>>;
    expect(catalog.skills[0]?.name).toBe("review");
    const next = await (await fetch(`${server.origin}/api/sessions`, { method: "POST", headers, body: JSON.stringify({ projectId: original.session.projectId }), proxy: false })).json() as SessionView;
    expect(next.skills.map(skill => skill.name)).toEqual(["review"]);
    const previous = await (await fetch(`${server.origin}/api/sessions/${original.session.id}`, { proxy: false })).json() as SessionView;
    expect(previous.skills).toHaveLength(0);
  } finally { await server.close(); }
});
