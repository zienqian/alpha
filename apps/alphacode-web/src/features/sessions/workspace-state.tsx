import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PropsWithChildren } from "react";
import { useLocation } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { SessionInfo, SessionView } from "./api";
import type { Session } from "./types";
import type { SessionDraft } from "./use-session-workspace";
import { clearReloadDrafts, readReloadDrafts } from "./reload-drafts";
import { SessionCommands } from "./application/session-commands";
import { cacheSession, sessionKeys } from "./application/session-cache";
import { useSessionGateway } from "./application/session-gateway-provider";

export type LocalSession = Session & { folderId?: string };
export const emptyDraft: SessionDraft = { text: "", attachments: [] };
export function createLocalSession(id: string, folderId?: string): LocalSession {
  return { id, folderId, title: "", description: "", messages: [], local: true };
}

class DraftStore {
  private listeners = new Set<() => void>();
  constructor(private drafts: Record<string, SessionDraft>) {}
  get = () => this.drafts;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  set = (update: (previous: Record<string, SessionDraft>) => Record<string, SessionDraft>) => {
    const next = update(this.drafts);
    if (next === this.drafts) return;
    this.drafts = next;
    this.listeners.forEach(listener => listener());
  };
}

function useWorkspaceState() {
  const location = useLocation();
  const client = useQueryClient();
  const gateway = useSessionGateway();
  const [reload] = useState(readReloadDrafts);
  useEffect(clearReloadDrafts, []);
  const [draftStore] = useState(() => new DraftStore(reload?.drafts ?? {}));
  const [localSessions, setLocalSessions] = useState<LocalSession[]>(() => reload?.localSessions.map(item => ({ ...createLocalSession(item.id, item.folderId), title: item.title ?? "" })) ?? [createLocalSession("local-initial")]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>(() => new URLSearchParams(location.search).get("session")
    || ((!location.state?.sessionLocal || localSessions.some(item => item.id === location.state?.sessionId)) ? location.state?.sessionId : undefined)
    || reload?.selectedSessionId || "local-initial");
  const selection = useRef(selectedSessionId);
  const creating = useRef(new Set<string>());
  const [creatingIds, setCreatingIds] = useState<Record<string, boolean>>({});
  const [creationErrors, setCreationErrors] = useState<Record<string, boolean | undefined>>({});
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());
  const [removedProjects, setRemovedProjects] = useState<Record<string, string[]>>({});
  const [openedProjects, setOpenedProjects] = useState<Pick<SessionInfo, "projectId" | "workspaceRoot" | "defaultContext">[]>([]);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [replacements, setReplacements] = useState<Record<string, string>>({});
  const commands = useMemo(() => new SessionCommands(gateway, {
    get: id => client.getQueryData<SessionView>(sessionKeys.detail(id)),
    write: view => cacheSession(client, view),
    invalidateList: () => { void client.invalidateQueries({ queryKey: sessionKeys.list }); },
  }, (id, input) => draftStore.set(previous => previous[id]?.text === input
    ? { ...previous, [id]: { ...previous[id], text: "" } } : previous)), [client, gateway, draftStore]);
  return { localSessions, setLocalSessions, selectedSessionId, setSelectedSessionId, selection, creating,
    creatingIds, setCreatingIds, creationErrors, setCreationErrors, deletedIds, setDeletedIds, removedProjects, setRemovedProjects,
    openedProjects, setOpenedProjects, projectDialogOpen, setProjectDialogOpen, replacements, setReplacements, draftStore, commands };
}

const WorkspaceStateContext = createContext<ReturnType<typeof useWorkspaceState> | null>(null);
export function SessionWorkspaceProvider({ children }: PropsWithChildren) {
  const state = useWorkspaceState();
  return <WorkspaceStateContext value={state}>{children}</WorkspaceStateContext>;
}
export function useSharedWorkspace() {
  const state = useContext(WorkspaceStateContext);
  if (!state) throw new Error("WORKSPACE_STATE_REQUIRED");
  return state;
}
export function useWorkspaceDrafts(id?: string) {
  const { draftStore } = useSharedWorkspace();
  useSyncExternalStore(draftStore.subscribe, () => id ? draftStore.get()[id] ?? emptyDraft : draftStore.get());
  return { drafts: draftStore.get(), setDrafts: draftStore.set };
}
