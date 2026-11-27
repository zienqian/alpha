import { useState } from "react";
import { Check, CircleAlert, Copy, FolderOpen, ShieldCheck, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
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
        aria-describedby={undefined}
        className="flex max-h-[min(82dvh,680px)] max-w-xl flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-separator px-5 py-4">
          <DialogTitle>{t("skills:market.settings")}</DialogTitle>
          <DialogClose asChild>
            <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" aria-label={t("common:close")}>
              <X aria-hidden="true" />
            </Button>
          </DialogClose>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-5 p-5">
            <section className="space-y-2">
              <h3 className="px-0.5 text-[0.6875rem] font-medium tracking-[0.04em] text-muted-foreground uppercase">{t("skills:market.directorySources")}</h3>
              <div className="divide-y divide-separator overflow-hidden rounded-xl border border-border bg-card">
                <div className="flex items-center justify-between gap-4 p-3.5">
                  <label htmlFor="skills-shared-toggle" className="min-w-0 text-[0.8125rem] font-medium text-foreground">
                    {t("skills:market.sharedDirLabel")}
                  </label>
                  <Switch id="skills-shared-toggle" checked={sharedEnabled} disabled={saving} onCheckedChange={onToggleShared} />
                </div>
                <div className="flex items-center justify-between gap-4 p-3.5">
                  <label htmlFor="skills-claude-toggle" className="min-w-0 text-[0.8125rem] font-medium text-foreground">
                    {t("skills:market.claudeDirLabel")}
                  </label>
                  <Switch id="skills-claude-toggle" checked={claudeEnabled} disabled={saving} onCheckedChange={onToggleClaude} />
                </div>
                {activeProject && (
                  <div className="flex items-center justify-between gap-4 p-3.5">
                    <label htmlFor="skills-trust-toggle" className="flex min-w-0 items-center gap-1.5 text-[0.8125rem] font-medium text-foreground">
                      <ShieldCheck className="size-icon shrink-0 text-foreground" aria-hidden="true" />
                      <span>{t("skills:market.projectTrustLabel")}</span>
                      <span className="truncate font-normal text-muted-foreground">({projectDisplayName(activeProject)})</span>
                    </label>
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
                <h3 className="px-0.5 text-[0.6875rem] font-medium tracking-[0.04em] text-muted-foreground uppercase">{t("skills:market.directories")}</h3>
                <ul className="divide-y divide-separator overflow-hidden rounded-xl border border-border bg-card">
                  {catalog.directories.map(item => (
                    <li key={item.id} className="flex items-start gap-2.5 px-3.5 py-3 text-xs leading-[1.5]">
                      <FolderOpen className="mt-0.5 size-icon shrink-0 text-muted-foreground" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium text-foreground">{directoryLabel(item)}</span>
                          <Badge variant="secondary" className="text-[0.6875rem] font-normal">
                            {t(!item.enabled
                              ? "skills:market.directoryDisabled"
                              : !item.trusted
                                ? "skills:market.directoryUntrusted"
                                : !item.exists
                                  ? "skills:market.directoryMissing"
                                  : "skills:market.directoryActive")}
                          </Badge>
                        </div>
                        <p className="mt-0.5 font-mono text-[0.6875rem] leading-[1.4] break-all text-muted-foreground">{item.path}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                        aria-label={t("skills:market.copyPath")}
                        title={t("skills:market.copyPath")}
                        onClick={() => void copyPath(item.id, item.path)}
                      >
                        <span className="icon-swap-stack" aria-hidden="true">
                          <span className="icon-swap-layer" data-visible={copiedId !== item.id}><Copy /></span>
                          <span className="icon-swap-layer text-status-success" data-visible={copiedId === item.id}><Check /></span>
                        </span>
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {catalog.diagnostics.length > 0 && (
              <section className="space-y-2">
                <h3 className="flex items-center gap-1.5 px-0.5 text-[0.6875rem] font-medium tracking-[0.04em] text-status-warning uppercase">
                  <CircleAlert className="size-3.5" aria-hidden="true" />
                  <span>{t("skills:market.diagnostics", { count: catalog.diagnostics.length })}</span>
                </h3>
                <ul className="divide-y divide-separator overflow-hidden rounded-xl border border-border bg-card text-xs">
                  {catalog.diagnostics.map((item, index) => (
                    <li key={`${item.path}-${index}`} className="px-3.5 py-2.5 break-all">
                      <code className="font-mono text-[0.6875rem] font-medium text-foreground">{item.code}</code>
                      <p className="mt-0.5 font-mono text-[0.6875rem] text-muted-foreground">{item.path}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
