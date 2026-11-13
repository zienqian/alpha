import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const manifests = ["apps/alphacode/package.json", "apps/alphacode-app/package.json"];
export const versionFiles = [...manifests, "bun.lock"];
export const targets = ["linux-x64", "win32-x64", "darwin-x64", "darwin-arm64"];
export const assetNames = targets.flatMap(target => ["cli", "app"].map(kind => `alphacode-${kind}-${target}.tar.gz`)).sort();
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parts(version: string) {
  if (!stableVersion.test(version)) throw new Error(`Expected a stable major.minor.patch version: ${version}`);
  const numbers = version.split(".").map(Number);
  if (numbers.some(number => !Number.isSafeInteger(number))) throw new Error("Version exceeds safe integer range");
  return numbers;
}

export function compareVersions(a: string, b: string) {
  const left = parts(a), right = parts(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}

export function nextVersion(current: string, previous?: string) {
  parts(current);
  if (!previous) return compareVersions(current, "0.1.0") > 0 ? current : "0.1.0";
  if (compareVersions(current, previous) > 0) return current;
  const [major, minor, patch] = parts(previous);
  const next = `${major}.${minor}.${patch + 1}`;
  parts(next);
  return next;
}

export function affectsRelease(path: string) {
  // These notices are copied into the shipped runtime.
  if (path.endsWith("THIRD_PARTY_NOTICES.md") || path.startsWith("apps/alphacode-app/third-party/")) return true;
  if (/\.(md|mdx)$/.test(path) || /(^|\/)(test|tests|__tests__|__snapshots__|examples|docs)\//.test(path)
    || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) || /(^|\/)tsconfig\.test\.json$/.test(path)) return false;
  return /^(apps\/(alphacode|alphacode-app|alphacode-app-server|alphacode-web)\/|packages\/|scripts\/)/.test(path)
    || ["package.json", "bun.lock", "bunfig.toml", ".bun-version", "nx.json", "tsconfig.base.json", ".github/workflows/ci.yml"].includes(path);
}

export function command(args: string[], cwd: string, env = process.env) {
  const result = Bun.spawnSync(args, { cwd, env, stdout: "pipe", stderr: "pipe", windowsHide: true });
  if (result.exitCode !== 0) throw new Error(`${args[0]} ${args[1]} failed: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

function git(args: string[], root: string) { return command(["git", ...args], root); }

export async function planRelease(root = process.cwd()) {
  // Only tags reachable from this exact checkout can be its release baseline.
  const tags = git(["tag", "--merged", "HEAD", "--list", "v*"], root).split("\n")
    .filter(tag => tag.startsWith("v") && stableVersion.test(tag.slice(1)))
    .sort((a, b) => compareVersions(b.slice(1), a.slice(1)));
  const previous = tags[0];
  const paths = git(previous ? ["diff", "--name-only", "-z", "--no-renames", previous, "HEAD"]
    : ["ls-tree", "-r", "--name-only", "-z", "HEAD"], root).split("\0").filter(Boolean);
  const changed = paths.filter(affectsRelease);
  const versions = await Promise.all(manifests.map(async path => JSON.parse(await readFile(join(root, path), "utf8")).version as string));
  if (versions[0] !== versions[1]) throw new Error("CLI and App package versions must match");
  parts(versions[0]);
  return { needed: changed.length > 0, version: changed.length ? nextVersion(versions[0], previous?.slice(1)) : versions[0],
    previous, changed, source: git(["rev-parse", "HEAD"], root) };
}

export async function prepareVersion(version: string, root = process.cwd()) {
  parts(version);
  let lock = await readFile(join(root, "bun.lock"), "utf8");
  const updates: [string, string][] = [];
  for (const path of manifests) {
    const content = await readFile(join(root, path), "utf8");
    const manifest = JSON.parse(content) as { version: string };
    parts(manifest.version);
    // Preserve all resolved dependencies and lockfile formatting. Only the two
    // workspace version fields change; frozen installation verifies the result.
    const workspace = path.replace(/\/package\.json$/, "");
    const pattern = new RegExp(`("${workspace}": \\{\\s*"name": "[^"]+",\\s*"version": ")[^"]+("[\\s,])`, "g");
    let matches = 0;
    lock = lock.replace(pattern, (_match, prefix, suffix) => { matches++; return `${prefix}${version}${suffix}`; });
    if (matches !== 1) throw new Error(`Expected one lockfile workspace version for ${workspace}`);
    updates.push([path, content.replace(/("version"\s*:\s*")[^"]+("[\s,])/, `$1${version}$2`)]);
  }
  for (const [path, content] of [...updates, ["bun.lock", lock]]) await writeFile(join(root, path), content);
}

export async function createVersionCommit(version: string, root = process.cwd()) {
  const source = git(["rev-parse", "HEAD"], root);
  await prepareVersion(version, root);
  git(["add", "--", ...versionFiles], root);
  // Stable commit metadata lets a failed upload resume on a rerun, without ever
  // moving an existing tag or accidentally publishing a different source tree.
  const date = git(["show", "-s", "--format=%cI", source], root);
  command(["git", "-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com",
    "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", `chore(release): v${version}`], root,
  { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  return { source, commit: git(["rev-parse", "HEAD"], root), tag: `v${version}` };
}

export function pushVersion(release: { source: string; commit: string; tag: string }, root = process.cwd()) {
  const remoteTag = git(["ls-remote", "origin", `refs/tags/${release.tag}`], root).split(/\s/)[0];
  if (remoteTag) {
    if (remoteTag !== release.commit) throw new Error(`Refusing to replace existing tag ${release.tag}`);
    return true; // A previous attempt pushed successfully; resume its upload.
  }
  const head = git(["ls-remote", "origin", "refs/heads/main"], root).split(/\s/)[0];
  if (head !== release.source) return false; // A newer main run will release the latest code.
  git(["tag", release.tag, release.commit], root);
  // Never force-push: both refs update together, or neither does if main moved.
  git(["push", "--atomic", "origin", `${release.commit}:refs/heads/main`, `refs/tags/${release.tag}`], root);
  return true;
}

export async function checkAssets(directory: string) {
  const actual = (await readdir(directory)).filter(name => name !== "SHA256SUMS").sort();
  if (JSON.stringify(actual) !== JSON.stringify(assetNames)) throw new Error("Release requires exactly the CLI and App archives for all four targets");
  const checksums: string[] = [];
  for (const name of assetNames) {
    const file = join(directory, name);
    const info = await stat(file);
    if (!info.isFile() || !info.size) throw new Error(`Empty or invalid artifact: ${name}`);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    checksums.push(`${hash.digest("hex")}  ${name}`);
  }
  await writeFile(join(directory, "SHA256SUMS"), `${checksums.join("\n")}\n`);
  return [...assetNames, "SHA256SUMS"].map(name => join(directory, name));
}

type Release = { tag_name: string; draft: boolean; prerelease: boolean; html_url: string };
export type Run = (args: string[], cwd: string) => string;

export async function publishAssets(version: string, assets: string[], previous: string | undefined, root = process.cwd(), run: Run = command) {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) throw new Error("Missing GITHUB_REPOSITORY");
  const tag = `v${version}`;
  const releases = run(["gh", "api", `repos/${repository}/releases?per_page=100`, "--paginate", "--jq", ".[] | @json"], root)
    .split("\n").filter(Boolean).map(line => JSON.parse(line) as Release);
  const existing = releases.find(release => release.tag_name === tag);
  if (existing && !existing.draft) return existing.html_url;
  if (!existing) {
    const notes = join(root, "dist", "release-notes.md");
    await writeFile(notes, "App 压缩包包含完整运行环境和 CLI，解压后启动应用。CLI 压缩包为构建产物，需检出本 Release 的 tag 并安装 Bun 和项目依赖。校验文件见 SHA256SUMS。\n");
    run(["gh", "release", "create", tag, "--verify-tag", "--title", `AlphaCode ${tag}`, "--draft", "--generate-notes", "--notes-file", notes,
      ...(previous ? ["--notes-start-tag", previous] : [])], root);
  }
  // Only a draft may be updated. An interrupted upload can be safely retried.
  run(["gh", "release", "upload", tag, ...assets, "--clobber"], root);
  const newer = releases.some(release => !release.draft && !release.prerelease && /^v\d+\.\d+\.\d+$/.test(release.tag_name)
    && compareVersions(release.tag_name.slice(1), version) > 0);
  run(["gh", "release", "edit", tag, "--draft=false", `--latest=${!newer}`], root);
  return `https://github.com/${repository}/releases/tag/${tag}`;
}

async function summary(message: string) {
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
}

if (import.meta.main) {
  const [action, version, directory] = process.argv.slice(2);
  if (action === "plan") {
    const plan = await planRelease();
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `needed=${plan.needed}\nversion=${plan.version}\n`);
    await summary(plan.needed ? `Release planned: v${plan.version}; ${plan.changed.length} relevant files changed since ${plan.previous || "the first commit"}.`
      : "No product/build changes since the last release; publication skipped.");
  } else if (action === "prepare" && version) {
    await prepareVersion(version);
  } else if (action === "publish" && version && directory) {
    if (process.env.GITHUB_REF !== "refs/heads/main" || !["push", "workflow_dispatch"].includes(process.env.GITHUB_EVENT_NAME || "")) {
      throw new Error("Publishing is only allowed on the main branch");
    }
    if (git(["status", "--porcelain"], process.cwd())) throw new Error("Release checkout must be clean");
    const plan = await planRelease();
    if (!plan.needed || plan.version !== version || plan.source !== process.env.GITHUB_SHA) throw new Error("Release plan does not match the tested commit/version");
    const assets = await checkAssets(resolve(directory));
    const release = await createVersionCommit(version);
    if (pushVersion(release)) await summary(`Published: ${await publishAssets(version, assets, plan.previous)}`);
    else await summary("Main advanced while building. This run will not publish; the newer main run will include these changes.");
  } else throw new Error("Usage: bun scripts/release.ts plan | prepare VERSION | publish VERSION ARTIFACT_DIRECTORY");
}
