import type { HistoryMessage, ProjectInfo, SessionInfo, SessionView, ToolRecord } from "@/features/sessions/api";

export interface SessionMessage {
  id: string;
  role: HistoryMessage["role"];
  content: string;
  note?: string;
  noteCode?: string;
  localResult?: HistoryMessage["localResult"];
  streaming?: boolean;
  tool?: ToolRecord;
  completion?: HistoryMessage["completion"];
}

export interface Session {
  id: string;
  title: string;
  titleStatus?: "pending" | "ready";
  description: string;
  messages: SessionMessage[];
  local?: boolean;
  historyLoaded?: boolean;
}

export function sessionSummary(info: SessionInfo): Session {
  return { id: info.id, title: info.title.trim(), titleStatus: info.titleStatus, description: "", messages: [] };
}

export function sessionFromView(view: SessionView): Session {
  return {
    ...sessionSummary(view.session), historyLoaded: true,
    messages: view.state.messages.map(({ text, ...message }) => ({ ...message, content: text })),
  };
}

export function groupSessions(sessions: readonly SessionInfo[], projects: readonly ProjectInfo[] = []): SessionFolder[] {
  const folders = new Map<string, SessionFolder>();
  for (const session of [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    let folder = folders.get(session.projectId);
    if (!folder) {
      folder = {
        id: session.projectId,
        name: session.workspaceRoot.split(/[\\/]/).filter(Boolean).at(-1) || session.workspaceRoot,
        path: session.workspaceRoot, sessions: [],
        defaultContext: session.defaultContext,
      };
      folders.set(folder.id, folder);
    }
    folder.sessions.push(sessionSummary(session));
  }
  for (const project of projects) {
    const existing = folders.get(project.projectId);
    if (existing) {
      if (project.name) existing.name = project.name;
      existing.defaultContext = project.defaultContext ?? existing.defaultContext;
    }
    if (!folders.has(project.projectId)) folders.set(project.projectId, {
      id: project.projectId,
      name: project.name || project.workspaceRoot.split(/[\\/]/).filter(Boolean).at(-1) || project.workspaceRoot,
      path: project.workspaceRoot, sessions: [],
      defaultContext: project.defaultContext,
    });
  }
  return [...folders.values()];
}

export interface SessionFolder {
  defaultContext?: SessionInfo["defaultContext"];
  id: string;
  name: string;
  path: string;
  sessions: Session[];
}
