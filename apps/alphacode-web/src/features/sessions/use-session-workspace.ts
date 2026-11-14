import { useTranslation } from "@/i18n/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createProject, createSession, type PermissionMode, type ProjectInfo, type SessionInfo, type SessionView } from "@/features/sessions/api";
import { useSessionActions } from "@/features/sessions/use-session-actions";
import { useProjectsQuery, useSessionQuery, useSessionsQuery } from "@/features/sessions/queries";
import { groupSessions, sessionFromView, type Session } from "@/features/sessions/types";
import { preserveReloadDrafts } from "./reload-drafts";
import { createLocalSession, emptyDraft, useSharedWorkspace, useWorkspaceDrafts } from "./workspace-state";
import { useSessionGateway } from "./application/session-gateway-provider";
import { sessionKeys } from "./application/session-cache";
import { useLocation, useNavigate } from "react-router";

export interface DraftAttachment {
  id: string;
  file: File;
}

export interface SessionDraft {
  text: string;
  attachments: DraftAttachment[];
  permissionMode?: PermissionMode;
}

const defaultDraftFolderId = "local-default-workspace";

export function useSessionWorkspace(paneId?: string) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const currentLocation = useRef(location);
  currentLocation.current = location;
  const displaySession = (session: Session): Session => ({ ...session,
    title: session.title.trim() || t("sessions:new"),
    description: t(session.local ? "sessions:draftDescription" : "sessions:savedDescription"),
  });
  const client = useQueryClient();
  const gateway = useSessionGateway();
  const index = useSessionsQuery(Boolean(paneId));
  const projects = useProjectsQuery(Boolean(paneId));
  const shared = useSharedWorkspace();
  const { localSessions, setLocalSessions, setSelectedSessionId, selection, creating, creatingIds, setCreatingIds,
    creationErrors, setCreationErrors, deletedIds, setDeletedIds, openedProjects, setOpenedProjects,
    projectDialogOpen, setProjectDialogOpen, replacements, setReplacements } = shared;
  const selectedSessionId = paneId ?? shared.selectedSessionId;
  const isLocal = localSessions.some((session) => session.id === selectedSessionId);
  const history = useSessionQuery(isLocal ? undefined : selectedSessionId);
  const { drafts, setDrafts } = useWorkspaceDrafts(paneId);
  const hasDraft = (id: string) => Boolean(drafts[id]?.text.trim() || drafts[id]?.attachments.length);
  const projectId = history.data?.session.projectId;
  const workspaceRoot = history.data?.session.workspaceRoot;
  const defaultContext = history.data?.session.defaultContext;
  useEffect(() => {
    if (projectId && workspaceRoot) setOpenedProjects(previous => previous.some(project => project.projectId === projectId && project.workspaceRoot === workspaceRoot && project.defaultContext === defaultContext)
      ? previous : [...previous.filter(project => project.projectId !== projectId), { projectId, workspaceRoot, defaultContext }]);
  }, [projectId, workspaceRoot, defaultContext]);
  // A direct /web link can load its history even if the index request fails.
  // Keep its project usable without inventing a session row for an empty draft.
  const infos = (index.data ?? []).filter(info => !deletedIds.has(info.id));
  const draftViews = Object.keys(drafts).filter(id => hasDraft(id) && !infos.some(info => info.id === id))
    .map(id => client.getQueryData<SessionView>(["session", id]))
    .filter((view): view is SessionView => Boolean(view) && view?.session.id !== history.data?.session.id);
  const views = (history.data ? [...draftViews, history.data] : draftViews).filter(view => !deletedIds.has(view.session.id));
  const emptyRemoteIds = new Set(views.filter(view => !view.state.messages.length && !infos.some(info => info.id === view.session.id))
    .map(view => view.session.id));
  const isWelcome = isLocal || (emptyRemoteIds.has(selectedSessionId) && !history.isError && history.connection !== "error");
  const sourceFolders = groupSessions([
    ...infos.filter(info => !views.some(view => view.session.id === info.id)),
    ...views.map(view => view.session),
  ], [...openedProjects, ...(projects.data ?? [])]);
  const actions = useSessionActions(history.data, selectedSessionId);
  const [focusRequest, setFocusRequest] = useState(0);
  const defaultFolderId = sourceFolders.find(folder => folder.isDefaultWorkspace)?.id ?? defaultDraftFolderId;
  // Keep unsent default-workspace drafts reachable without registering a project.
  const draftFolders = defaultFolderId === defaultDraftFolderId && localSessions.some(session => !session.folderId && (hasDraft(session.id) || session.title))
    ? [{ id: defaultDraftFolderId, name: t("workspace:defaultWorkspace"), path: "", sessions: [], isDefaultWorkspace: true }, ...sourceFolders] : sourceFolders;
  const folders = draftFolders.map((folder) => ({
    ...folder,
    name: folder.isDefaultWorkspace ? t("workspace:defaultWorkspace") : folder.name,
    sessions: [
      ...localSessions.filter((session) => (session.folderId ?? defaultFolderId) === folder.id && (hasDraft(session.id) || session.title)),
      ...folder.sessions.filter(session => !emptyRemoteIds.has(session.id) || hasDraft(session.id))
        .map(session => emptyRemoteIds.has(session.id) ? { ...session, title: "", local: true } : session),
    ].map(session => displaySession(creatingIds[session.id] ? { ...session, titleStatus: "pending" } : session)),
  }));
  const localSession = localSessions.find(session => session.id === selectedSessionId);
  const selectedFolderId = isLocal ? localSession?.folderId ?? defaultFolderId : history.data?.session.projectId;
  const selectedFolder = folders.find(folder => folder.id === selectedFolderId)
    ?? folders.find(folder => folder.sessions.some(session => session.id === selectedSessionId));
  const loadedSession = useMemo(() => history.data ? sessionFromView(history.data) : undefined, [history.data]);
  const selectedSession = isWelcome ? displaySession(localSession ?? createLocalSession(selectedSessionId, selectedFolder?.id))
    : loadedSession ?? selectedFolder?.sessions.find((session) => session.id === selectedSessionId);
  const draft = drafts[selectedSessionId] ?? emptyDraft;

  const previousLocation = useRef(location);
  useEffect(() => {
    if (paneId) return;
    if (previousLocation.current === location) return;
    previousLocation.current = location;
    const localId = location.state?.localSessionId;
    let id = location.pathname === "/"
      ? new URLSearchParams(location.search).get("session") || (localSessions.some(session => session.id === localId) ? localId : "local-initial")
      : location.state?.sessionId;
    if (!id) return;
    if (location.state?.sessionLocal && !localSessions.some(session => session.id === id)) id = "local-initial";
    if (deletedIds.has(id)) {
      id = "local-initial";
      void navigate(location.pathname, { replace: true, state: { localSessionId: id, sessionId: id, sessionLocal: true } });
    }
    if (id === "local-initial" && !localSessions.some(session => session.id === id)) {
      setLocalSessions(previous => [createLocalSession(id), ...previous]);
    }
    if (localSessions.some(session => session.id === id)) setReplacements(previous => {
      if (!previous[id]) return previous;
      const next = { ...previous }; delete next[id]; return next;
    });
    selection.current = id;
    setSelectedSessionId(id);
  }, [location, localSessions, deletedIds, navigate, paneId, selection, setSelectedSessionId, setLocalSessions, setReplacements]);

  function selectSession(id: string, local = localSessions.some((session) => session.id === id), reveal = true, replace = false) {
    const current = currentLocation.current;
    if (!reveal && current.pathname !== "/") {
      // A pending session creation must not pull the user out of settings.
      void navigate(current.pathname, { replace: true, state: { ...current.state, sessionId: id, sessionLocal: local } });
    } else if (id !== selection.current || current.pathname !== "/") {
      void navigate({ pathname: "/", search: local ? "" : `?${new URLSearchParams({ session: id })}` },
        { replace, state: { localSessionId: local ? id : undefined } });
    }
    selection.current = id;
    setSelectedSessionId(id);
  }

  function updateDraft(patch: Partial<SessionDraft>) {
    const id = selectedSessionId;
    setDrafts((previous) => ({ ...previous, [id]: { ...(previous[id] ?? emptyDraft), ...patch } }));
  }

  function newSession(requestedFolderId?: string) {
    const folderId = requestedFolderId === defaultDraftFolderId ? undefined : requestedFolderId;
    if (folderId && !sourceFolders.some((folder) => folder.id === folderId)) return;
    const reusable = localSessions.find((session) => session.folderId === folderId &&
      !session.title && !drafts[session.id]?.text.trim() && !drafts[session.id]?.attachments.length);
    let id = reusable?.id;
    if (reusable) {
      // A reused blank draft starts a new lifetime; its previous server binding
      // must not remap this panel when another conversation receives focus.
      setReplacements(previous => {
        if (!previous[reusable.id]) return previous;
        const next = { ...previous }; delete next[reusable.id]; return next;
      });
      selectSession(reusable.id);
    } else {
      const session = createLocalSession(`local-${crypto.randomUUID()}`, folderId);
      id = session.id;
      setLocalSessions((previous) => [session, ...previous]);
      selectSession(session.id, true);
    }
    setFocusRequest((previous) => previous + 1);
    return id;
  }

  function selectProject(folderId?: string) {
    if (folderId === defaultDraftFolderId) folderId = undefined;
    if (creating.current.has(selectedSessionId) || (folderId && !sourceFolders.some(folder => folder.id === folderId))) return;
    // Only unsent local drafts may move; archived/running sessions keep their cwd.
    if (isLocal) {
      setLocalSessions(previous => previous.map(session => session.id === selectedSessionId ? { ...session, folderId } : session));
      setCreationErrors(previous => ({ ...previous, [selectedSessionId]: undefined }));
      selectSession(selectedSessionId, true);
    } else newSession(folderId);
    setFocusRequest(previous => previous + 1);
  }

  async function addProject(name: string, path: string) {
    const project = await createProject(name, path, isLocal ? localSession?.folderId : selectedFolder?.id);
    client.setQueryData<ProjectInfo[]>(["projects"], previous => [...(previous ?? []).filter(item => item.projectId !== project.projectId), project]);
    setOpenedProjects(previous => [...previous.filter(item => item.projectId !== project.projectId), project]);
    if (isLocal && !creating.current.has(selectedSessionId)) {
      setLocalSessions(previous => previous.map(session => session.id === selectedSessionId ? { ...session, folderId: project.projectId } : session));
      selectSession(selectedSessionId, true);
    } else {
      const session = createLocalSession(`local-${crypto.randomUUID()}`, project.projectId);
      setLocalSessions(previous => [session, ...previous]);
      selectSession(session.id, true);
    }
    setFocusRequest(previous => previous + 1);
    void client.invalidateQueries({ queryKey: ["projects"] });
  }

  async function renameSession(id: string, title: string) {
    if (creating.current.has(id)) return;
    if (localSessions.some(session => session.id === id)) {
      setLocalSessions(previous => previous.map(session => session.id === id ? { ...session, title } : session));
      return;
    }
    const result = await gateway.rename(id, title);
    await client.cancelQueries({ queryKey: sessionKeys.list });
    client.setQueryData<SessionInfo[]>(sessionKeys.list, previous => previous?.map(info => info.id === id ? result.session : info));
    // Refetch detail snapshots to preserve their server sequence ordering.
    await Promise.all([
      client.invalidateQueries({ queryKey: sessionKeys.detail(id) }),
      client.invalidateQueries({ queryKey: sessionKeys.list }),
      client.invalidateQueries({ queryKey: ["session-search"] }),
    ]);
  }

  async function deleteSession(id: string) {
    if (creating.current.has(id)) return;
    const folder = folders.find(folder => folder.sessions.some(session => session.id === id));
    if (!localSessions.some(session => session.id === id)) await gateway.delete(id);
    await client.cancelQueries({ queryKey: sessionKeys.detail(id) });
    await client.cancelQueries({ queryKey: sessionKeys.list });
    setDeletedIds(previous => new Set(previous).add(id));
    setDrafts(previous => { const next = { ...previous }; delete next[id]; return next; });
    setLocalSessions(previous => previous.filter(session => session.id !== id));
    if (folder && folder.id !== defaultDraftFolderId) setOpenedProjects(previous => previous.some(project => project.projectId === folder.id) ? previous
      : [...previous, { projectId: folder.id, workspaceRoot: folder.path, defaultContext: folder.defaultContext }]);
    if (selection.current === id) {
      const next = createLocalSession(`local-${crypto.randomUUID()}`, folder?.id === defaultDraftFolderId ? undefined : folder?.id);
      setLocalSessions(previous => [next, ...previous]);
      selectSession(next.id, true);
      setFocusRequest(previous => previous + 1);
    }
    client.setQueryData<SessionInfo[]>(sessionKeys.list, previous => previous?.filter(info => info.id !== id));
    client.removeQueries({ queryKey: sessionKeys.detail(id) });
    void client.invalidateQueries({ queryKey: sessionKeys.list });
    void client.invalidateQueries({ queryKey: ["session-search"] });
  }

  const connected = history.connection === "connected";
  const busy = Boolean(history.data?.state.busy);
  const permissionMode = isLocal ? draft.permissionMode ?? "ask" : history.data?.state.permissionMode;
  const canChangePermission = !creatingIds[selectedSessionId] && !actions.pending && !actions.controlling
    && (isLocal || connected && Boolean(history.data?.state.canSend)
      && !busy && !history.data?.state.queuedRequests?.length && !history.data?.state.closing && !history.data?.state.settingsSaving && !history.data?.state.approval);
  function changePermission(mode: PermissionMode) {
    if (!canChangePermission) return;
    if (isLocal) updateDraft({ permissionMode: mode });
    else void actions.setPermissionMode(selectedSessionId, mode);
  }
  const canSend = Boolean(draft.text.trim()) && !draft.attachments.length && !actions.pending
    && !actions.controlling && !creatingIds[selectedSessionId] && (isLocal ? !localSession?.folderId || Boolean(selectedFolder) : connected
      && Boolean(history.data?.state.canQueue || (!busy && history.data?.state.canSend))
      && !history.data?.state.closing && !history.data?.state.settingsSaving);

  async function send() {
    if (!canSend || creating.current.has(selectedSessionId)) return;
    if (!isLocal) { await actions.send(selectedSessionId, draft.text); return; }
    const localId = selectedSessionId;
    const input = draft.text;
    creating.current.add(localId);
    setCreatingIds(previous => ({ ...previous, [localId]: true }));
    setCreationErrors(previous => ({ ...previous, [localId]: undefined }));
    try {
      const created = await createSession(localSession?.folderId);
      const id = created.session.id;
      client.setQueryData(["session", id], created);
      client.setQueryData<SessionInfo[]>(["sessions"], previous => [created.session, ...(previous ?? []).filter(info => info.id !== id)]);
      if (!localSession?.folderId) client.setQueryData<ProjectInfo[]>(["projects"], previous => [
        ...(previous ?? []).map(project => ({ ...project, isDefaultWorkspace: false })).filter(project => project.projectId !== created.session.projectId),
        { projectId: created.session.projectId, workspaceRoot: created.session.workspaceRoot, defaultContext: created.session.defaultContext, isDefaultWorkspace: true },
      ]);
      void client.invalidateQueries({ queryKey: ["projects"] });
      setDrafts(previous => ({ ...previous, [id]: previous[localId] ?? draft, [localId]: emptyDraft }));
      setReplacements(previous => ({ ...previous, [localId]: id }));
      setLocalSessions(previous => previous.map(session => session.id === localId ? { ...session, title: "" } : session));
      if (selection.current === localId) selectSession(id, false, false);
      const customTitle = localSessions.find(session => session.id === localId)?.title;
      if (customTitle) await renameSession(id, customTitle);
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

  useEffect(() => {
    if (paneId || !import.meta.hot || import.meta.env.MODE === "test") return;
    // Fast Refresh keeps React state. For Vite's full-reload fallback, preserve
    // text drafts only when no unresolved action would be lost or replayed.
    const preserve = () => {
      if (actions.canRefresh && !Object.values(creatingIds).some(Boolean)) {
        preserveReloadDrafts({ selectedSessionId, localSessions: localSessions.map(({ id, folderId, title }) => ({ id, folderId, title })), drafts });
      }
    };
    import.meta.hot.on("vite:beforeFullReload", preserve);
    return () => import.meta.hot?.off("vite:beforeFullReload", preserve);
  }, [selectedSessionId, localSessions, drafts, creatingIds, actions.canRefresh, paneId]);

  return { folders, selectedFolder, selectedSession, selectedSessionId, selectSession, draft, updateDraft, replacements, deletedIds,
    projects, selectProject, addProject, projectDialogOpen, setProjectDialogOpen,
    newSession, renameSession, deleteSession, creatingIds, focusRequest, isLocal, isWelcome, index, history, canSend, send, busy, connected, actions,
    permissionMode, canChangePermission, changePermission,
    submitting: creatingIds[selectedSessionId] || actions.pending?.status === "sending" || actions.pending?.status === "accepted",
    actionError: actions.error ?? (creationErrors[selectedSessionId] ? t("errors:create") : undefined) };
}

export type SessionWorkspace = ReturnType<typeof useSessionWorkspace>;
