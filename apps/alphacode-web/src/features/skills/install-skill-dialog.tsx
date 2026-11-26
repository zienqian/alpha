import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, LoaderCircle, RefreshCw, ShieldAlert, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTranslation } from "@/i18n/react";
import { cn } from "@/lib/utils";
import { SkillApiError, skillError, type SkillDirectory, type SkillInstallation } from "./api";

const selectClass = "h-9 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 md:text-xs";

export function InstallSkillDialog({
  open,
  projectId,
  directories,
  initialFile,
  isPending,
  error,
  onOpenChange,
  onResetError,
  onInstall,
}: {
  open: boolean;
  projectId: string | undefined;
  directories: SkillDirectory[];
  initialFile?: File;
  isPending: boolean;
  error: unknown;
  onOpenChange: (open: boolean) => void;
  onResetError: () => void;
  onInstall: (input: { projectId?: string; directoryId: string; file?: File; url?: string; overwrite?: boolean }) => Promise<SkillInstallation>;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"zip" | "link">("zip");
  const [directoryId, setDirectoryId] = useState("user-local");
  const [file, setFile] = useState<File>();
  const [url, setUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const enabledDirectories = directories.filter(item => item.enabled);
  const directory = enabledDirectories.find(item => item.id === directoryId)
    ?? enabledDirectories.find(item => item.id === "user-local")
    ?? enabledDirectories[0];

  const isConflict = error instanceof SkillApiError && error.code === "SKILL_NAME_CONFLICT";

  useEffect(() => {
    if (open && initialFile) {
      setMode("zip");
      setFile(initialFile);
      onResetError();
    }
  }, [open, initialFile, onResetError]);

  const directoryLabel = (item: SkillDirectory) => `${t(`skills:market.scope.${item.source}`)} · ${t(`skills:market.kind.${item.kind}`)}`;

  function resetForm() {
    setFile(undefined);
    setUrl("");
    setDragging(false);
    if (fileInput.current) fileInput.current.value = "";
    onResetError();
  }

  async function runInstall(overwrite = false) {
    if (isPending || !directory?.enabled || (mode === "zip" ? !file : !url.trim())) return;
    try {
      await onInstall({
        projectId,
        directoryId: directory.id,
        ...(mode === "zip" ? { file } : { url: url.trim() }),
        overwrite,
      });
      resetForm();
      onOpenChange(false);
    } catch {
      /* Error is surfaced via mutation error state */
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void runInstall(false);
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!isPending) { if (!next) onResetError(); onOpenChange(next); } }}>
      <DialogContent
        showCloseButton={false}
        className="block fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-popover p-5 text-popover-foreground shadow-(--overlay-shadow) sm:p-6"
        onEscapeKeyDown={event => { if (isPending) event.preventDefault(); }}
        onInteractOutside={event => { if (isPending) event.preventDefault(); }}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <DialogTitle className="text-base font-semibold">{t("skills:market.add")}</DialogTitle>
          <DialogClose asChild>
            <Button variant="ghost" size="icon-sm" disabled={isPending} aria-label={t("skills:market.close")}>
              <X aria-hidden="true" />
            </Button>
          </DialogClose>
        </div>
        <DialogDescription className="sr-only">{t("skills:market.installHint")}</DialogDescription>

        <form id="skill-install" aria-label={t("skills:market.add")} onSubmit={submit} className="space-y-4">
          <div role="group" aria-label={t("skills:market.method")} className="inline-flex rounded-xl bg-muted/70 p-1">
            <Button
              type="button"
              variant={mode === "zip" ? "secondary" : "ghost"}
              size="sm"
              className={cn("rounded-lg", mode === "zip" && "bg-background shadow-xs")}
              aria-pressed={mode === "zip"}
              disabled={isPending}
              onClick={() => { setMode("zip"); onResetError(); }}
            >
              <Upload aria-hidden="true" />
              {t("skills:market.zip")}
            </Button>
            <Button
              type="button"
              variant={mode === "link" ? "secondary" : "ghost"}
              size="sm"
              className={cn("rounded-lg", mode === "link" && "bg-background shadow-xs")}
              aria-pressed={mode === "link"}
              disabled={isPending}
              onClick={() => { setMode("link"); onResetError(); }}
            >
              <Link aria-hidden="true" />
              {t("skills:market.link")}
            </Button>
          </div>

          {mode === "zip" ? (
            <div>
              <label
                htmlFor="skill-zip"
                className={cn(
                  "flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border border-dashed border-border bg-background px-4 py-7 text-center text-xs leading-5 transition-colors focus-within:ring-2 focus-within:ring-ring/50",
                  dragging ? "border-primary bg-primary/[0.04]" : "hover:bg-muted/40",
                  isPending && "pointer-events-none opacity-50",
                )}
                onDragOver={event => { event.preventDefault(); if (!isPending) setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={event => {
                  event.preventDefault();
                  setDragging(false);
                  if (!isPending && event.dataTransfer.files[0]) {
                    setFile(event.dataTransfer.files[0]);
                    onResetError();
                  }
                }}
              >
                <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                  <Upload className="size-5" aria-hidden="true" />
                </span>
                <span className="mt-1 max-w-full break-all font-medium text-foreground">
                  {file ? file.name : t("skills:market.drop")}
                </span>
                <span className="text-muted-foreground">{t("skills:market.zipHint")}</span>
                <input
                  id="skill-zip"
                  ref={fileInput}
                  type="file"
                  accept=".zip,application/zip"
                  className="sr-only"
                  aria-label={t("skills:market.zip")}
                  disabled={isPending}
                  onChange={event => { setFile(event.target.files?.[0]); onResetError(); }}
                />
              </label>
            </div>
          ) : (
            <div className="space-y-2">
              <label htmlFor="skill-url" className="text-xs font-medium">{t("skills:market.urlLabel")}</label>
              <Input
                id="skill-url"
                type="url"
                className="bg-background"
                placeholder={t("skills:market.urlPlaceholder")}
                value={url}
                required
                disabled={isPending}
                aria-describedby="skill-link-hint"
                onChange={event => { setUrl(event.target.value); if (error) onResetError(); }}
              />
              <p id="skill-link-hint" className="text-xs leading-5 text-muted-foreground">{t("skills:market.linkHint")}</p>
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="skill-directory" className="block text-xs font-medium">{t("skills:market.destination")}</label>
            <Select value={directory?.id ?? ""} disabled={isPending || enabledDirectories.length === 0} onValueChange={setDirectoryId}>
              <SelectTrigger id="skill-directory" className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {enabledDirectories.map(item => (
                  <SelectItem key={item.id} value={item.id}>{directoryLabel(item)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {directory && <p className="font-mono text-[11px] leading-4 break-all text-muted-foreground">{directory.path}</p>}
            {directory && !directory.trusted && (
              <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
                <ShieldAlert className="mt-0.5 size-icon shrink-0" aria-hidden="true" />
                <span>{t("skills:market.trustHint")}</span>
              </p>
            )}
          </div>

          {Boolean(error) && (
            <div role="alert" className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs leading-5">
              <p className="text-destructive">{skillError(t, error)}</p>
              {isConflict && (
                <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => void runInstall(true)}>
                  <RefreshCw className={cn(isPending && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
                  {t("skills:market.overwriteRetry")}
                </Button>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
            <p className="max-w-[260px] text-[11px] leading-4 text-muted-foreground">{t("skills:market.installHint")}</p>
            <div className="flex items-center gap-2">
              <DialogClose asChild>
                <Button type="button" variant="ghost" size="sm" disabled={isPending}>{t("workspace:cancel")}</Button>
              </DialogClose>
              <Button type="submit" size="sm" disabled={isPending || !directory?.enabled || (mode === "zip" ? !file : !url.trim())}>
                {isPending && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                {t(isPending ? "skills:market.installing" : "skills:market.install")}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
