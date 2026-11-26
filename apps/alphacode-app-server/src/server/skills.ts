import { randomUUID } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { loadSkills, readSkill } from "@alpha/coding-agent";
import { parseDocument } from "yaml";
import type { AppConfig } from "../config";
import { defaultSkillsSettings, globalConfigDirectory, readGlobalDefaults, updateSkillsSettings, type SkillsSettings } from "../global-config";
import { isProjectTrusted, RESERVED_SKILL_NAMES, runtimeSkillRoots, SKILL_NAME_PATTERN } from "../runtime/skills";
import { safeSkillPath, skillUploadLimit, unpackSkills, type SkillFile } from "./skill-archive";
import { downloadSkill, skillLink } from "./skill-download";
import { fail, jsonBody, requiredString } from "./security";

export interface SkillRouteOptions {
  onChanged?: () => void;
  onSkillsSettingsChanged?: (settings: SkillsSettings) => Promise<void> | void;
}

type CatalogConfig = Pick<AppConfig, "configDirectory" | "skills"> & { workspaceRoot?: string };

const reservedNames = new Set<string>(RESERVED_SKILL_NAMES);
const canonicalPath = (path: string) => process.platform === "win32" ? path.toLowerCase() : path;

export async function skillCatalog(config: CatalogConfig) {
  const settings = config.skills ?? defaultSkillsSettings;
  const roots = await runtimeSkillRoots(config, config.workspaceRoot);
  const disabled = new Set(settings.disabledNames);
  const scans = await Promise.all(roots.map(async root => {
    // Browsing metadata is separate from trusting instructions for model use.
    const loaded = await loadSkills({ roots: [{ ...root, trusted: true }] });
    const exists = await lstat(root.path).then(() => true, () => false);
    return { directory: { ...root, exists }, loaded };
  }));
  // Compute active status in exact root priority order without scanning disk twice.
  const seenActive = new Set<string>();
  const skills = scans.flatMap(({ directory, loaded }) =>
    loaded.skills.map(skill => {
      let status: "available" | "disabled" | "untrusted" | "reserved" | "shadowed";
      if (!directory.enabled || disabled.has(skill.name)) {
        status = "disabled";
      } else if (!directory.trusted) {
        status = "untrusted";
      } else if (reservedNames.has(skill.name)) {
        status = "reserved";
      } else if (seenActive.has(skill.name)) {
        status = "shadowed";
      } else {
        seenActive.add(skill.name);
        status = "available";
      }
      return {
        ...skill,
        directoryId: directory.id,
        kind: directory.kind,
        status,
        disabledByName: disabled.has(skill.name),
      };
    }),
  );
  return {
    directories: scans.map(scan => scan.directory),
    skills,
    diagnostics: scans.flatMap(scan => scan.loaded.diagnostics),
    settings,
  };
}

function packageName(bytes: Buffer) {
  if (bytes.length > 32768) fail(400, "SKILL_INVALID_PACKAGE");
  const header = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(bytes.toString("utf8"));
  if (!header?.[1]) return fail(400, "SKILL_INVALID_PACKAGE");
  try {
    const document = parseDocument(header[1], { uniqueKeys: true, prettyErrors: false });
    const name: unknown = document.toJS({ maxAliasCount: 0 })?.name;
    if (document.errors.length || typeof name !== "string" || name.length > 64 || !SKILL_NAME_PATTERN.test(name)) fail(400, "SKILL_INVALID_PACKAGE");
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
  // Only clean up direct children created or owned inside this skill root.
  if (dirname(resolve(path)) !== resolve(root) || resolve(path) === resolve(root)) throw new Error("Unsafe skill cleanup");
  await rm(path, { recursive: true, force: true });
}

async function listSupportingFiles(baseDir: string, limit = 100): Promise<string[]> {
  const files: string[] = [];
  async function walk(current: string, prefix: string) {
    if (files.length >= limit) return;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (files.length >= limit) return;
      if (entry.name === ".git" || entry.name === "node_modules" || entry.isSymbolicLink()) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(join(current, entry.name), rel);
      } else if (entry.isFile() && rel !== "SKILL.md") {
        files.push(rel);
      }
    }
  }
  await walk(baseDir, "");
  return files;
}

export async function readSkillDetails(config: CatalogConfig, directoryId: string, name: string, signal?: AbortSignal) {
  if (!name || name.length > 64 || !SKILL_NAME_PATTERN.test(name)) fail(400, "SKILL_INVALID_NAME");
  const root = (await runtimeSkillRoots(config, config.workspaceRoot)).find(item => item.id === directoryId);
  if (!root) return fail(400, "SKILL_INVALID_DIRECTORY");
  const loaded = await loadSkills({ roots: [{ ...root, trusted: true }], signal });
  const target = loaded.skills.find(skill => skill.name === name);
  if (!target) return fail(404, "SKILL_NOT_FOUND");
  const content = await readSkill(target, { signal });
  const files = await listSupportingFiles(target.baseDir);
  return { ...content, files };
}

export async function uninstallSkill(config: CatalogConfig, directoryId: string, name: string) {
  if (!name || name.length > 64 || !SKILL_NAME_PATTERN.test(name)) fail(400, "SKILL_INVALID_NAME");
  const root = (await runtimeSkillRoots(config, config.workspaceRoot)).find(item => item.id === directoryId);
  if (!root) return fail(400, "SKILL_INVALID_DIRECTORY");
  await checkDirectory(root.path);
  const target = join(root.path, name);
  if (dirname(resolve(target)) !== resolve(root.path) || resolve(target) === resolve(root.path)) fail(400, "SKILL_UNSAFE_DIRECTORY");
  const stat = await lstat(target).catch(error => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  });
  if (!stat) return fail(404, "SKILL_NOT_FOUND");
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(400, "SKILL_UNSAFE_DIRECTORY");
  const manifest = await lstat(join(target, "SKILL.md")).catch(() => undefined);
  if (!manifest || !manifest.isFile() || manifest.isSymbolicLink()) fail(404, "SKILL_NOT_FOUND");
  await removeOwnedDirectory(root.path, target);
  return { removed: name, directory: root.path, requiresNewSession: true };
}

export async function installSkillFiles(
  config: CatalogConfig,
  directoryId: string,
  files: SkillFile[],
  selection?: { folder?: string; name?: string; overwrite?: boolean },
) {
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
    if (reservedNames.has(candidate.name)) fail(400, "SKILL_RESERVED_NAME");
    if (candidates.some(other => other !== candidate && other.prefix.startsWith(candidate.prefix))) fail(400, "SKILL_INVALID_PACKAGE");
  }
  await checkDirectory(root.path);
  await mkdir(root.path, { recursive: true });
  await checkDirectory(root.path);
  for (const name of names) {
    const existing = await lstat(join(root.path, name)).catch(error => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    });
    if (existing) {
      if (!selection?.overwrite) fail(409, "SKILL_NAME_CONFLICT");
      if (!existing.isDirectory() || existing.isSymbolicLink()) fail(400, "SKILL_UNSAFE_DIRECTORY");
    }
  }
  const stage = await mkdtemp(join(root.path, ".install-"));
  const created: string[] = [];
  const backups: { backup: string; destination: string }[] = [];
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
      if (selection?.overwrite) {
        const existing = await lstat(destination).catch(error => {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
          throw error;
        });
        if (existing) {
          if (!existing.isDirectory() || existing.isSymbolicLink()) fail(400, "SKILL_UNSAFE_DIRECTORY");
          const backup = join(root.path, `.backup-${randomUUID()}-${name}`);
          await rename(destination, backup);
          backups.push({ backup, destination });
        }
      }
      // mkdir is exclusive even across processes; never replace an existing skill unless backed up.
      try { await mkdir(destination); } catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") fail(409, "SKILL_NAME_CONFLICT"); throw error; }
      created.push(destination);
      const source = join(stage, name);
      for (const child of await readdir(source)) {
        if (child !== "SKILL.md") await cp(join(source, child), join(destination, child), { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true });
      }
      // Publish the entry point last, so runtimes cannot load a half-copied skill.
      await writeFile(join(destination, "SKILL.md"), await readFile(join(source, "SKILL.md")), { flag: "wx", mode: 0o600 });
    }
    for (const { backup } of backups) await removeOwnedDirectory(root.path, backup);
    return { installed: [...names], directory: root.path, requiresNewSession: true };
  } catch (error) {
    for (const path of created) await removeOwnedDirectory(root.path, path).catch(() => undefined);
    for (const { backup, destination } of backups.reverse()) {
      await rename(backup, destination).catch(() => undefined);
    }
    throw error;
  } finally { await removeOwnedDirectory(root.path, stage); }
}

export function createSkillRoutes(configs: Map<string, AppConfig>, options: SkillRouteOptions = {}) {
  // Serialize filesystem commits and settings writes. Downloads and reads remain independent.
  let committing = Promise.resolve<unknown>(undefined);
  let savingSettings = Promise.resolve<unknown>(undefined);

  async function resolveContext(id: string | null): Promise<{ projectId?: string; config: CatalogConfig }> {
    if (id !== null) {
      const config = configs.get(id);
      if (!config) return fail(404, "PROJECT_NOT_FOUND");
      return { projectId: id, config };
    }
    const firstId = configs.keys().next().value;
    if (firstId) {
      const config = configs.get(firstId)!;
      return { projectId: firstId, config };
    }
    const configDirectory = globalConfigDirectory();
    const defaults = await readGlobalDefaults(configDirectory).catch(() => ({}));
    return { config: { configDirectory, skills: defaults.skills ?? defaultSkillsSettings } };
  }

  return async (request: Request, url: URL): Promise<Response> => {
    if (request.method === "GET" && url.pathname === "/api/skills") {
      const { projectId, config } = await resolveContext(url.searchParams.get("projectId"));
      const settings = config.skills ?? defaultSkillsSettings;
      const projects = await Promise.all([...configs].map(async ([id, entry]) => ({
        id,
        name: entry.projectName || basename(entry.workspaceRoot) || entry.workspaceRoot,
        path: entry.workspaceRoot,
        trusted: await isProjectTrusted(settings, entry.workspaceRoot),
      })));
      return Response.json({ projectId, projects, ...await skillCatalog(config) });
    }

    if (request.method === "GET" && url.pathname === "/api/skills/content") {
      const { config } = await resolveContext(url.searchParams.get("projectId"));
      const directoryId = url.searchParams.get("directoryId") ?? "";
      const name = url.searchParams.get("name") ?? "";
      return Response.json(await readSkillDetails(config, directoryId, name, request.signal));
    }

    if (request.method === "PATCH" && url.pathname === "/api/skills/settings") {
      const body = await jsonBody(request);
      if (body.sharedDirectories !== undefined && typeof body.sharedDirectories !== "boolean") fail(400, "INVALID_SETTINGS");
      if (body.claudeDirectories !== undefined && typeof body.claudeDirectories !== "boolean") fail(400, "INVALID_SETTINGS");
      let toggleSkill: { name: string; enabled: boolean } | undefined;
      if (body.toggleSkill !== undefined) {
        const raw = body.toggleSkill as Record<string, unknown>;
        if (!raw || typeof raw !== "object" || typeof raw.name !== "string" || !SKILL_NAME_PATTERN.test(raw.name) || raw.name.length > 64 || typeof raw.enabled !== "boolean") {
          fail(400, "INVALID_SETTINGS");
        }
        toggleSkill = { name: raw.name, enabled: raw.enabled };
      }
      let trustProject: { projectId: string; trusted: boolean } | undefined;
      if (body.trustProject !== undefined) {
        const raw = body.trustProject as Record<string, unknown>;
        if (!raw || typeof raw !== "object" || typeof raw.projectId !== "string" || !raw.projectId.trim() || typeof raw.trusted !== "boolean") {
          fail(400, "INVALID_SETTINGS");
        }
        trustProject = { projectId: raw.projectId, trusted: raw.trusted };
      }
      const work = savingSettings.catch(() => undefined).then(async () => {
        const targetProject = trustProject ? configs.get(trustProject.projectId) : undefined;
        if (trustProject && !targetProject) fail(404, "PROJECT_NOT_FOUND");
        const firstConfig = targetProject ?? configs.values().next().value;
        const configDirectory = firstConfig?.configDirectory ?? globalConfigDirectory();
        const current = firstConfig?.skills
          ?? (await readGlobalDefaults(configDirectory).catch(() => ({}))).skills
          ?? defaultSkillsSettings;

        let disabledNames = [...current.disabledNames];
        if (toggleSkill) {
          if (toggleSkill.enabled) {
            disabledNames = disabledNames.filter(entry => entry !== toggleSkill.name);
          } else if (!disabledNames.includes(toggleSkill.name)) {
            disabledNames.push(toggleSkill.name);
          }
        }

        let trustedProjects = [...current.trustedProjects];
        if (trustProject && targetProject) {
          const resolvedRoot = await realpath(targetProject.workspaceRoot).catch(() => targetProject.workspaceRoot);
          const targetCanonical = canonicalPath(resolvedRoot);
          const filtered: string[] = [];
          for (const existing of trustedProjects) {
            const existingResolved = await realpath(existing).catch(() => existing);
            if (canonicalPath(existingResolved) !== targetCanonical) filtered.push(existing);
          }
          trustedProjects = trustProject.trusted ? [...filtered, resolvedRoot] : filtered;
        }

        const updated = await updateSkillsSettings(configDirectory, {
          sharedDirectories: body.sharedDirectories as boolean | undefined,
          claudeDirectories: body.claudeDirectories as boolean | undefined,
          disabledNames,
          trustedProjects,
        });
        for (const [id, entry] of configs) {
          configs.set(id, { ...entry, skills: updated });
        }
        await options.onSkillsSettingsChanged?.(updated);
        options.onChanged?.();
        return { settings: updated, requiresNewSession: true };
      });
      savingSettings = work;
      return Response.json(await work);
    }

    if (request.method === "DELETE" && url.pathname === "/api/skills") {
      const { config } = await resolveContext(url.searchParams.get("projectId"));
      const directoryId = url.searchParams.get("directoryId") ?? "";
      const name = url.searchParams.get("name") ?? "";
      const work = committing.catch(() => undefined).then(async () => {
        const result = await uninstallSkill(config, directoryId, name);
        options.onChanged?.();
        return result;
      });
      committing = work;
      return Response.json(await work);
    }

    if (request.method !== "POST" || url.pathname !== "/api/skills/install") return fail(405, "METHOD_NOT_ALLOWED");
    const { config } = await resolveContext(url.searchParams.get("projectId"));
    const directoryId = url.searchParams.get("directoryId") ?? "user-local";
    const overwrite = url.searchParams.get("overwrite") === "true";
    let files: SkillFile[], selection: { folder?: string; name?: string; overwrite?: boolean } | undefined = overwrite ? { overwrite } : undefined;
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
      selection = { ...link, ...(overwrite ? { overwrite } : {}) };
    }
    const work = committing.catch(() => undefined).then(async () => {
      const result = await installSkillFiles(config, directoryId, files, selection);
      options.onChanged?.();
      return result;
    });
    committing = work;
    return Response.json(await work, { status: 201 });
  };
}
