import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { loadSkills } from "@alpha/coding-agent";
import { parseDocument } from "yaml";
import type { AppConfig } from "../config";
import { defaultSkillsSettings } from "../global-config";
import { loadRuntimeSkills, runtimeSkillRoots } from "../runtime/skills";
import { safeSkillPath, skillUploadLimit, unpackSkills, type SkillFile } from "./skill-archive";
import { downloadSkill, skillLink } from "./skill-download";
import { fail, jsonBody, requiredString } from "./security";

export async function skillCatalog(config: AppConfig) {
  const roots = await runtimeSkillRoots(config, config.workspaceRoot);
  const active = await loadRuntimeSkills(config, config.workspaceRoot);
  const disabled = new Set((config.skills ?? defaultSkillsSettings).disabledNames);
  const reserved = new Set(["skills", "permission", "web"]);
  const scans = await Promise.all(roots.map(async root => {
    // Browsing metadata is separate from trusting instructions for model use.
    const loaded = await loadSkills({ roots: [{ ...root, trusted: true }] });
    const exists = await lstat(root.path).then(() => true, () => false);
    return { directory: { ...root, exists },
      skills: loaded.skills.map(skill => ({ ...skill, directoryId: root.id, kind: root.kind,
        status: !root.enabled || disabled.has(skill.name) ? "disabled" : !root.trusted ? "untrusted"
          : reserved.has(skill.name) ? "reserved" : active.skills.some(item => item.filePath === skill.filePath) ? "available" : "shadowed" })),
      diagnostics: loaded.diagnostics };
  }));
  return { directories: scans.map(scan => scan.directory), skills: scans.flatMap(scan => scan.skills),
    diagnostics: scans.flatMap(scan => scan.diagnostics) };
}

function packageName(bytes: Buffer) {
  if (bytes.length > 32768) fail(400, "SKILL_INVALID_PACKAGE");
  const header = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(bytes.toString("utf8"));
  if (!header?.[1]) return fail(400, "SKILL_INVALID_PACKAGE");
  try {
    const document = parseDocument(header[1], { uniqueKeys: true, prettyErrors: false });
    const name: unknown = document.toJS({ maxAliasCount: 0 })?.name;
    if (document.errors.length || typeof name !== "string" || name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) fail(400, "SKILL_INVALID_PACKAGE");
    return name as string;
  } catch { return fail(400, "SKILL_INVALID_PACKAGE"); }
}

async function checkDirectory(path: string) {
  let current = resolve(path);
  while (true) {
    const stat = await lstat(current).catch(error => { if (error.code !== "ENOENT") throw error; });
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) fail(400, "SKILL_UNSAFE_DIRECTORY");
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

async function removeOwnedDirectory(root: string, path: string) {
  // Only clean up direct children created by this installation.
  if (dirname(resolve(path)) !== resolve(root) || resolve(path) === resolve(root)) throw new Error("Unsafe skill cleanup");
  await rm(path, { recursive: true, force: true });
}

export async function installSkillFiles(config: AppConfig, directoryId: string, files: SkillFile[], selection?: { folder?: string; name?: string }) {
  const root = (await runtimeSkillRoots(config, config.workspaceRoot)).find(item => item.id === directoryId);
  if (!root) return fail(400, "SKILL_INVALID_DIRECTORY");
  if (!root.enabled) fail(400, "SKILL_DIRECTORY_DISABLED");
  const selected = files.filter(file => {
    const parts = safeSkillPath(file.path).split("/");
    if (parts.some(part => [".git", "node_modules", "__MACOSX"].includes(part))) return false;
    // GitHub archives include a repository wrapper directory.
    return selection?.folder === undefined || parts.slice(1).join("/").startsWith(selection.folder ? `${selection.folder}/` : "");
  });
  const candidates = selected.filter(file => file.path === "SKILL.md" || file.path.endsWith("/SKILL.md"))
    .flatMap(file => {
      let name: string;
      try { name = packageName(file.bytes); }
      catch (error) { if (selection?.name) return []; throw error; }
      return selection?.name && name !== selection.name ? [] : [{ name, prefix: file.path.slice(0, -"SKILL.md".length) }];
    });
  if (!candidates.length || candidates.length > 32) fail(400, "SKILL_INVALID_PACKAGE");
  const names = new Set<string>();
  for (const candidate of candidates) {
    if (names.has(candidate.name)) fail(409, "SKILL_NAME_CONFLICT");
    names.add(candidate.name);
    if (["skills", "permission", "web"].includes(candidate.name)) fail(400, "SKILL_RESERVED_NAME");
    if (candidates.some(other => other !== candidate && other.prefix.startsWith(candidate.prefix))) fail(400, "SKILL_INVALID_PACKAGE");
  }
  await checkDirectory(root.path);
  await mkdir(root.path, { recursive: true });
  await checkDirectory(root.path);
  for (const name of names) {
    if (await lstat(join(root.path, name)).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; })) fail(409, "SKILL_NAME_CONFLICT");
  }
  const stage = await mkdtemp(join(root.path, ".install-"));
  const created: string[] = [];
  try {
    for (const candidate of candidates) {
      const base = join(stage, candidate.name);
      await mkdir(base);
      for (const file of selected.filter(item => item.path.startsWith(candidate.prefix))) {
        const suffix = safeSkillPath(file.path.slice(candidate.prefix.length));
        const target = join(base, ...suffix.split("/"));
        if (relative(base, target).startsWith(`..${sep}`)) fail(400, "SKILL_UNSAFE_ARCHIVE");
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.bytes, { flag: "wx", mode: file.executable ? 0o700 : 0o600 });
      }
    }
    const validation = await loadSkills({ roots: [{ path: stage, source: root.source, trusted: true }] });
    if (validation.skills.length !== candidates.length || validation.diagnostics.some(item => item.severity === "error")) fail(400, "SKILL_INVALID_PACKAGE");
    for (const name of names) {
      const destination = join(root.path, name);
      // mkdir is exclusive even across processes; never replace an existing skill.
      try { await mkdir(destination); } catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") fail(409, "SKILL_NAME_CONFLICT"); throw error; }
      created.push(destination);
      const source = join(stage, name);
      for (const child of await readdir(source)) {
        if (child !== "SKILL.md") await cp(join(source, child), join(destination, child), { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true });
      }
      // Publish the entry point last, so runtimes cannot load a half-copied skill.
      await writeFile(join(destination, "SKILL.md"), await readFile(join(source, "SKILL.md")), { flag: "wx", mode: 0o600 });
    }
    return { installed: [...names], directory: root.path, requiresNewSession: true };
  } catch (error) {
    for (const path of created) await removeOwnedDirectory(root.path, path);
    throw error;
  } finally { await removeOwnedDirectory(root.path, stage); }
}

export function createSkillRoutes(configs: Map<string, AppConfig>) {
  // Serialize filesystem commits. Downloads and metadata reads remain independent.
  let committing = Promise.resolve<unknown>(undefined);
  function project(id: string | null) {
    const projectId = id ?? configs.keys().next().value;
    const config = projectId ? configs.get(projectId) : undefined;
    if (!config) return fail(404, "PROJECT_NOT_FOUND");
    return { projectId, config };
  }
  return async (request: Request, url: URL): Promise<Response> => {
    if (request.method === "GET" && url.pathname === "/api/skills") {
      const projects = [...configs].map(([id, config]) => ({ id, path: config.workspaceRoot }));
      if (!projects.length) return Response.json({ projects, directories: [], skills: [], diagnostics: [] });
      const { projectId, config } = project(url.searchParams.get("projectId"));
      return Response.json({ projectId, projects, ...await skillCatalog(config) });
    }
    if (request.method !== "POST" || url.pathname !== "/api/skills/install") return fail(405, "METHOD_NOT_ALLOWED");
    const { config } = project(url.searchParams.get("projectId"));
    const directoryId = url.searchParams.get("directoryId") ?? "user-local";
    let files: SkillFile[], selection: { folder?: string; name?: string } | undefined;
    const type = request.headers.get("content-type")?.split(";")[0];
    if (type === "application/zip" || type === "application/octet-stream") {
      files = await unpackSkills(Buffer.from(await request.arrayBuffer()));
    } else {
      const body = await jsonBody(request);
      const link = skillLink(requiredString(body, "url", 2048).trim());
      let bytes: Buffer;
      try { bytes = await downloadSkill(link.url, AbortSignal.any([request.signal, AbortSignal.timeout(30_000)])); }
      catch (error) { if ((error as { status?: number }).status) throw error; return fail(400, "SKILL_DOWNLOAD_FAILED"); }
      if (bytes.length > skillUploadLimit) fail(413, "SKILL_PACKAGE_TOO_LARGE");
      if (bytes[0] === 0x50 && bytes[1] === 0x4b) files = await unpackSkills(bytes);
      else if (link.folder === undefined && link.name === undefined) files = [{ path: "SKILL.md", bytes }];
      else return fail(400, "SKILL_INVALID_ARCHIVE");
      selection = link;
    }
    const work = committing.catch(() => undefined).then(() => installSkillFiles(config, directoryId, files, selection));
    committing = work;
    return Response.json(await work, { status: 201 });
  };
}
