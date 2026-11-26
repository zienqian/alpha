import { useRef, useState } from "react";
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useTranslation } from "@/i18n/react";
import { SessionApiError } from "./api";
import type { SessionFolder } from "./types";

export function ProjectActions({ folder, onNewSession, onDelete }: {
  folder: SessionFolder;
  onNewSession: () => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const working = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);

  async function remove() {
    if (working.current) return;
    working.current = true;
    setPending(true);
    setError(undefined);
    try {
      await onDelete(folder.id);
      setConfirming(false);
    } catch (cause) {
      setError(t(cause instanceof SessionApiError && cause.code === "PROJECT_BUSY" ? "workspace:deleteBusy" : "workspace:deleteFailed"));
    } finally { working.current = false; setPending(false); }
  }

  return <>
    <div className="absolute top-1/2 end-1 flex -translate-y-1/2 items-center gap-0.5 text-muted-foreground md:opacity-0 md:group-hover/folder-header:opacity-100 md:group-has-[:focus-visible]/folder-header:opacity-100 has-[[data-state=open]]:opacity-100 [@media(hover:none)]:opacity-100">
      <Button variant="ghost" size="icon-xs" className="size-7 hover:text-foreground md:size-6" disabled={pending}
        aria-label={t("workspace:createIn", { name: folder.name })} onClick={onNewSession}><Plus aria-hidden="true" /></Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button ref={trigger} variant="ghost" size="icon-xs" className="size-7 hover:text-foreground md:size-6" disabled={pending}
            aria-label={t("workspace:projectMenu", { name: folder.name })}><MoreHorizontal aria-hidden="true" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onCloseAutoFocus={event => { if (confirming) event.preventDefault(); }}>
          <DropdownMenuItem variant="destructive" onSelect={() => { setError(undefined); setConfirming(true); }}>
            <Trash2 aria-hidden="true" />{t("workspace:deleteProject")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <AlertDialog open={confirming} onOpenChange={open => { if (!pending) { setConfirming(open); setError(undefined); } }}>
      <AlertDialogContent size="sm" className="block space-y-4 p-5"
        onEscapeKeyDown={event => { if (pending) event.preventDefault(); }}
        onCloseAutoFocus={event => {
          event.preventDefault();
          (trigger.current ?? document.querySelector<HTMLButtonElement>('[data-create-project]'))?.focus();
        }}>
        <AlertDialogTitle className="text-base leading-[1.35] font-semibold tracking-[-0.015em]">{t("workspace:deleteTitle", { name: folder.name })}</AlertDialogTitle>
        <AlertDialogDescription className="text-[0.8125rem] leading-[1.55] break-words text-muted-foreground">{t("workspace:deleteDescription")}</AlertDialogDescription>
        {error && <p role="alert" className="text-xs leading-[1.45] text-status-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <AlertDialogCancel size="sm" disabled={pending}>{t("workspace:cancel")}</AlertDialogCancel>
          <Button variant="destructive" size="sm" disabled={pending} onClick={() => void remove()}>{t(pending ? "workspace:deletingProject" : "workspace:deleteProject")}</Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
