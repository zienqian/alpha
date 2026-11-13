import { useTranslation } from "@/i18n/react";
import { FileText, FolderOpen, ListTree, X } from "lucide-react";
import { Popover } from "radix-ui";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import type { Session, SessionFolder } from "@/features/sessions/types";
import type { SessionDraft } from "@/features/sessions/use-session-workspace";

export function SessionContext({ folder, session, draft }: {
  folder?: SessionFolder; session?: Session; draft: SessionDraft;
}) {
  const { t } = useTranslation();
  return (
    <Popover.Root defaultOpen={false}>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("sessions:summary")} title={t("sessions:summary")} className="text-muted-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground">
          <ListTree className="size-3.5" aria-hidden="true" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={4} collisionPadding={12} aria-label={t("sessions:summary")} className="workspace-popover z-50 max-h-[var(--radix-popover-content-available-height)] w-72 max-w-[calc(100vw-24px)] origin-(--radix-popover-content-transform-origin) overflow-y-auto border text-popover-foreground outline-none duration-160 ease-[cubic-bezier(0.16,1,0.3,1)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-98 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-98 data-[state=closed]:duration-100">
          <div className="flex h-10 items-center justify-between border-b px-3">
            <h2 className="text-xs font-medium">{t("sessions:summary")}</h2>
            <Popover.Close asChild><Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={t("sessions:closeSummary")}><X aria-hidden="true" /></Button></Popover.Close>
          </div>
          <div className="space-y-3 border-b p-3">
            <div className="flex items-center gap-2 text-[13px] font-medium"><FolderOpen className="size-3.5 text-muted-foreground" aria-hidden="true" /><span className="truncate">{folder?.name ?? t("workspace:unselected")}</span></div>
            {folder && <div className="flex items-center gap-1 rounded-md bg-muted/60 py-1 pr-1 pl-2"><code className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={folder.path}>{folder.path}</code><CopyButton value={folder.path} label={t("workspace:copyPath")} /></div>}
            <dl className="grid grid-cols-2 gap-y-2 text-xs">
              <dt className="text-muted-foreground">{t("sessions:messageHistory")}</dt><dd className="text-right tabular-nums">{session && !session.local && !session.historyLoaded ? t("sessions:notLoaded") : t("sessions:messageCount", { count: session?.messages.length ?? 0 })}</dd>
              <dt className="text-muted-foreground">{t("sessions:type")}</dt><dd className="text-right">{session && !session.local ? t("sessions:saved") : t("sessions:localDraft")}</dd>
            </dl>
          </div>
          <div className="p-3">
            <h3 className="mb-3 flex items-center justify-between text-xs font-medium">{t("sessions:draftAttachments")}<span className="font-normal text-muted-foreground tabular-nums">{draft.attachments.length}</span></h3>
            {draft.attachments.length ? (
              <ul className="max-h-48 space-y-2 overflow-y-auto">
                {draft.attachments.map(({ id, file }) => <li key={id} className="flex items-center gap-2 text-xs"><FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 flex-1 truncate" title={file.name}>{file.name}</span><span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{file.size < 1024 ? `${file.size} B` : `${Math.ceil(file.size / 1024)} KB`}</span></li>)}
              </ul>
            ) : <p className="text-xs leading-5 text-muted-foreground">{t("sessions:noAttachments")}</p>}
          </div>
          <p className="border-t bg-muted/30 px-3 py-2.5 text-[11px] leading-4 text-muted-foreground">{t("sessions:persistence")}</p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
