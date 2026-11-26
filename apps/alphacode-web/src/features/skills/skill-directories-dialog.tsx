import { useState } from "react";
import { Check, CircleAlert, Copy, FolderOpen, ShieldCheck, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "@/i18n/react";
import { projectDisplayName, type SkillCatalog, type SkillDirectory } from "./api";

export function SkillDirectoriesDialog({
  open,
  catalog,
  saving,
  onOpenChange,
  onToggleShared,
  onToggleClaude,
  onToggleTrust,
}: {
  open: boolean;
  catalog: SkillCatalog | undefined;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onToggleShared: (enabled: boolean) => void;
  onToggleClaude: (enabled: boolean) => void;
  onToggleTrust: (projectId: string, trusted: boolean) => void;
}) {
  const { t } = useTranslation();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (!catalog) return null;

  const activeProject = catalog.projects.find(item => item.id === catalog.projectId);
  const sharedEnabled = catalog.settings?.sharedDirectories ?? catalog.directories.some(item => item.kind === "shared" && item.enabled);
  const claudeEnabled = catalog.settings?.claudeDirectories ?? catalog.directories.some(item => item.kind === "claude" && item.enabled);
  const projectTrusted = activeProject?.trusted ?? catalog.directories.some(item => item.source === "project" && item.trusted);

  const directoryLabel = (item: SkillDirectory) => `${t(`skills:market.scope.${item.source}`)} · ${t(`skills:market.kind.${item.kind}`)}`;

  async function copyPath(id: string, path: string) {
    try {
      await navigator.clipboard.writeText(path);
      setCopiedId(id);
      setTimeout(() => setCopiedId(current => (current === id ? null : current)), 2000);
    } catch {
      /* Ignore clipboard denial */
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex fixed top-1/2 left-1/2 z-50 max-h-[min(82dvh,680px)] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col gap-0 overflow-hidden rounded-2xl bg-popover p-0 text-popover-foreground shadow-(--overlay-shadow)"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
          <div className="min-w-0">
            <DialogTitle className="text-base font-semibold">{t("skills:market.settings")}</DialogTitle>
            <DialogDescription className="mt-0.5 text-xs text-muted-foreground">
              {t("skills:market.settingsDescription")}
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t("common:close")}>
              <X aria-hidden="true" />
            </Button>
          </DialogClose>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-5 p-5">
            <section className="space-y-2">
              <h3 className="px-1 text-xs font-medium text-muted-foreground">{t("skills:market.directorySources")}</h3>
              <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/75 bg-background">
                <div className="flex items-center justify-between gap-4 p-3.5">
                  <div className="min-w-0">
                    <label htmlFor="skills-shared-toggle" className="block text-[13px] font-medium">
                      {t("skills:market.sharedDirLabel")}
                    </label>
                    <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{t("skills:market.sharedDirDescription")}</p>
                  </div>
                  <Switch id="skills-shared-toggle" checked={sharedEnabled} disabled={saving} onCheckedChange={onToggleShared} />
                </div>
                <div className="flex items-center justify-between gap-4 p-3.5">
                  <div className="min-w-0">
                    <label htmlFor="skills-claude-toggle" className="block text-[13px] font-medium">
                      {t("skills:market.claudeDirLabel")}
                    </label>
                    <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{t("skills:market.claudeDirDescription")}</p>
                  </div>
                  <Switch id="skills-claude-toggle" checked={claudeEnabled} disabled={saving} onCheckedChange={onToggleClaude} />
                </div>
                {activeProject && (
                  <div className="flex items-center justify-between gap-4 p-3.5">
                    <div className="min-w-0">
                      <label htmlFor="skills-trust-toggle" className="flex items-center gap-1.5 text-[13px] font-medium">
                        <ShieldCheck className="size-icon text-primary" aria-hidden="true" />
                        <span>{t("skills:market.projectTrustLabel")}</span>
                        <span className="truncate font-normal text-muted-foreground">({projectDisplayName(activeProject)})</span>
                      </label>
                      <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{t("skills:market.projectTrustDescription")}</p>
                    </div>
                    <Switch
                      id="skills-trust-toggle"
                      checked={projectTrusted}
                      disabled={saving}
                      onCheckedChange={checked => onToggleTrust(activeProject.id, checked)}
                    />
                  </div>
                )}
              </div>
            </section>

            {catalog.directories.length > 0 && (
              <section className="space-y-2">
                <h3 className="px-1 text-xs font-medium text-muted-foreground">{t("skills:market.directories")}</h3>
                <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/75 bg-background">
                  {catalog.directories.map(item => (
                    <li key={item.id} className="flex items-start gap-2.5 px-3.5 py-3 text-xs leading-5">
                      <FolderOpen className="mt-0.5 size-icon shrink-0 text-muted-foreground" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium text-foreground">{directoryLabel(item)}</span>
                          <Badge variant="secondary" className="text-[10px] font-normal">
                            {t(!item.enabled
                              ? "skills:market.directoryDisabled"
                              : !item.trusted
                                ? "skills:market.directoryUntrusted"
                                : !item.exists
                                  ? "skills:market.directoryMissing"
                                  : "skills:market.directoryActive")}
                          </Badge>
                        </div>
                        <p className="mt-0.5 font-mono text-[11px] leading-4 break-all text-muted-foreground">{item.path}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="shrink-0 text-muted-foreground"
                        aria-label={t("skills:market.copyPath")}
                        title={t("skills:market.copyPath")}
                        onClick={() => void copyPath(item.id, item.path)}
                      >
                        {copiedId === item.id ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {catalog.diagnostics.length > 0 && (
              <section className="space-y-2">
                <h3 className="flex items-center gap-1.5 px-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                  <CircleAlert className="size-3.5" aria-hidden="true" />
                  <span>{t("skills:market.diagnostics", { count: catalog.diagnostics.length })}</span>
                </h3>
                <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/75 bg-background text-xs">
                  {catalog.diagnostics.map((item, index) => (
                    <li key={`${item.path}-${index}`} className="px-3.5 py-2.5 break-all">
                      <code className="font-mono text-[11px] font-medium text-foreground">{item.code}</code>
                      <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{item.path}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </ScrollArea>

        <div className="border-t border-border/60 bg-muted/20 px-5 py-3">
          <p className="text-[11px] leading-4 text-muted-foreground">{t("skills:market.newSession")}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
