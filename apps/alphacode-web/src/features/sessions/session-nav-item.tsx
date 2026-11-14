import { useRef, useState } from "react";
import { AlertDialog } from "radix-ui";
import { Check, PanelsTopLeft, MoreHorizontal, Pencil, Trash2, X } from "lucide-react";
import { useExperimentalFeatures } from "@/features/settings/experimental-features";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SidebarMenuSubButton } from "@/components/ui/sidebar";
import { useTranslation } from "@/i18n/react";
import { SessionApiError } from "./api";
import { SessionTitle } from "./session-title";
import type { Session } from "./types";

export function SessionNavItem({ session, active, disabled, onSelect, onRename, onDelete, onAddToCanvas }: {
  session: Session;
  active: boolean;
  disabled?: boolean;
  onSelect: () => void;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onAddToCanvas?: () => void;
}) {
  const { t } = useTranslation();
  const experiments = useExperimentalFeatures();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(session.title);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const working = useRef(false);
  const menu = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const focusEditor = useRef(false);

  async function submit(action: "rename" | "delete") {
    if (working.current || disabled || (action === "rename" && !title.trim())) return;
    working.current = true;
    setPending(true);
    setError(undefined);
    try {
      if (action === "rename") await onRename(session.id, title.trim());
      else await onDelete(session.id);
      setEditing(false);
      setConfirming(false);
      if (action === "rename") requestAnimationFrame(() => menu.current?.focus());
    } catch (cause) {
      setError(cause instanceof SessionApiError && cause.code === "SESSION_BUSY" ? t("sessions:manageBusy")
        : cause instanceof SessionApiError && cause.code === "INVALID_TITLE" ? t("sessions:invalidTitle")
        : t(action === "rename" ? "sessions:renameFailed" : "sessions:deleteFailed"));
    } finally { working.current = false; setPending(false); }
  }

  return <>
    <div className="group/session-row relative">
      {editing ? <form className="flex min-h-9 items-center gap-1 md:min-h-8" onSubmit={event => { event.preventDefault(); void submit("rename"); }}>
        <Input ref={input} value={title} maxLength={200} disabled={pending} aria-label={t("sessions:titleLabel")}
          aria-invalid={Boolean(error)} className="h-8 min-w-0 px-2 md:text-[13px]"
          onChange={event => { setTitle(event.target.value); setError(undefined); }}
          onKeyDown={event => {
            if (event.key === "Enter" && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault();
            if (event.key === "Escape" && !pending && !event.nativeEvent.isComposing) {
              event.preventDefault(); event.stopPropagation(); setEditing(false); setError(undefined);
              requestAnimationFrame(() => menu.current?.focus());
            }
          }} />
        <Button type="submit" variant="ghost" size="icon-sm" disabled={pending || !title.trim()} aria-label={t("sessions:saveEdit")}><Check aria-hidden="true" /></Button>
        <Button type="button" variant="ghost" size="icon-sm" disabled={pending} aria-label={t("sessions:cancelEdit")}
          onClick={() => { setEditing(false); setError(undefined); requestAnimationFrame(() => menu.current?.focus()); }}><X aria-hidden="true" /></Button>
      </form> : <>
        <SidebarMenuSubButton asChild isActive={active}
          className="session-nav-item h-9 w-full translate-x-0 rounded-lg px-9 text-[13px] text-sidebar-foreground/80 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground md:h-8">
          <button type="button" title={session.title} aria-label={session.title} aria-current={active ? "page" : undefined} onClick={onSelect}
            data-canvas-draggable={Boolean(onAddToCanvas) && !disabled || undefined}
            onPointerDown={event => {
              // Keep touch scrolling in the sidebar; its menu remains an add alternative.
              if (onAddToCanvas && !disabled && event.pointerType !== "touch") experiments.sessionDragHandler.current?.(event, session.id);
            }}>
            <SessionTitle title={session.title} pending={session.titleStatus === "pending"} />
          </button>
        </SidebarMenuSubButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button ref={menu} variant="ghost" size="icon-sm" disabled={disabled}
              className="absolute top-1/2 right-0.5 -translate-y-1/2 text-muted-foreground md:opacity-0 md:group-hover/session-row:opacity-100 md:group-focus-within/session-row:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
              aria-label={t("sessions:sessionMenu", { title: session.title })}><MoreHorizontal aria-hidden="true" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onCloseAutoFocus={event => {
            if (focusEditor.current) { event.preventDefault(); focusEditor.current = false; input.current?.focus(); input.current?.select(); }
            if (confirming) event.preventDefault();
          }}>
            {onAddToCanvas && <DropdownMenuItem onSelect={onAddToCanvas}><PanelsTopLeft aria-hidden="true" />{t("sessions:canvas.add")}</DropdownMenuItem>}
            <DropdownMenuItem onSelect={() => { setTitle(session.title); setError(undefined); focusEditor.current = true; setEditing(true); }}><Pencil aria-hidden="true" />{t("sessions:rename")}</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => { setError(undefined); setConfirming(true); }}><Trash2 aria-hidden="true" />{t("sessions:delete")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </>}
    </div>
    {editing && error && <p role="alert" className="px-2 py-1 text-xs leading-5 text-destructive">{error}</p>}
    <AlertDialog.Root open={confirming} onOpenChange={open => { if (!pending) { setConfirming(open); setError(undefined); } }}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-xl bg-popover p-5 text-popover-foreground shadow-lg"
          onEscapeKeyDown={event => { if (pending) event.preventDefault(); }}
          onCloseAutoFocus={event => {
            event.preventDefault();
            const target = menu.current ?? document.querySelector<HTMLButtonElement>('.session-nav-item[aria-current="page"]');
            target?.focus();
          }}>
          <AlertDialog.Title className="text-base font-medium">{t("sessions:deleteTitle")}</AlertDialog.Title>
          <AlertDialog.Description className="text-sm leading-6 break-words text-muted-foreground">{t("sessions:deleteDescription", { title: session.title })}</AlertDialog.Description>
          {error && <p role="alert" className="text-xs leading-5 text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <AlertDialog.Cancel asChild><Button variant="outline" disabled={pending}>{t("sessions:cancelEdit")}</Button></AlertDialog.Cancel>
            <Button variant="destructive" disabled={pending} onClick={() => void submit("delete")}>{t(pending ? "sessions:deleting" : "sessions:delete")}</Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  </>;
}
