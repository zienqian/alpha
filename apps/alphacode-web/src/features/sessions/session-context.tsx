import { useTranslation } from "@/i18n/react";
import { FileText, FolderOpen, ListTree, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger, PopoverClose } from "@/components/ui/popover";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import type { Session, SessionFolder } from "@/features/sessions/types";
import type { SessionDraft } from "@/features/sessions/use-session-workspace";

export function SessionContext({ folder, session, draft }: {
  folder?: SessionFolder; session?: Session; draft: SessionDraft;
}) {
  const { t } = useTranslation();
  return (
    <Popover defaultOpen={false}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("sessions:summary")} title={t("sessions:summary")}
          className="text-muted-foreground hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground">
          <ListTree className="size-icon" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} collisionPadding={12} aria-label={t("sessions:summary")}
        className="workspace-popover max-h-[var(--radix-popover-content-available-height)] w-76 max-w-[calc(100vw-24px)] overflow-y-auto p-0">
        <div className="flex h-10 items-center justify-between border-b border-separator px-3.5">
          <h2 className="text-xs font-semibold tracking-[-0.01em] text-foreground">{t("sessions:summary")}</h2>
          <PopoverClose asChild><Button variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-foreground" aria-label={t("sessions:closeSummary")}><X aria-hidden="true" /></Button></PopoverClose>
        </div>
        <div className="space-y-3 border-b border-separator p-3.5">
          <div className="flex items-center gap-2 text-[0.8125rem] font-medium text-foreground"><FolderOpen className="size-icon text-muted-foreground" aria-hidden="true" /><span className="truncate">{folder?.name ?? t("workspace:unselected")}</span></div>
          {folder && <div className="flex items-center gap-1 rounded-lg bg-muted py-1 pe-1 ps-2.5 ring-1 ring-foreground/5 dark:ring-foreground/10"><code className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-muted-foreground" title={folder.path}>{folder.path}</code><CopyButton value={folder.path} label={t("workspace:copyPath")} /></div>}
          <dl className="grid grid-cols-2 gap-y-2 text-xs">
            <dt className="text-muted-foreground">{t("sessions:messageHistory")}</dt><dd className="text-end font-medium text-foreground tabular-nums">{session && !session.local && !session.historyLoaded ? t("sessions:notLoaded") : t("sessions:messageCount", { count: session?.messages.length ?? 0 })}</dd>
            <dt className="text-muted-foreground">{t("sessions:type")}</dt><dd className="text-end text-foreground">{session && !session.local ? t("sessions:saved") : t("sessions:localDraft")}</dd>
          </dl>
        </div>
        <div className="p-3.5">
          <h3 className="mb-2.5 flex items-center justify-between text-xs font-medium text-foreground">{t("sessions:draftAttachments")}<span className="font-normal text-muted-foreground tabular-nums">{draft.attachments.length}</span></h3>
          {draft.attachments.length ? (
            <ul className="max-h-48 space-y-2 overflow-y-auto">
              {draft.attachments.map(({ id, file }) => <li key={id} className="flex items-center gap-2 text-xs"><FileText className="size-icon shrink-0 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 flex-1 truncate" title={file.name}>{file.name}</span><span className="shrink-0 font-mono text-[0.6875rem] text-muted-foreground tabular-nums">{file.size < 1024 ? `${file.size} B` : `${Math.ceil(file.size / 1024)} KB`}</span></li>)}
            </ul>
          ) : <p className="text-xs leading-[1.45] text-muted-foreground">{t("sessions:noAttachments")}</p>}
        </div>
        <p className="border-t border-separator bg-surface-sunken/70 px-3.5 py-2.5 text-[0.6875rem] leading-[1.45] text-muted-foreground dark:bg-background/40">{t("sessions:persistence")}</p>
      </PopoverContent>
    </Popover>
  );
}
