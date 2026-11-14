import { useRef, useState } from "react";
import { AlertDialog } from "radix-ui";
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
    <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5 text-muted-foreground md:opacity-0 md:group-hover/folder-header:opacity-100 md:group-has-[:focus-visible]/folder-header:opacity-100 has-[[data-state=open]]:opacity-100 [@media(hover:none)]:opacity-100">
      <Button variant="ghost" size="icon-xs" className="size-7 md:size-6" disabled={pending}
        aria-label={t("workspace:createIn", { name: folder.name })} onClick={onNewSession}><Plus aria-hidden="true" /></Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button ref={trigger} variant="ghost" size="icon-xs" className="size-7 md:size-6" disabled={pending}
            aria-label={t("workspace:projectMenu", { name: folder.name })}><MoreHorizontal aria-hidden="true" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onCloseAutoFocus={event => { if (confirming) event.preventDefault(); }}>
          <DropdownMenuItem variant="destructive" onSelect={() => { setError(undefined); setConfirming(true); }}>
            <Trash2 aria-hidden="true" />{t("workspace:deleteProject")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <AlertDialog.Root open={confirming} onOpenChange={open => { if (!pending) { setConfirming(open); setError(undefined); } }}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-xl bg-popover p-5 text-popover-foreground shadow-lg"
          onEscapeKeyDown={event => { if (pending) event.preventDefault(); }}
          onCloseAutoFocus={event => {
            event.preventDefault();
            (trigger.current ?? document.querySelector<HTMLButtonElement>('[data-create-project]'))?.focus();
          }}>
          <AlertDialog.Title className="text-base font-medium">{t("workspace:deleteTitle", { name: folder.name })}</AlertDialog.Title>
          <AlertDialog.Description className="text-sm leading-6 break-words text-muted-foreground">{t("workspace:deleteDescription")}</AlertDialog.Description>
          {error && <p role="alert" className="text-xs leading-5 text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <AlertDialog.Cancel asChild><Button variant="outline" disabled={pending}>{t("workspace:cancel")}</Button></AlertDialog.Cancel>
            <Button variant="destructive" disabled={pending} onClick={() => void remove()}>{t(pending ? "workspace:deletingProject" : "workspace:deleteProject")}</Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  </>;
}
