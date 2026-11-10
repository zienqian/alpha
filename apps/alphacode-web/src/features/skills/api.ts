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
  userInvocable: boolean;
  disableModelInvocation: boolean;
  argumentHint?: string;
}
export interface SkillCatalog {
  projectId?: string;
  projects: { id: string; path: string }[];
  directories: SkillDirectory[];
  skills: InstalledSkill[];
  diagnostics: { code: string; path: string }[];
}
export interface SkillInstallation { installed: string[]; directory: string; requiresNewSession: boolean }
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

export function installSkill(input: { projectId: string; directoryId: string; file?: File; url?: string }) {
  if (input.file && input.file.size > skillUploadLimit) return Promise.reject(new SkillApiError("SKILL_PACKAGE_TOO_LARGE"));
  const params = new URLSearchParams({ projectId: input.projectId, directoryId: input.directoryId });
  return skillRequest<SkillInstallation>(`/api/skills/install?${params}`, {
    method: "POST", signal: AbortSignal.timeout(60_000),
    headers: { "Content-Type": input.file ? "application/zip" : "application/json" },
    body: input.file ?? JSON.stringify({ url: input.url }),
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
      case "PROJECT_NOT_FOUND": return t("skills:market.errors.project");
    }
  }
  return t("skills:market.errors.request");
}
