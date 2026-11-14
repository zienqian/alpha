import { useId, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { Folder, FolderOpen, LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/i18n/react";
import { SessionApiError } from "./api";

export function CreateProjectDialog({ open, onOpenChange, onCreate }: {
  open: boolean; onOpenChange: (open: boolean) => void; onCreate: (name: string, path: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [picking, setPicking] = useState(false);
  const working = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const nativePicker = window.alphacodeDesktop?.selectDirectory;
  function updatePath(value: string) {
    setPath(value); setError(undefined);
    if (!name.trim()) setName(value.trim().split(/[\\/]/).filter(Boolean).at(-1) ?? "");
  }
  async function pick() {
    if (!nativePicker || working.current) return;
    working.current = true; setPicking(true); setError(undefined);
    try { const selected = await nativePicker(); if (selected) updatePath(selected); }
    catch { setError(t("workspace:pickFailed")); }
    finally { working.current = false; setPicking(false); }
  }
  async function submit() {
    if (working.current || !name.trim() || !path.trim()) return;
    working.current = true; setPending(true); setError(undefined);
    try {
      await onCreate(name.trim(), path.trim());
      onOpenChange(false); setName(""); setPath("");
    } catch (cause) {
      setError(t(cause instanceof SessionApiError && ["INVALID_DIRECTORY", "DIRECTORY_UNAVAILABLE"].includes(cause.code)
        ? "workspace:invalidDirectory" : cause instanceof SessionApiError && cause.code === "MODEL_REQUIRED"
          ? "workspace:modelRequired" : "workspace:createFailed"));
    } finally { working.current = false; setPending(false); }
  }
  return <Dialog.Root open={open} onOpenChange={value => { if (!working.current) { onOpenChange(value); setError(undefined); } }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30" />
      <Dialog.Content className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-popover p-5 text-popover-foreground shadow-(--overlay-shadow) sm:p-6"
        onOpenAutoFocus={event => { event.preventDefault(); returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; nameInput.current?.focus(); }}
        onCloseAutoFocus={event => { event.preventDefault(); if (returnFocus.current?.isConnected && !returnFocus.current.closest("[inert]")) returnFocus.current.focus(); else document.querySelector<HTMLButtonElement>('[data-slot="sidebar-trigger"]')?.focus(); }}
        onEscapeKeyDown={event => { if (working.current) event.preventDefault(); }} onInteractOutside={event => { if (working.current) event.preventDefault(); }}>
        <div className="mb-5 flex items-center justify-between gap-3">
          <Dialog.Title className="text-lg font-semibold">{t("workspace:createProject")}</Dialog.Title>
          <Dialog.Close asChild><Button variant="ghost" size="icon-sm" disabled={pending || picking} aria-label={t("workspace:closeDialog")}><X aria-hidden="true" /></Button></Dialog.Close>
        </div>
        <Dialog.Description className="sr-only">{t("workspace:projectDescription")}</Dialog.Description>
        <form className="space-y-5" onSubmit={event => { event.preventDefault(); void submit(); }} onKeyDown={event => { if (event.key === "Enter" && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }}>
          <div className="relative">
            <Folder className="pointer-events-none absolute top-1/2 left-3 size-icon -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input ref={nameInput} value={name} onChange={event => { setName(event.target.value); setError(undefined); }} maxLength={100} disabled={pending || picking} className="h-11 pl-10" aria-label={t("workspace:projectName")} placeholder={t("workspace:projectName")} autoComplete="off" />
          </div>
          <div className="space-y-2">
            <label htmlFor={`${id}-path`} className="text-sm font-medium">{t("workspace:sourceFolder")}</label>
            <div className="space-y-3 rounded-xl border bg-background p-4">
              {nativePicker && <Button type="button" variant="outline" size="sm" disabled={pending || picking} onClick={() => void pick()}>
                {picking ? <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" /> : <FolderOpen aria-hidden="true" />}{t("workspace:chooseFolder")}
              </Button>}
              <Input id={`${id}-path`} value={path} onChange={event => { setPath(event.target.value); setError(undefined); }} onBlur={() => updatePath(path)} disabled={pending || picking} maxLength={4096} placeholder={t("workspace:pathPlaceholder")} aria-describedby={`${id}-hint`} aria-invalid={Boolean(error)} autoComplete="off" spellCheck={false} />
              <p id={`${id}-hint`} className="text-xs leading-5 text-muted-foreground">{t(nativePicker ? "workspace:folderHint" : "workspace:browserFolderHint")}</p>
            </div>
          </div>
          {error && <p role="alert" className="text-xs leading-5 text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Dialog.Close asChild><Button type="button" variant="ghost" disabled={pending || picking}>{t("workspace:cancel")}</Button></Dialog.Close>
            <Button type="submit" disabled={pending || picking || !name.trim() || !path.trim()}>{pending && <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" />}{t(pending ? "workspace:creatingProject" : "workspace:createProject")}</Button>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
