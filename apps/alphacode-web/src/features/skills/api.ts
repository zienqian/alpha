import type { Translate } from "@/i18n/instance";

export interface SkillDirectory {
  id: string;
  path: string;
  source: "user" | "project";
  kind: "local" | "shared" | "claude";
  enabled: boolean;
  trusted: boolean;
  exists: boolean;
}

export interface InstalledSkill {
  name: string;
  description: string;
  filePath: string;
  directoryId: string;
  source: SkillDirectory["source"];
  kind: SkillDirectory["kind"];
  status: "available" | "disabled" | "untrusted" | "reserved" | "shadowed";
  disabledByName?: boolean;
  userInvocable: boolean;
  disableModelInvocation: boolean;
  argumentHint?: string;
}

export interface SkillProject {
  id: string;
  name?: string;
  path: string;
  trusted?: boolean;
}

export interface SkillsSettings {
  sharedDirectories: boolean;
  claudeDirectories: boolean;
  trustedProjects: readonly string[];
  disabledNames: readonly string[];
}

export interface SkillCatalog {
  projectId?: string;
  projects: SkillProject[];
  directories: SkillDirectory[];
  skills: InstalledSkill[];
  diagnostics: { code: string; path: string }[];
  settings?: SkillsSettings;
}

export interface SkillContentDetail {
  name: string;
  filePath: string;
  baseDir: string;
  revision: string;
  content: string;
  files: string[];
}

export interface SkillInstallation {
  installed: string[];
  directory: string;
  requiresNewSession: boolean;
}

export interface SkillUninstallResult {
  removed: string;
  directory: string;
  requiresNewSession: boolean;
}

export interface SkillSettingsUpdate {
  sharedDirectories?: boolean;
  claudeDirectories?: boolean;
  toggleSkill?: { name: string; enabled: boolean };
  trustProject?: { projectId: string; trusted: boolean };
}

export interface SkillSettingsResult {
  settings: SkillsSettings;
  requiresNewSession: boolean;
}

export const skillUploadLimit = 10 * 1024 * 1024;

export class SkillApiError extends Error {
  constructor(readonly code: string) { super(code); }
}

async function skillRequest<T>(path: string, options: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "omit", redirect: "error", cache: "no-store", ...options });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { code?: string };
    if (response.status === 404 && (!body.code || body.code === "NOT_FOUND")) throw new SkillApiError("SKILL_API_UNAVAILABLE");
    throw new SkillApiError(body.code ?? (response.status === 413 ? "SKILL_PACKAGE_TOO_LARGE" : "SKILL_REQUEST_FAILED"));
  }
  if (!response.headers.get("content-type")?.includes("application/json")) throw new SkillApiError("SKILL_API_UNAVAILABLE");
  return response.json() as Promise<T>;
}

export const listSkills = (projectId: string | undefined, signal: AbortSignal) =>
  skillRequest<SkillCatalog>(`/api/skills${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`, { signal });

export function readSkillContent(input: { projectId?: string; directoryId: string; name: string }, signal: AbortSignal) {
  const params = new URLSearchParams({ directoryId: input.directoryId, name: input.name });
  if (input.projectId) params.set("projectId", input.projectId);
  return skillRequest<SkillContentDetail>(`/api/skills/content?${params}`, { signal });
}

export function installSkill(input: { projectId?: string; directoryId: string; file?: File; url?: string; overwrite?: boolean }) {
  if (input.file && input.file.size > skillUploadLimit) return Promise.reject(new SkillApiError("SKILL_PACKAGE_TOO_LARGE"));
  const params = new URLSearchParams();
  if (input.projectId) params.set("projectId", input.projectId);
  params.set("directoryId", input.directoryId);
  if (input.overwrite) params.set("overwrite", "true");
  return skillRequest<SkillInstallation>(`/api/skills/install?${params}`, {
    method: "POST", signal: AbortSignal.timeout(60_000),
    headers: { "Content-Type": input.file ? "application/zip" : "application/json" },
    body: input.file ?? JSON.stringify({ url: input.url }),
  });
}

export function updateSkillSettings(input: SkillSettingsUpdate) {
  return skillRequest<SkillSettingsResult>("/api/skills/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function uninstallSkill(input: { projectId?: string; directoryId: string; name: string }) {
  const params = new URLSearchParams({ directoryId: input.directoryId, name: input.name });
  if (input.projectId) params.set("projectId", input.projectId);
  return skillRequest<SkillUninstallResult>(`/api/skills?${params}`, {
    method: "DELETE",
  });
}

export function skillError(t: Translate, error: unknown) {
  if (error instanceof SkillApiError) {
    switch (error.code) {
      case "SKILL_API_UNAVAILABLE": return t("skills:market.errors.unavailable");
      case "SKILL_NAME_CONFLICT": return t("skills:market.errors.conflict");
      case "SKILL_PACKAGE_TOO_LARGE": return t("skills:market.errors.size");
      case "SKILL_INVALID_URL": case "SKILL_UNSAFE_URL": return t("skills:market.errors.url");
      case "SKILL_DOWNLOAD_FAILED": return t("skills:market.errors.download");
      case "SKILL_INVALID_PACKAGE": case "SKILL_RESERVED_NAME": return t("skills:market.errors.package");
      case "SKILL_INVALID_ARCHIVE": case "SKILL_UNSAFE_ARCHIVE": return t("skills:market.errors.archive");
      case "SKILL_UNSAFE_DIRECTORY": case "SKILL_INVALID_DIRECTORY": case "SKILL_DIRECTORY_DISABLED": return t("skills:market.errors.directory");
      case "SKILL_NOT_FOUND": return t("skills:market.errors.notFound");
      case "PROJECT_NOT_FOUND": return t("skills:market.errors.project");
    }
  }
  return t("skills:market.errors.request");
}

export function projectDisplayName(project: SkillProject): string {
  if (project.name?.trim()) return project.name.trim();
  const tail = project.path.split(/[\\/]/).filter(Boolean).at(-1);
  return tail || project.path;
}
