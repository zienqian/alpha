import { useTranslation } from "@/i18n/react";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createSession, type SessionInfo } from "@/features/sessions/api";
import { useSessionActions } from "@/features/sessions/use-session-actions";
import { useSessionQuery, useSessionsQuery } from "@/features/sessions/queries";
import { groupSessions, sessionFromView, type Session } from "@/features/sessions/types";

export interface DraftAttachment {
  id: string;
  file: File;
}

export interface SessionDraft {
  text: string;
  attachments: DraftAttachment[];
}

const emptyDraft: SessionDraft = { text: "", attachments: [] };
type LocalSession = Session & { folderId?: string };

function createLocalSession(id: string, folderId?: string): LocalSession {
  return { id, folderId, title: "", description: "", messages: [], local: true };
}

export function useSessionWorkspace() {
  const { t } = useTranslation();
  const displaySession = (session: Session): Session => ({ ...session,
    title: session.title || t(session.local ? "sessions:new" : "sessions:untitled"),
    description: t(session.local ? "sessions:draftDescription" : "sessions:savedDescription"),
  });
  const client = useQueryClient();
  const index = useSessionsQuery();
  const [localSessions, setLocalSessions] = useState<LocalSession[]>(() => [createLocalSession("local-initial")]);
  const [selectedSessionId, setSelectedSessionId] = useState(() =>
    new URL(window.location.href).searchParams.get("session") || "local-initial",
  );
  const isLocal = localSessions.some((session) => session.id === selectedSessionId);
  const history = useSessionQuery(isLocal ? undefined : selectedSessionId);
  // A direct /web link can load its history even if the index request fails.
  const infos = index.data ?? [];
  const sourceFolders = groupSessions(history.data
    ? [...infos.filter((info) => info.id !== history.data.session.id), history.data.session]
    : infos);
  const [drafts, setDrafts] = useState<Record<string, SessionDraft>>({});
  const selection = useRef(selectedSessionId);
  const creating = useRef(new Set<string>());
  const [creatingIds, setCreatingIds] = useState<Record<string, boolean>>({});
  const [creationErrors, setCreationErrors] = useState<Record<string, boolean | undefined>>({});
  const actions = useSessionActions(history.data, selectedSessionId, (id, input) => {
    setDrafts(previous => previous[id]?.text === input
      ? { ...previous, [id]: { ...previous[id], text: "" } } : previous);
  });
  const [focusRequest, setFocusRequest] = useState(0);
  const firstFolderId = sourceFolders[0]?.id;
  useEffect(() => {
    if (firstFolderId) setLocalSessions((previous) => previous.some((session) => !session.folderId)
      ? previous.map((session) => session.folderId ? session : { ...session, folderId: firstFolderId }) : previous);
  }, [firstFolderId]);
  const folders = sourceFolders.map((folder) => ({
    ...folder,
    sessions: [
      ...localSessions.filter((session) => (session.folderId ?? sourceFolders[0]?.id) === folder.id),
      ...folder.sessions,
    ].map(displaySession),
  }));
  const selectedFolder = folders.find((folder) => folder.sessions.some((session) => session.id === selectedSessionId));
  const selectedSession = !isLocal && history.data ? displaySession(sessionFromView(history.data))
    : selectedFolder?.sessions.find((session) => session.id === selectedSessionId);
  const draft = drafts[selectedSessionId] ?? emptyDraft;

  useEffect(() => {
    const onPopState = () => {
      const localId = window.history.state?.localSessionId;
      const id = new URL(window.location.href).searchParams.get("session")
        || (localSessions.some((session) => session.id === localId) ? localId : "local-initial");
      selection.current = id;
      setSelectedSessionId(id);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [localSessions]);

  function selectSession(id: string, local = localSessions.some((session) => session.id === id)) {
    if (id !== selectedSessionId) {
      const url = new URL(window.location.href);
      if (local) url.searchParams.delete("session");
      else url.searchParams.set("session", id);
      window.history.pushState({ localSessionId: local ? id : undefined }, "", url);
    }
    selection.current = id;
    setSelectedSessionId(id);
  }

  function updateDraft(patch: Partial<SessionDraft>) {
    const id = selectedSessionId;
    setDrafts((previous) => ({ ...previous, [id]: { ...(previous[id] ?? emptyDraft), ...patch } }));
  }

  function newSession(requestedFolderId?: string) {
    const folderId = requestedFolderId ?? selectedFolder?.id ?? sourceFolders[0]?.id;
    if (!folderId || !sourceFolders.some((folder) => folder.id === folderId)) return;
    const reusable = localSessions.find((session) => (session.folderId ?? sourceFolders[0]?.id) === folderId &&
      !drafts[session.id]?.text.trim() && !drafts[session.id]?.attachments.length);
    if (reusable) {
      selectSession(reusable.id);
    } else {
      const session = createLocalSession(`local-${crypto.randomUUID()}`, folderId);
      setLocalSessions((previous) => [session, ...previous]);
      selectSession(session.id, true);
    }
    setFocusRequest((previous) => previous + 1);
  }

  const connected = history.connection === "connected";
  const busy = Boolean(history.data?.state.busy);
  const canSend = Boolean(draft.text.trim()) && !draft.attachments.length && !actions.pending
    && !creatingIds[selectedSessionId] && (isLocal ? Boolean(selectedFolder) : connected && Boolean(history.data?.state.canSend)
      && !busy && !history.data?.state.closing && !history.data?.state.settingsSaving);

  async function send() {
    if (!canSend || creating.current.has(selectedSessionId)) return;
    if (!isLocal) { await actions.send(selectedSessionId, draft.text); return; }
    if (!selectedFolder) return;
    const localId = selectedSessionId;
    const input = draft.text;
    creating.current.add(localId);
    setCreatingIds(previous => ({ ...previous, [localId]: true }));
    setCreationErrors(previous => ({ ...previous, [localId]: undefined }));
    try {
      const created = await createSession(selectedFolder.id);
      const id = created.session.id;
      client.setQueryData(["session", id], created);
      client.setQueryData<SessionInfo[]>(["sessions"], previous => [created.session, ...(previous ?? []).filter(info => info.id !== id)]);
      setDrafts(previous => ({ ...previous, [id]: previous[localId] ?? draft, [localId]: emptyDraft }));
      if (selection.current === localId) selectSession(id, false);
      await actions.send(id, input);
    } catch {
      setCreationErrors(previous => ({ ...previous, [localId]: true }));
      void client.invalidateQueries({ queryKey: ["sessions"] });
    } finally {
      creating.current.delete(localId);
      setCreatingIds(previous => ({ ...previous, [localId]: false }));
    }
  }

  return { folders, selectedFolder, selectedSession, selectedSessionId, selectSession, draft, updateDraft,
    newSession, focusRequest, isLocal, index, history, canSend, send, busy, connected, actions,
    submitting: creatingIds[selectedSessionId] || actions.pending?.status === "sending" || actions.pending?.status === "accepted",
    actionError: actions.error ?? (creationErrors[selectedSessionId] ? t("errors:create") : undefined) };
}
