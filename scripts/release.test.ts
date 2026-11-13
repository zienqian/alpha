import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { affectsRelease, assetNames, checkAssets, command, createVersionCommit, manifests, nextVersion,
  planRelease, prepareVersion, publishAssets, pushVersion } from "./release";

const roots: string[] = [];
const originalRepository = process.env.GITHUB_REPOSITORY;
afterEach(async () => {
  if (originalRepository === undefined) delete process.env.GITHUB_REPOSITORY;
  else process.env.GITHUB_REPOSITORY = originalRepository;
  const parent = await realpath(tmpdir());
  for (const root of roots.splice(0)) {
    if (dirname(root) !== parent || !basename(root).startsWith("alpha-release-test-")) throw new Error("Unsafe test cleanup");
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

async function put(root: string, path: string, content: string) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}

function git(root: string, ...args: string[]) { return command(["git", ...args], root); }
function commit(root: string) { git(root, "add", "."); git(root, "commit", "-qm", "change"); }

async function fixture(version = "0.1.0") {
  const root = await mkdtemp(join(await realpath(tmpdir()), "alpha-release-test-"));
  roots.push(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Release Test");
  git(root, "config", "user.email", "release@example.invalid");
  git(root, "config", "commit.gpgsign", "false");
  git(root, "config", "core.autocrlf", "false");
  await put(root, ".gitignore", "dist/\nremote.git/\n");
  for (const path of manifests) await put(root, path, `${JSON.stringify({ name: path.split("/")[1], version }, null, 2)}\n`);
  await put(root, "bun.lock", `{
  "lockfileVersion": 2,
  "workspaces": {
    "apps/alphacode": {
      "name": "@alpha/alphacode",
      "version": "${version}",
    },
    "apps/alphacode-app": {
      "name": "@alpha/alphacode-app",
      "version": "${version}",
    },
  },
  "packages": { "unchanged": "keep-this-resolution" },
}
`);
  await put(root, "apps/alphacode/src/main.ts", "initial\n");
  await mkdir(join(root, "dist"));
  commit(root);
  return root;
}

async function remote(root: string) {
  git(root, "init", "--bare", "-q", "remote.git");
  git(root, "remote", "add", "origin", join(root, "remote.git"));
  git(root, "push", "-q", "origin", "HEAD:refs/heads/main");
}

test("release scope includes runtime, dependencies and packaging but excludes docs and tests", () => {
  for (const path of ["apps/alphacode/src/main.ts", "apps/alphacode-app/scripts/package.ts", "apps/alphacode-web/src/app.tsx",
    "apps/alphacode-app-server/src/main.ts", "packages/provider/src/index.ts", "bun.lock", ".bun-version", "package.json",
    ".github/workflows/ci.yml", "scripts/release.ts", "packages/coding-agent/THIRD_PARTY_NOTICES.md"]) expect(affectsRelease(path), path).toBe(true);
  for (const path of ["README.md", "apps/alphacode-app/README.md", "apps/alphacode/test/config.test.ts", "scripts/release.test.ts",
    "packages/adk/src/core.test.ts", "packages/adk/examples/offline.ts", "apps/example-agent/src/main.ts"]) expect(affectsRelease(path), path).toBe(false);
});

test("version policy starts at 0.1.0, increments patch and respects a deliberate larger version", () => {
  expect(nextVersion("0.0.0")).toBe("0.1.0");
  expect(nextVersion("0.1.9", "0.1.9")).toBe("0.1.10");
  expect(nextVersion("0.0.0", "0.2.0")).toBe("0.2.1");
  expect(nextVersion("1.0.0", "0.2.0")).toBe("1.0.0");
  expect(() => nextVersion("1.2.3-beta.1")).toThrow();
  expect(() => nextVersion("01.2.3")).toThrow();
});

test("initial history releases, then documentation/test-only commits skip", async () => {
  const root = await fixture("0.0.0");
  expect(await planRelease(root)).toMatchObject({ needed: true, version: "0.1.0" });
  await prepareVersion("0.1.0", root);
  commit(root);
  git(root, "tag", "v0.1.0");
  await put(root, "apps/alphacode/README.md", "documentation\n");
  await put(root, "apps/alphacode/test/new.test.ts", "test\n");
  commit(root);
  expect(await planRelease(root)).toMatchObject({ needed: false, version: "0.1.0", previous: "v0.1.0" });
});

test("diff includes renamed/deleted product files and shared dependency changes", async () => {
  const root = await fixture();
  git(root, "tag", "v0.1.0");
  git(root, "mv", "apps/alphacode/src/main.ts", "apps/alphacode/src/renamed.ts");
  await put(root, "packages/provider/src/index.ts", "shared runtime change\n");
  commit(root);
  const plan = await planRelease(root);
  expect(plan.version).toBe("0.1.1");
  expect(plan.changed).toContain("apps/alphacode/src/main.ts");
  expect(plan.changed).toContain("apps/alphacode/src/renamed.ts");
  expect(plan.changed).toContain("packages/provider/src/index.ts");
});

test("baseline uses numeric stable versions reachable from this commit", async () => {
  const root = await fixture();
  git(root, "tag", "v0.1.9");
  git(root, "tag", "v0.1.10");
  git(root, "tag", "v5.0.0-beta.1");
  git(root, "checkout", "-qb", "future");
  await put(root, "apps/alphacode/src/future.ts", "future\n");
  commit(root);
  git(root, "tag", "v99.0.0");
  git(root, "checkout", "-q", "main");
  await put(root, "apps/alphacode/src/main.ts", "current\n");
  commit(root);
  expect(await planRelease(root)).toMatchObject({ needed: true, version: "0.1.11", previous: "v0.1.10" });
});

test("prepare updates both manifests and only their lockfile versions", async () => {
  const root = await fixture();
  const before = await readFile(join(root, "bun.lock"), "utf8");
  await prepareVersion("0.1.1", root);
  for (const path of manifests) expect(JSON.parse(await readFile(join(root, path), "utf8")).version).toBe("0.1.1");
  expect(await readFile(join(root, "bun.lock"), "utf8")).toBe(before.replaceAll('"version": "0.1.0"', '"version": "0.1.1"'));
});

test("unexpected lockfile structure fails before modifying manifests", async () => {
  const root = await fixture();
  await put(root, "bun.lock", "{}");
  await expect(prepareVersion("0.1.1", root)).rejects.toThrow("lockfile workspace version");
  expect(JSON.parse(await readFile(join(root, manifests[0]), "utf8")).version).toBe("0.1.0");
});

test("version commit and tag push atomically and the same source can resume after upload failure", async () => {
  const root = await fixture();
  await remote(root);
  const first = await createVersionCommit("0.1.1", root);
  expect(pushVersion(first, root)).toBe(true);
  expect(git(root, "ls-remote", "origin", "refs/heads/main").split(/\s/)[0]).toBe(first.commit);
  expect(git(root, "ls-remote", "origin", "refs/tags/v0.1.1").split(/\s/)[0]).toBe(first.commit);
  git(root, "checkout", "-q", "--detach", first.source);
  const retry = await createVersionCommit("0.1.1", root);
  expect(retry.commit).toBe(first.commit);
  expect(pushVersion(retry, root)).toBe(true);
});

test("a newer main commit prevents a stale build from writing a version or tag", async () => {
  const root = await fixture();
  await remote(root);
  const source = git(root, "rev-parse", "HEAD");
  await put(root, "apps/alphacode/src/main.ts", "newer\n");
  commit(root);
  git(root, "push", "-q", "origin", "HEAD:refs/heads/main");
  const newer = git(root, "rev-parse", "HEAD");
  git(root, "checkout", "-q", "--detach", source);
  expect(pushVersion(await createVersionCommit("0.1.1", root), root)).toBe(false);
  expect(git(root, "ls-remote", "origin", "refs/heads/main").split(/\s/)[0]).toBe(newer);
  expect(git(root, "ls-remote", "origin", "refs/tags/v0.1.1")).toBe("");
});

test("an existing tag at different source is never replaced", async () => {
  const root = await fixture();
  await remote(root);
  git(root, "tag", "v0.1.1");
  git(root, "push", "-q", "origin", "refs/tags/v0.1.1");
  const release = await createVersionCommit("0.1.1", root);
  expect(() => pushVersion(release, root)).toThrow("Refusing to replace");
});

test("publication requires every platform asset and produces checksums", async () => {
  const root = await fixture();
  const directory = join(root, "dist");
  await expect(checkAssets(directory)).rejects.toThrow("all four targets");
  for (const name of assetNames) await put(root, `dist/${name}`, "test archive");
  expect(await checkAssets(directory)).toHaveLength(9);
  expect((await readFile(join(directory, "SHA256SUMS"), "utf8")).trim().split("\n")).toHaveLength(8);
  await put(root, `dist/${assetNames[0]}`, "");
  await expect(checkAssets(directory)).rejects.toThrow("Empty or invalid");
});

test("failed upload leaves a draft and retry uploads before publishing", async () => {
  const root = await fixture();
  process.env.GITHUB_REPOSITORY = "example/alpha";
  const calls: string[][] = [];
  await expect(publishAssets("0.1.1", ["archive"], "v0.1.0", root, args => {
    calls.push(args);
    if (args[1] === "api") return "";
    if (args[2] === "upload") throw new Error("network interruption");
    return "";
  })).rejects.toThrow("network interruption");
  expect(calls.some(args => args[2] === "create" && args.includes("--draft"))).toBe(true);
  expect(calls.some(args => args[2] === "edit")).toBe(false);
  calls.length = 0;
  await publishAssets("0.1.1", ["archive"], "v0.1.0", root, args => {
    calls.push(args);
    return args[1] === "api" ? JSON.stringify({ tag_name: "v0.1.1", draft: true }) : "";
  });
  expect(calls.map(args => args[2])).toEqual(["repos/example/alpha/releases?per_page=100", "upload", "edit"]);
});

test("published releases are immutable and an older retry cannot replace Latest", async () => {
  const root = await fixture();
  process.env.GITHUB_REPOSITORY = "example/alpha";
  const calls: string[][] = [];
  const url = "https://github.com/example/alpha/releases/tag/v0.1.1";
  expect(await publishAssets("0.1.1", [], undefined, root, args => {
    calls.push(args);
    return JSON.stringify({ tag_name: "v0.1.1", draft: false, html_url: url });
  })).toBe(url);
  expect(calls).toHaveLength(1);
  calls.length = 0;
  await publishAssets("0.1.1", ["archive"], undefined, root, args => {
    calls.push(args);
    return args[1] === "api" ? JSON.stringify({ tag_name: "v0.2.0", draft: false, prerelease: false }) : "";
  });
  expect(calls.at(-1)).toContain("--latest=false");
});
