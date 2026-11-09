import { ArrowUpRight, MessageSquare } from "lucide-react";
import type { SessionFolder } from "@/features/sessions/types";

export function ContinueSessions({ folder, onSelect }: { folder?: SessionFolder; onSelect: (id: string) => void }) {
  const sessions = folder?.sessions.filter((session) => session.messages.length > 0).slice(0, 3) ?? [];
  if (!sessions.length) return null;
  return (
    <section aria-labelledby="continue-sessions-title" className="mt-9">
      <h2 id="continue-sessions-title" className="mb-2 px-2 text-xs font-medium text-muted-foreground">继续会话</h2>
      <div className="space-y-0.5">
        {sessions.map((session) => (
          <button key={session.id} type="button" aria-label={`继续 ${session.title}`} onClick={() => onSelect(session.id)} className="group flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
            <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-[13px]">{session.title}</span>
            <span className="text-[11px] text-muted-foreground tabular-nums group-hover:hidden group-focus-visible:hidden">{session.messages.length} 条消息</span>
            <ArrowUpRight className="hidden size-3.5 text-muted-foreground group-hover:block group-focus-visible:block" aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  );
}
