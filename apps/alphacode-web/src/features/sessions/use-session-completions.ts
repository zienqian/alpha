import { useEffect, useRef, useState } from "react";
import type { SessionFolder } from "./types";

export function useSessionCompletions(folders: readonly SessionFolder[]) {
  const previous = useRef(new Map<string, string | undefined>());
  const [completed, setCompleted] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const statuses = new Map(folders.flatMap(folder => folder.sessions.map(session => [session.id, session.status] as const)));
    const finished = new Set<string>();
    for (const [id, status] of statuses) {
      if (previous.current.get(id) === "running" && status === "ready") finished.add(id);
    }
    previous.current = statuses;
    setCompleted(current => {
      const next = new Set([...current].filter(id => statuses.has(id) && statuses.get(id) !== "running"));
      finished.forEach(id => next.add(id));
      return next.size === current.size && [...next].every(id => current.has(id)) ? current : next;
    });
  }, [folders]);

  function markRead(id: string) {
    setCompleted(current => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }

  return { completed, markRead };
}
