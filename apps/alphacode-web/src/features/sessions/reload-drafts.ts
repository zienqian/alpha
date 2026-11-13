import type { SessionDraft } from "./use-session-workspace";

const key = "alphacode-reload-drafts-v1";
export interface ReloadDrafts {
  selectedSessionId: string;
  localSessions: { id: string; folderId?: string; title?: string }[];
  drafts: Record<string, SessionDraft>;
}

export function preserveReloadDrafts(value: ReloadDrafts) {
  if (Object.values(value.drafts).some(draft => draft.attachments.length)) return false;
  try {
    sessionStorage.setItem(key, JSON.stringify({ ...value, savedAt: Date.now() }));
    return true;
  } catch { return false; }
}

export function readReloadDrafts(): ReloadDrafts | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (!value || typeof value.savedAt !== "number" || !Number.isFinite(value.savedAt) || Date.now() - value.savedAt > 300000 || typeof value.selectedSessionId !== "string"
      || !Array.isArray(value.localSessions) || !value.localSessions.every((item: { id?: unknown; folderId?: unknown; title?: unknown }) =>
        typeof item?.id === "string" && item.id.startsWith("local-") && (item.folderId === undefined || typeof item.folderId === "string")
        && (item.title === undefined || typeof item.title === "string"))
      || !value.drafts || typeof value.drafts !== "object" || !Object.values(value.drafts).every(item =>
        item && typeof item === "object" && "text" in item && typeof item.text === "string" && "attachments" in item && Array.isArray(item.attachments) && item.attachments.length === 0
        && (!("permissionMode" in item) || item.permissionMode === undefined || item.permissionMode === "ask" || item.permissionMode === "auto" || item.permissionMode === "full"))) return undefined;
    return value;
  } catch { return undefined; }
}

export function clearReloadDrafts() { try { sessionStorage.removeItem(key); } catch { /* Storage may be disabled. */ } }
