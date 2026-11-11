import { useTranslation } from "@/i18n/react";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createSession, type PermissionMode, type SessionInfo, type SessionView } from "@/features/sessions/api";
import { useSessionActions } from "@/features/sessions/use-session-actions";
import { useSessionQuery, useSessionsQuery } from "@/features/sessions/queries";
import { groupSessions, sessionFromView, type Session } from "@/features/sessions/types";
import { clearReloadDrafts, preserveReloadDrafts, readReloadDrafts } from "./reload-drafts";

export interface DraftAttachment {
  id: string;
  file: File;
}

export interface SessionDraft {
  text: string;
  attachments: DraftAttachment[];
  permissionMode?: PermissionMode;
}

const emptyDraft: SessionDraft = { text: "", attachments: [] };
type LocalSession = Session & { folderId?: string };

function createLocalSession(id: string, folderId?: string): LocalSession {
  return { id, folderId, title: "", description: "", messages: [], local: true };
}

export function useSessionWorkspace() {
  const { t } = useTranslation();
  const displaySession = (session: Session): Session => ({ ...session,
    title: session.title.trim() || t("sessions:new"),
    description: t(session.local ? "sessions:draftDescription" : "sessions:savedDescription"),
  });
  const client = useQueryClient();
  const index = useSessionsQuery();
  const [reloadDrafts] = useState(readReloadDrafts);
  useEffect(clearReloadDrafts, []);
  const [localSessions, setLocalSessions] = useState<LocalSession[]>(() => reloadDrafts?.localSessions.map(item => createLocalSession(item.id, item.folderId)) ?? [createLocalSession("local-initial")]);
  const [selectedSessionId, setSelectedSessionId] = useState(() =>
    new URL(window.location.href).searchParams.get("session") || reloadDrafts?.selectedSessionId || "local-initial",
  );
  const isLocal = localSessions.some((session) => session.id === selectedSessionId);
  const history = useSessionQuery(isLocal ? undefined : selectedSessionId);
  const [drafts, setDrafts] = useState<Record<string, SessionDraft>>(() => reloadDrafts?.drafts ?? {});
  const hasDraft = (id: string) => Boolean(drafts[id]?.text.trim() || drafts[id]?.attachments.length);
  const projectId = history.data?.session.projectId;
  const workspaceRoot = history.data?.session.workspaceRoot;
  const [openedProjects, setOpenedProjects] = useState<Pick<SessionInfo, "projectId" | "workspaceRoot">[]>([]);
  useEffect(() => {
    if (projectId && workspaceRoot) setOpenedProjects(previous => previous.some(project => project.projectId === projectId && project.workspaceRoot === workspaceRoot)
      ? previous : [...previous.filter(project => project.projectId !== projectId), { projectId, workspaceRoot }]);
  }, [projectId, workspaceRoot]);
  // A direct /web link can load its history even if the index request fails.
  // Keep its project usable without inventing a session row for an empty draft.
  const infos = index.data ?? [];
  const draftViews = Object.keys(drafts).filter(id => hasDraft(id) && !infos.some(info => info.id === id))
    .map(id => client.getQueryData<SessionView>(["session", id]))
    .filter((view): view is SessionView => Boolean(view) && view?.session.id !== history.data?.session.id);
  const views = history.data ? [...draftViews, history.data] : draftViews;
  const emptyRemoteIds = new Set(views.filter(view => !view.state.messages.length && !infos.some(info => info.id === view.session.id))
    .map(view => view.session.id));
  const isWelcome = isLocal || (emptyRemoteIds.has(selectedSessionId) && !history.isError && history.connection !== "error");
  const sourceFolders = groupSessions([
    ...infos.filter(info => !views.some(view => view.session.id === info.id)),
    ...views.map(view => view.session),
  ], openedProjects);
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
      ...localSessions.filter((session) => (session.folderId ?? sourceFolders[0]?.id) === folder.id && hasDraft(session.id)),
      ...folder.sessions.filter(session => !emptyRemoteIds.has(session.id) || hasDraft(session.id))
        .map(session => emptyRemoteIds.has(session.id) ? { ...session, title: "", local: true } : session),
    ].map(session => displaySession(creatingIds[session.id] ? { ...session, titleStatus: "pending" } : session)),
  }));
  const localSession = localSessions.find(session => session.id === selectedSessionId);
  const selectedFolderId = isLocal ? localSession?.folderId ?? sourceFolders[0]?.id : history.data?.session.projectId;
  const selectedFolder = folders.find(folder => folder.id === selectedFolderId)
    ?? folders.find(folder => folder.sessions.some(session => session.id === selectedSessionId));
  const selectedSession = isWelcome ? displaySession(localSession ?? createLocalSession(selectedSessionId, selectedFolder?.id))
    : history.data ? displaySession(sessionFromView(history.data))
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
  const permissionMode = isLocal ? draft.permissionMode ?? "ask" : history.data?.state.permissionMode;
  const canChangePermission = !creatingIds[selectedSessionId] && !actions.pending && !actions.controlling
    && (isLocal ? Boolean(selectedFolder) : connected && Boolean(history.data?.state.canSend)
      && !busy && !history.data?.state.closing && !history.data?.state.settingsSaving && !history.data?.state.approval);
  function changePermission(mode: PermissionMode) {
    if (!canChangePermission) return;
    if (isLocal) updateDraft({ permissionMode: mode });
    else void actions.setPermissionMode(selectedSessionId, mode);
  }
  const canSend = Boolean(draft.text.trim()) && !draft.attachments.length && !actions.pending
    && !actions.controlling && !creatingIds[selectedSessionId] && (isLocal ? Boolean(selectedFolder) : connected && Boolean(history.data?.state.canSend)
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
      // Apply the draft's displayed choice before admitting its first message.
      // A failed save keeps the draft in the new session and never starts a run.
      if (!await actions.setPermissionMode(id, draft.permissionMode ?? "ask")) return;
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
    preserveDrafts: () => preserveReloadDrafts({ selectedSessionId, localSessions: localSessions.map(({ id, folderId }) => ({ id, folderId })), drafts }),
    canRefresh: actions.canRefresh && !Object.values(creatingIds).some(Boolean),
    newSession, focusRequest, isLocal, isWelcome, index, history, canSend, send, busy, connected, actions,
    permissionMode, canChangePermission, changePermission,
    submitting: creatingIds[selectedSessionId] || actions.pending?.status === "sending" || actions.pending?.status === "accepted",
    actionError: actions.error ?? (creationErrors[selectedSessionId] ? t("errors:create") : undefined) };
}
