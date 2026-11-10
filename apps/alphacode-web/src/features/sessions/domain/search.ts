import type { SessionInfo, SessionSearchResult } from "@/features/sessions/api";
import type { SessionFolder } from "@/features/sessions/types";

// Local/recent results need no fabricated server timestamps or project records.
export interface SessionSearchItem {
  session: Pick<SessionInfo, "id" | "title" | "workspaceRoot" | "status">;
  snippets: SessionSearchResult["snippets"];
  matchCount: number;
}

export function recentSessionResults(folders: readonly SessionFolder[]): SessionSearchItem[] {
  return folders.flatMap(folder => folder.sessions.filter(session => !session.local).map(session => ({
    session: { id: session.id, title: session.title, workspaceRoot: folder.path, status: "" },
    snippets: [], matchCount: 0,
  }))).slice(0, 8);
}

export function localSessionResults(folders: readonly SessionFolder[], query: string): SessionSearchItem[] {
  if (!query) return [];
  const normalized = query.toLowerCase();
  return folders.flatMap(folder => folder.sessions.filter(session => session.local &&
    `${session.title}\n${folder.path}`.toLowerCase().includes(normalized)).map(session => ({
    session: { id: session.id, title: session.title, workspaceRoot: folder.path, status: "local" },
    snippets: [], matchCount: 0,
  })));
}
