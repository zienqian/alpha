import { useEffect, useRef, useState, type FormEvent } from "react";
import * as m from "motion/react-m";
import { Link, LoaderCircle, RefreshCw, ShieldAlert, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTranslation } from "@/i18n/react";
import { indicatorSpring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { SkillApiError, skillError, type SkillDirectory, type SkillInstallation } from "./api";

const selectClass = "h-9 w-full rounded-lg text-base md:text-xs";

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
        aria-describedby={undefined}
        className="block max-h-[calc(100dvh-2rem)] overflow-y-auto p-5 sm:p-6"
        onEscapeKeyDown={event => { if (isPending) event.preventDefault(); }}
        onInteractOutside={event => { if (isPending) event.preventDefault(); }}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <DialogTitle>{t("skills:market.add")}</DialogTitle>
          <DialogClose asChild>
            <Button variant="ghost" size="icon-sm" disabled={isPending} className="text-muted-foreground hover:text-foreground" aria-label={t("skills:market.close")}>
              <X aria-hidden="true" />
            </Button>
          </DialogClose>
        </div>

        <form id="skill-install" aria-label={t("skills:market.add")} onSubmit={submit} className="space-y-4">
          <div role="group" aria-label={t("skills:market.method")} className="inline-flex rounded-xl border border-border/80 bg-surface-sunken p-1 dark:bg-muted">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              static
              className={cn("relative rounded-lg hover:bg-transparent", mode === "zip" ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
              aria-pressed={mode === "zip"}
              disabled={isPending}
              onClick={() => { setMode("zip"); onResetError(); }}
            >
              {mode === "zip" && <m.span layoutId="install-skill-mode" transition={indicatorSpring} aria-hidden="true" className="absolute inset-0 rounded-lg bg-background shadow-xs ring-1 ring-foreground/6 dark:bg-card dark:ring-foreground/10" />}
              <Upload className="relative z-10" aria-hidden="true" />
              <span className="relative z-10">{t("skills:market.zip")}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              static
              className={cn("relative rounded-lg hover:bg-transparent", mode === "link" ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
              aria-pressed={mode === "link"}
              disabled={isPending}
              onClick={() => { setMode("link"); onResetError(); }}
            >
              {mode === "link" && <m.span layoutId="install-skill-mode" transition={indicatorSpring} aria-hidden="true" className="absolute inset-0 rounded-lg bg-background shadow-xs ring-1 ring-foreground/6 dark:bg-card dark:ring-foreground/10" />}
              <Link className="relative z-10" aria-hidden="true" />
              <span className="relative z-10">{t("skills:market.link")}</span>
            </Button>
          </div>

          {mode === "zip" ? (
            <div>
              <label
                htmlFor="skill-zip"
                className={cn(
                  "flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border border-dashed border-input bg-background px-4 py-7 text-center text-xs leading-[1.5] transition-colors duration-150 ease-out focus-within:ring-2 focus-within:ring-ring/45 dark:bg-card/40",
                  dragging ? "border-foreground/45 bg-surface-sunken dark:bg-muted" : "hover:bg-surface-sunken dark:hover:bg-muted/60",
                  isPending && "pointer-events-none opacity-45",
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
                <span className="flex size-10 items-center justify-center rounded-lg border border-border/80 bg-background text-muted-foreground shadow-[0_1px_2px_oklch(0_0_0/0.03)] dark:bg-card">
                  <Upload className="size-5" aria-hidden="true" />
                </span>
                <span className="mt-1 max-w-full break-all font-medium text-foreground">
                  {file ? file.name : t("skills:market.drop")}
                </span>
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
              <label htmlFor="skill-url" className="block text-xs font-medium text-foreground">{t("skills:market.urlLabel")}</label>
              <Input
                id="skill-url"
                type="url"
                placeholder={t("skills:market.urlPlaceholder")}
                value={url}
                required
                disabled={isPending}
                onChange={event => { setUrl(event.target.value); if (error) onResetError(); }}
              />
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="skill-directory" className="block text-xs font-medium text-foreground">{t("skills:market.destination")}</label>
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
            {directory && <p className="font-mono text-[0.6875rem] leading-[1.4] break-all text-muted-foreground">{directory.path}</p>}
            {directory && !directory.trusted && (
              <p className="flex items-start gap-1.5 rounded-lg border border-status-warning-border bg-status-warning-bg px-3 py-2 text-xs leading-[1.5] text-status-warning">
                <ShieldAlert className="mt-0.5 size-icon shrink-0" aria-hidden="true" />
                <span>{t("skills:market.trustHint")}</span>
              </p>
            )}
          </div>

          {Boolean(error) && (
            <div role="alert" className="space-y-2 rounded-xl border border-status-danger-border bg-status-danger-bg p-3 text-xs leading-[1.5]">
              <p className="text-status-danger">{skillError(t, error)}</p>
              {isConflict && (
                <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => void runInstall(true)}>
                  <RefreshCw className={cn(isPending && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
                  {t("skills:market.overwriteRetry")}
                </Button>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-separator pt-4">
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="sm" disabled={isPending}>{t("workspace:cancel")}</Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={isPending || !directory?.enabled || (mode === "zip" ? !file : !url.trim())}>
              {isPending && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              {t(isPending ? "skills:market.installing" : "skills:market.install")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
