import { useTranslation } from "@/i18n/react";
import { ArrowUpRight, MessageSquare } from "lucide-react";
import type { SessionFolder } from "@/features/sessions/types";

export function ContinueSessions({ folder, onSelect }: { folder?: SessionFolder; onSelect: (id: string) => void }) {
  const { t } = useTranslation();
  const sessions = folder?.sessions.filter((session) => !session.local).slice(0, 3) ?? [];
  if (!sessions.length) return null;
  return (
    <section aria-labelledby="continue-sessions-title" className="mt-9">
      <h2 id="continue-sessions-title" className="mb-2 px-2 text-xs font-medium text-muted-foreground">{t("sessions:continue")}</h2>
      <div className="space-y-0.5">
        {sessions.map((session) => (
          <button key={session.id} type="button" aria-label={t("sessions:continueNamed", { title: session.title })} onClick={() => onSelect(session.id)} className="group flex min-h-9 items-center gap-2 rounded-md px-2 py-1 text-left outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 md:min-h-8">
            <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-[13px]">{session.title}</span>
            <span className="relative flex shrink-0 items-center justify-end text-[11px] text-muted-foreground">
              <span className="group-hover:invisible group-focus-visible:invisible">{t("sessions:viewHistory")}</span>
              <ArrowUpRight className="absolute right-0 size-3.5 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
