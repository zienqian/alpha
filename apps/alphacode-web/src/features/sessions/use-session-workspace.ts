import { useState } from "react";
import type { Session, SessionFolder } from "@/features/sessions/types";

export interface DraftAttachment {
  id: string;
  file: File;
}

export interface SessionDraft {
  text: string;
  attachments: DraftAttachment[];
}

const emptyDraft: SessionDraft = { text: "", attachments: [] };
type LocalSession = Session & { folderId: string };

function createLocalSession(id: string, folderId: string): LocalSession {
  return { id, folderId, title: "新会话", description: "仅保存在当前页面的草稿", messages: [] };
}

export function useSessionWorkspace(sourceFolders: SessionFolder[]) {
  const [localSessions, setLocalSessions] = useState<LocalSession[]>(() =>
    sourceFolders[0] ? [createLocalSession("local-initial", sourceFolders[0].id)] : [],
  );
  const [selectedSessionId, selectSession] = useState<string | undefined>(() =>
    sourceFolders[0] ? "local-initial" : undefined,
  );
  const [drafts, setDrafts] = useState<Record<string, SessionDraft>>({});
  const [focusRequest, setFocusRequest] = useState(0);
  const folders = sourceFolders.map((folder) => ({
    ...folder,
    sessions: [
      ...localSessions.filter((session) => session.folderId === folder.id).map((session) => ({
        ...session,
        title: drafts[session.id]?.text.trim().split("\n")[0]?.slice(0, 28) || session.title,
      })),
      ...folder.sessions,
    ],
  }));
  const selectedFolder = folders.find((folder) => folder.sessions.some((session) => session.id === selectedSessionId));
  const selectedSession = selectedFolder?.sessions.find((session) => session.id === selectedSessionId);
  const draft = drafts[selectedSessionId ?? "unassigned"] ?? emptyDraft;

  function updateDraft(patch: Partial<SessionDraft>) {
    const id = selectedSessionId ?? "unassigned";
    setDrafts((previous) => ({ ...previous, [id]: { ...(previous[id] ?? emptyDraft), ...patch } }));
  }

  function newSession(requestedFolderId?: string) {
    const folderId = requestedFolderId ?? selectedFolder?.id ?? sourceFolders[0]?.id;
    if (!folderId || !sourceFolders.some((folder) => folder.id === folderId)) return;
    const reusable = localSessions.find((session) => session.folderId === folderId &&
      !drafts[session.id]?.text.trim() && !drafts[session.id]?.attachments.length);
    if (reusable) {
      selectSession(reusable.id);
    } else {
      const session = createLocalSession(`local-${crypto.randomUUID()}`, folderId);
      setLocalSessions((previous) => [session, ...previous]);
      selectSession(session.id);
    }
    setFocusRequest((previous) => previous + 1);
  }

  function changeWorkspace(folderId: string) {
    if (!sourceFolders.some((folder) => folder.id === folderId)) return;
    const local = localSessions.find((session) => session.id === selectedSessionId);
    if (local) {
      setLocalSessions((previous) => previous.map((session) => session.id === local.id ? { ...session, folderId } : session));
    } else {
      const session = createLocalSession(`local-${crypto.randomUUID()}`, folderId);
      setLocalSessions((previous) => [session, ...previous]);
      selectSession(session.id);
    }
  }

  return { folders, selectedFolder, selectedSession, selectedSessionId, selectSession, draft, updateDraft, newSession, changeWorkspace, focusRequest };
}
