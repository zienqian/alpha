import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, CircleAlert, Copy, FileText, FolderOpen, Layers, LoaderCircle, ShieldCheck, Terminal, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "@/i18n/react";
import { cn } from "@/lib/utils";
import type { InstalledSkill, SkillDirectory } from "./api";
import { SkillIcon } from "./skill-icon";
import { useSkillContent } from "./use-skills-catalog";

export function SkillDetailSheet({
  skill,
  directory,
  projectId,
  open,
  toggling,
  uninstalling,
  onOpenChange,
  onToggleSkill,
  onTrustProject,
  onEnableDirectoryKind,
  onUninstall,
}: {
  skill: InstalledSkill | undefined;
  directory: SkillDirectory | undefined;
  projectId: string | undefined;
  open: boolean;
  toggling: boolean;
  uninstalling: boolean;
  onOpenChange: (open: boolean) => void;
  onToggleSkill: (name: string, enabled: boolean) => void;
  onTrustProject: () => void;
  onEnableDirectoryKind: (kind: "shared" | "claude") => void;
  onUninstall: (skill: InstalledSkill) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [copiedField, setCopiedField] = useState<"command" | "path" | null>(null);
  const [uninstallError, setUninstallError] = useState<string>();

  const contentQuery = useSkillContent(
    open && skill ? { projectId, directoryId: skill.directoryId, name: skill.name } : undefined,
  );

  useEffect(() => {
    setCopiedField(null);
    setUninstallError(undefined);
    setConfirmOpen(false);
  }, [skill?.filePath, open]);

  async function copyText(field: "command" | "path", value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField(current => (current === field ? null : current)), 2000);
    } catch {
      /* Ignore clipboard denial gracefully */
    }
  }

  async function confirmUninstall() {
    if (!skill) return;
    setUninstallError(undefined);
    try {
      await onUninstall(skill);
      setConfirmOpen(false);
      onOpenChange(false);
    } catch (error) {
      setUninstallError(error instanceof Error ? error.message : t("skills:market.errors.request"));
      setConfirmOpen(false);
    }
  }

  const canToggle = Boolean(
    skill && (
      skill.status === "available"
      || skill.status === "shadowed"
      || (skill.status === "disabled" && skill.disabledByName)
    ),
  );
  const directoryDisabled = Boolean(skill && directory && !directory.enabled);
  const commandText = skill ? `/${skill.name}${skill.argumentHint ? ` ${skill.argumentHint}` : ""}` : "";

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="w-full max-w-full gap-0 bg-background p-0 sm:max-w-[520px]"
        >
          {skill && (
            <div className="flex h-full min-h-0 flex-col">
              <SheetHeader className="border-b border-separator px-5 py-4 pe-12">
                <div className="flex items-start gap-3">
                  <SkillIcon name={skill.name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <SheetTitle className="truncate text-[0.9375rem] leading-[1.35] font-semibold tracking-[-0.015em]">{skill.name}</SheetTitle>
                      {canToggle && (
                        <Switch
                          size="sm"
                          checked={skill.status !== "disabled"}
                          disabled={toggling}
                          aria-label={t("skills:market.toggleSkill", { name: skill.name })}
                          onCheckedChange={checked => onToggleSkill(skill.name, checked)}
                        />
                      )}
                    </div>
                    <SheetDescription className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                      <Badge variant="secondary" className="text-[0.6875rem] font-normal">
                        {t(`skills:market.scope.${skill.source}`)} · {t(`skills:market.kind.${skill.kind}`)}
                      </Badge>
                      <Badge
                        variant={skill.status === "available" ? "outline" : "secondary"}
                        className={cn(
                          "text-[0.6875rem] font-medium",
                          skill.status === "available" && "border-status-success-border bg-status-success-bg text-status-success",
                          skill.status === "untrusted" && "border-status-warning-border bg-status-warning-bg text-status-warning",
                          skill.status === "reserved" && "border-status-danger-border bg-status-danger-bg text-status-danger",
                        )}
                      >
                        {t(`skills:market.status.${skill.status}`)}
                      </Badge>
                    </SheetDescription>
                  </div>
                </div>
              </SheetHeader>

              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-5 px-5 py-5">
                  {skill.status !== "available" && (
                    <div className="flex flex-col gap-2.5 rounded-xl border border-status-warning-border bg-status-warning-bg p-3.5 text-xs leading-[1.5]">
                      <div className="flex items-start gap-2">
                        {skill.status === "shadowed"
                          ? <Layers className="mt-0.5 size-icon shrink-0 text-muted-foreground" aria-hidden="true" />
                          : <CircleAlert className="mt-0.5 size-icon shrink-0 text-status-warning" aria-hidden="true" />}
                        <p className="text-foreground/90">{t(`skills:market.reason.${skill.status}`)}</p>
                      </div>
                      {skill.status === "untrusted" && projectId && (
                        <div>
                          <Button size="sm" disabled={toggling} onClick={onTrustProject}>
                            <ShieldCheck aria-hidden="true" />
                            {t("skills:market.trustProject")}
                          </Button>
                        </div>
                      )}
                      {directoryDisabled && (skill.kind === "shared" || skill.kind === "claude") && (
                        <div>
                          <Button size="sm" disabled={toggling} onClick={() => onEnableDirectoryKind(skill.kind as "shared" | "claude")}>
                            {t(skill.kind === "shared" ? "skills:market.enableSharedDir" : "skills:market.enableClaudeDir")}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  <p className="text-[0.875rem] leading-[1.55] break-words text-foreground">{skill.description}</p>

                  <div className="divide-y divide-separator rounded-xl border border-border bg-card text-xs">
                    {skill.userInvocable && (
                      <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                        <div className="min-w-0">
                          <span className="block text-[0.6875rem] text-muted-foreground">{t("skills:market.command")}</span>
                          <code className="mt-0.5 block truncate font-mono text-xs text-foreground">{commandText}</code>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 shrink-0 text-muted-foreground hover:text-foreground"
                          onClick={() => void copyText("command", commandText)}
                        >
                          <span className="icon-swap-stack" aria-hidden="true">
                            <span className="icon-swap-layer" data-visible={copiedField !== "command"}><Copy /></span>
                            <span className="icon-swap-layer text-status-success" data-visible={copiedField === "command"}><Check /></span>
                          </span>
                          {t(copiedField === "command" ? "common:copied" : "skills:market.copyCommand")}
                        </Button>
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                      <div className="min-w-0">
                        <span className="block text-[0.6875rem] text-muted-foreground">{t("skills:market.invocation")}</span>
                        <span className="mt-0.5 block text-foreground">
                          {!skill.userInvocable
                            ? t("skills:modelOnly")
                            : skill.disableModelInvocation
                              ? t("skills:manualOnly")
                              : t("skills:market.invocationBoth")}
                        </span>
                      </div>
                      <Terminal className="size-icon shrink-0 text-muted-foreground/70" aria-hidden="true" />
                    </div>

                    <div className="flex items-start justify-between gap-2 px-3.5 py-2.5">
                      <div className="min-w-0">
                        <span className="block text-[0.6875rem] text-muted-foreground">{t("skills:market.location")}</span>
                        <span className="mt-0.5 block font-mono text-[0.6875rem] leading-[1.4] break-all text-muted-foreground">{skill.filePath}</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
                        aria-label={t("skills:market.copyPath")}
                        title={t("skills:market.copyPath")}
                        onClick={() => void copyText("path", skill.filePath)}
                      >
                        <span className="icon-swap-stack" aria-hidden="true">
                          <span className="icon-swap-layer" data-visible={copiedField !== "path"}><Copy /></span>
                          <span className="icon-swap-layer text-status-success" data-visible={copiedField === "path"}><Check /></span>
                        </span>
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-[0.6875rem] font-medium tracking-[0.04em] text-muted-foreground uppercase">
                      <FileText className="size-3.5" aria-hidden="true" />
                      <span>{t("skills:market.instructions")}</span>
                    </div>
                    <div className="rounded-xl bg-muted p-4 text-xs leading-[1.6] ring-1 ring-foreground/5 dark:ring-foreground/10">
                      {contentQuery.isPending ? (
                        <div className="space-y-2" role="status" aria-label={t("skills:market.instructionsLoading")}>
                          <Skeleton className="h-4 w-3/4 rounded-md" />
                          <Skeleton className="h-4 w-full rounded-md" />
                          <Skeleton className="h-4 w-5/6 rounded-md" />
                          <Skeleton className="h-4 w-2/3 rounded-md" />
                        </div>
                      ) : contentQuery.isError ? (
                        <p className="text-muted-foreground">{t("skills:market.instructionsError")}</p>
                      ) : contentQuery.data?.content.trim() ? (
                        <div className="prose prose-xs max-w-none break-words text-foreground dark:prose-invert [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.6875rem] [&_h1]:mt-0 [&_h1]:mb-2 [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:mb-1.5 [&_h2]:text-[0.8125rem] [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-xs [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:ps-4 [&_p]:my-1.5 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:ps-4">
                          <Markdown remarkPlugins={[remarkGfm]}>{contentQuery.data.content}</Markdown>
                        </div>
                      ) : (
                        <p className="text-muted-foreground">{t("skills:market.instructionsEmpty")}</p>
                      )}
                    </div>
                  </div>

                  {contentQuery.data && contentQuery.data.files.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5 text-[0.6875rem] font-medium tracking-[0.04em] text-muted-foreground uppercase">
                        <FolderOpen className="size-3.5" aria-hidden="true" />
                        <span>{t("skills:market.supportingFiles")}</span>
                        <span className="tabular-nums opacity-75">({contentQuery.data.files.length})</span>
                      </div>
                      <ul className="divide-y divide-separator rounded-xl border border-border bg-card text-xs">
                        {contentQuery.data.files.map(file => (
                          <li key={file} className="truncate px-3.5 py-2 font-mono text-[0.6875rem] text-muted-foreground" title={file}>
                            {file}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {uninstallError && (
                    <p role="alert" className="text-xs leading-[1.5] text-status-danger">{uninstallError}</p>
                  )}
                </div>
              </ScrollArea>

              <div className="flex items-center justify-end border-t border-separator bg-surface-sunken/70 px-5 py-3 dark:bg-card/60">
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-status-danger hover:bg-status-danger-bg hover:text-status-danger"
                  disabled={uninstalling}
                  onClick={() => setConfirmOpen(true)}
                >
                  {uninstalling ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
                  {t(uninstalling ? "skills:market.uninstalling" : "skills:market.uninstall")}
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent size="sm" className="p-5">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">{skill ? t("skills:market.uninstallTitle", { name: skill.name }) : ""}</AlertDialogTitle>
            <AlertDialogDescription className="text-xs leading-[1.5]">
              {t("skills:market.uninstallDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="sm" disabled={uninstalling}>{t("workspace:cancel")}</AlertDialogCancel>
            <AlertDialogAction size="sm" variant="destructive" disabled={uninstalling} onClick={() => void confirmUninstall()}>
              {t("skills:market.uninstallConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
