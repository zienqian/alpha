import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import * as m from "motion/react-m";
import { Check, Folder, Plus, RefreshCw, Search, Settings2, ShieldAlert, ShieldCheck, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/i18n/react";
import { indicatorSpring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { projectDisplayName, skillError, type InstalledSkill, type SkillDirectory } from "./api";
import { InstallSkillDialog } from "./install-skill-dialog";
import { SkillCard } from "./skill-card";
import { SkillDetailSheet } from "./skill-detail-sheet";
import { SkillDirectoriesDialog } from "./skill-directories-dialog";
import { useSkillsCatalog } from "./use-skills-catalog";

type FilterKind = "all" | SkillDirectory["kind"];

interface StatusNotice {
  id: number;
  message: string;
  tone?: "success" | "error";
}

function SkillsSkeleton({ label }: { label: string }) {
  return (
    <div className="mt-6 grid grid-cols-1 gap-x-5 gap-y-3 @min-[640px]:grid-cols-2" role="status" aria-label={label}>
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex min-h-[82px] items-center gap-3 rounded-2xl border border-border/80 bg-card p-3">
          <Skeleton className="size-10 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-32 rounded-md" />
            <Skeleton className="h-3.5 w-4/5 rounded-md" />
          </div>
          <Skeleton className="h-4 w-7 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function SkillsMarket({ initialProjectId, showHeader = true }: { initialProjectId?: string; showHeader?: boolean }) {
  const { t } = useTranslation();
  const [projectId, setProjectId] = useState(initialProjectId);
  const [filter, setFilter] = useState<FilterKind>("all");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [installOpen, setInstallOpen] = useState(false);
  const [droppedFile, setDroppedFile] = useState<File>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedSkillKey, setSelectedSkillKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<StatusNotice | null>(null);
  const [pageDragging, setPageDragging] = useState(false);
  const dragDepth = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const { catalogQuery, installMutation, settingsMutation, uninstallMutation } = useSkillsCatalog(projectId);
  const catalog = catalogQuery.data;

  // Sync project selection when workspace selection updates or active project is removed.
  useEffect(() => {
    if (initialProjectId && projectId === undefined) setProjectId(initialProjectId);
  }, [initialProjectId, projectId]);

  useEffect(() => {
    if (catalog && projectId && catalog.projects.length > 0 && !catalog.projects.some(item => item.id === projectId)) {
      setProjectId(catalog.projectId);
    }
  }, [catalog, projectId]);

  // Auto-dismiss transient success feedback banners; errors persist until dismissed (better-accessibility).
  useEffect(() => {
    if (!notice || notice.tone === "error") return;
    const timer = setTimeout(() => setNotice(current => (current?.id === notice.id ? null : current)), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Press "/" to quickly focus search when not typing in an input.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (installOpen || settingsOpen || selectedSkillKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [installOpen, settingsOpen, selectedSkillKey]);

  const showNotice = useCallback((message: string, options?: { tone?: "success" | "error" }) => {
    setNotice({ id: Date.now(), message, tone: options?.tone ?? "success" });
  }, []);

  const enabledDirectories = useMemo(
    () => catalog?.directories.filter(item => item.enabled) ?? [],
    [catalog?.directories],
  );

  const directoryMap = useMemo(
    () => new Map((catalog?.directories ?? []).map(item => [item.id, item])),
    [catalog?.directories],
  );

  const allSkills = catalog?.skills ?? [];
  const showClaudeTab = Boolean(
    catalog?.settings?.claudeDirectories
    || allSkills.some(skill => skill.kind === "claude"),
  );

  const kindCounts = useMemo(() => {
    const counts: Record<FilterKind, number> = { all: allSkills.length, local: 0, shared: 0, claude: 0 };
    for (const skill of allSkills) counts[skill.kind] += 1;
    return counts;
  }, [allSkills]);

  const visible = useMemo(() => {
    const needle = deferredSearch.trim().toLocaleLowerCase();
    return allSkills.filter(skill => {
      if (filter !== "all" && skill.kind !== filter) return false;
      if (!needle) return true;
      return `${skill.name} ${skill.description} ${skill.filePath}`.toLocaleLowerCase().includes(needle);
    });
  }, [allSkills, filter, deferredSearch]);

  const selectedSkill = useMemo(
    () => allSkills.find(skill => `${skill.directoryId}::${skill.name}` === selectedSkillKey),
    [allSkills, selectedSkillKey],
  );

  const activeProject = catalog?.projects.find(item => item.id === catalog.projectId);
  const projectUntrusted = Boolean(
    activeProject
    && !(activeProject.trusted ?? catalog?.directories.some(d => d.source === "project" && d.trusted))
    && allSkills.some(skill => skill.source === "project" && skill.status === "untrusted"),
  );
  const hasSettingsAttention = Boolean((catalog?.diagnostics.length ?? 0) > 0 || projectUntrusted);
  const canInstall = enabledDirectories.length > 0;

  async function applySettings(patch: Parameters<typeof settingsMutation.mutateAsync>[0]) {
    try {
      await settingsMutation.mutateAsync(patch);
    } catch (error) {
      showNotice(skillError(t, error), { tone: "error" });
    }
  }

  async function handleInstall(input: Parameters<typeof installMutation.mutateAsync>[0]) {
    const result = await installMutation.mutateAsync(input);
    setDroppedFile(undefined);
    showNotice(t("skills:market.success", { names: result.installed.join(", ") }));
    return result;
  }

  async function handleUninstall(skill: InstalledSkill) {
    await uninstallMutation.mutateAsync({
      projectId: catalog?.projectId,
      directoryId: skill.directoryId,
      name: skill.name,
    });
    showNotice(t("skills:market.uninstalled", { name: skill.name }));
  }

  function handlePageDragEnter(event: React.DragEvent) {
    if (!canInstall || installOpen || !event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepth.current += 1;
    setPageDragging(true);
  }

  function handlePageDragOver(event: React.DragEvent) {
    if (!pageDragging) return;
    event.preventDefault();
  }

  function handlePageDragLeave(event: React.DragEvent) {
    if (!pageDragging) return;
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setPageDragging(false);
  }

  function handlePageDrop(event: React.DragEvent) {
    if (!pageDragging) return;
    event.preventDefault();
    dragDepth.current = 0;
    setPageDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      setDroppedFile(file);
      installMutation.reset();
      setInstallOpen(true);
    }
  }

  const filterKinds: FilterKind[] = showClaudeTab
    ? ["all", "local", "shared", "claude"]
    : ["all", "local", "shared"];

  return (
    <>
      {showHeader && (
        <header className="workspace-toolbar flex h-11 shrink-0 items-center gap-2 px-3.5 sm:px-5">
          <SidebarTrigger mobileOnly aria-label={t("workspace:toggleSidebar")} className="text-muted-foreground hover:text-foreground" />
          <span className="flex-1 text-[0.8125rem] font-medium tracking-[-0.008em]">{t("skills:market.title")}</span>
        </header>
      )}

      <section
        id="skills-content"
        aria-labelledby="skills-title"
        tabIndex={-1}
        className="relative min-h-0 flex-1 scroll-pt-6 overflow-y-auto outline-none"
        onDragEnter={handlePageDragEnter}
        onDragOver={handlePageDragOver}
        onDragLeave={handlePageDragLeave}
        onDrop={handlePageDrop}
      >
        {pageDragging && (
          <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-background/80 backdrop-blur-xs">
            <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-foreground/35 bg-popover px-10 py-8 text-center shadow-(--shadow-overlay)">
              <span className="flex size-12 items-center justify-center rounded-xl bg-muted text-foreground">
                <Upload className="size-6" aria-hidden="true" />
              </span>
              <p className="text-sm font-semibold text-foreground">{t("skills:market.dropOverlayTitle")}</p>
            </div>
          </div>
        )}

        <div className="@container mx-auto max-w-[964px] px-5 py-7 sm:px-8 sm:py-10">
          <div className="flex flex-col justify-between gap-4 @min-[700px]:flex-row @min-[700px]:items-center">
            <div className="min-w-0">
              <h1 id="skills-title" className="text-[1.375rem] leading-[1.28] font-semibold tracking-[-0.022em] text-balance text-foreground">{t("skills:market.title")}</h1>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {catalog && catalog.projects.length > 0 && (
                <Select
                  value={catalog.projectId}
                  disabled={installMutation.isPending}
                  onValueChange={value => {
                    setProjectId(value);
                    installMutation.reset();
                  }}
                >
                  <SelectTrigger
                    id="skills-project"
                    aria-label={t("skills:market.project")}
                    className="h-8 max-w-[220px] min-w-[140px] rounded-lg px-2.5 text-xs"
                    size="sm"
                  >
                    <Folder className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {catalog.projects.map(project => (
                      <SelectItem key={project.id} value={project.id} title={project.path}>
                        {projectDisplayName(project)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <Button
                size="sm"
                className="h-8 rounded-lg px-3 text-xs"
                disabled={!canInstall || installMutation.isPending}
                onClick={() => {
                  setDroppedFile(undefined);
                  installMutation.reset();
                  setInstallOpen(true);
                }}
              >
                <Plus aria-hidden="true" />
                {t("skills:market.add")}
              </Button>
            </div>
          </div>

          <div className="mt-6 flex flex-col justify-between gap-3 border-b border-separator pb-4 @min-[680px]:flex-row @min-[680px]:items-center">
            <div role="group" aria-label={t("skills:market.filter")} className="inline-flex w-fit flex-wrap items-center gap-0.5 rounded-xl bg-muted p-1">
              {filterKinds.map(kind => {
                const active = filter === kind;
                return (
                  <Button
                    key={kind}
                    variant="ghost"
                    size="sm"
                    static
                    className={cn(
                      "relative h-7 rounded-lg px-2.5 text-xs hover:bg-transparent",
                      active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                    aria-pressed={active}
                    onClick={() => setFilter(kind)}
                  >
                    {active && (
                      <m.span
                        layoutId="skills-filter-indicator"
                        transition={indicatorSpring}
                        aria-hidden="true"
                        className="absolute inset-0 rounded-lg bg-background shadow-xs ring-1 ring-foreground/6 dark:bg-card dark:ring-foreground/10"
                      />
                    )}
                    <span className="relative z-10">{t(`skills:market.kind.${kind}`)}</span>
                    {catalog && (
                      <span className={cn("relative z-10 ms-0.5 text-[0.6875rem] tabular-nums", active ? "text-foreground/75" : "text-muted-foreground/75")}>
                        {kindCounts[kind]}
                      </span>
                    )}
                  </Button>
                );
              })}
            </div>

            <div className="flex items-center gap-1.5">
              <div className="relative min-w-0 flex-1 @min-[680px]:w-56 @min-[680px]:flex-none">
                <Search className="pointer-events-none absolute top-1/2 start-2.5 size-icon -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  ref={searchRef}
                  className="h-8 rounded-lg pe-8 ps-8 md:text-xs [&::-webkit-search-cancel-button]:appearance-none"
                  type="search"
                  aria-label={t("skills:market.search")}
                  placeholder={t("skills:market.search")}
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === "Escape" && search) {
                      event.preventDefault();
                      setSearch("");
                    }
                  }}
                />
                {search && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="absolute top-1/2 end-1 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={t("skills:market.clearSearch")}
                    title={t("skills:market.clearSearch")}
                    onClick={() => { setSearch(""); searchRef.current?.focus(); }}
                  >
                    <X aria-hidden="true" />
                  </Button>
                )}
              </div>

              <Button
                variant="ghost"
                size="icon-sm"
                className="size-8 rounded-lg text-muted-foreground hover:text-foreground"
                aria-label={t("skills:market.refresh")}
                title={t("skills:market.refresh")}
                disabled={catalogQuery.isFetching}
                onClick={() => void catalogQuery.refetch()}
              >
                <RefreshCw className={cn(catalogQuery.isFetching && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
              </Button>

              <Button
                variant="ghost"
                size="icon-sm"
                className="relative size-8 rounded-lg text-muted-foreground hover:text-foreground"
                aria-label={t("skills:market.settings")}
                title={t("skills:market.settings")}
                disabled={!catalog}
                onClick={() => setSettingsOpen(true)}
              >
                <Settings2 aria-hidden="true" />
                {hasSettingsAttention && (
                  <span className="absolute top-1.5 end-1.5 size-1.5 rounded-full bg-status-warning ring-2 ring-background" aria-hidden="true" />
                )}
              </Button>
            </div>
          </div>

          <div role="status" aria-live="polite" className={notice && notice.tone !== "error" ? "mt-4" : "sr-only"}>
            {notice && notice.tone !== "error" && (
              <div className="flex items-center gap-2.5 rounded-xl border border-status-success-border bg-status-success-bg px-3.5 py-2.5 text-xs leading-[1.5] text-foreground">
                <Check className="size-icon shrink-0 text-status-success" aria-hidden="true" />
                <p className="min-w-0 flex-1 font-medium break-words">{notice.message}</p>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label={t("skills:market.closeNotice")}
                  onClick={() => setNotice(null)}
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
            )}
          </div>

          {notice && notice.tone === "error" && (
            <div
              role="alert"
              className="mt-4 flex items-center gap-2.5 rounded-xl border border-status-danger-border bg-status-danger-bg px-3.5 py-2.5 text-xs leading-[1.5] text-status-danger"
            >
              <p className="min-w-0 flex-1 font-medium break-words">{notice.message}</p>
              <Button
                variant="ghost"
                size="icon-xs"
                className="shrink-0 text-muted-foreground hover:text-foreground"
                aria-label={t("skills:market.closeNotice")}
                onClick={() => setNotice(null)}
              >
                <X aria-hidden="true" />
              </Button>
            </div>
          )}

          {projectUntrusted && activeProject && (
            <div className="mt-4 flex flex-col justify-between gap-3 rounded-2xl border border-status-warning-border bg-status-warning-bg px-4 py-3 text-xs leading-[1.5] sm:flex-row sm:items-center">
              <div className="flex min-w-0 items-center gap-2.5">
                <ShieldAlert className="size-icon shrink-0 text-status-warning" aria-hidden="true" />
                <p className="min-w-0 font-medium text-foreground">{t("skills:market.untrustedBannerTitle")}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 self-start bg-background sm:self-center dark:bg-card"
                disabled={settingsMutation.isPending}
                onClick={() => void applySettings({ trustProject: { projectId: activeProject.id, trusted: true } })}
              >
                <ShieldCheck aria-hidden="true" />
                {t("skills:market.trustProject")}
              </Button>
            </div>
          )}

          {catalogQuery.isError && (
            <div role="alert" className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-status-danger-border bg-status-danger-bg p-4 text-xs leading-[1.5]">
              <p className="text-status-danger">{skillError(t, catalogQuery.error)}</p>
              <Button variant="outline" size="sm" disabled={catalogQuery.isFetching} onClick={() => void catalogQuery.refetch()}>
                {t("skills:market.retry")}
              </Button>
            </div>
          )}

          {catalogQuery.isPending && !catalog && <SkillsSkeleton label={t("skills:market.loading")} />}

          {catalog && (
            <div className={cn("mt-6 transition-opacity duration-150", catalogQuery.isPlaceholderData && "opacity-65")}>
              <p role="status" className="sr-only">{t("skills:market.count", { count: visible.length })}</p>

              {visible.length === 0 ? (
                <Empty className="mt-3 rounded-2xl border border-dashed border-border bg-muted/30 py-12">
                  <EmptyHeader>
                    <EmptyTitle>
                      <h2>
                        {t(
                          catalog.projects.length === 0 && catalog.directories.length === 0
                            ? "skills:market.noProject"
                            : search || filter !== "all"
                              ? "skills:market.noMatches"
                              : "skills:market.empty",
                        )}
                      </h2>
                    </EmptyTitle>
                  </EmptyHeader>
                  {(search || filter !== "all") && (
                    <EmptyContent>
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-lg"
                        onClick={() => { setSearch(""); setFilter("all"); }}
                      >
                        {t("skills:market.clearFilter")}
                      </Button>
                    </EmptyContent>
                  )}
                </Empty>
              ) : (
                <div className="space-y-7">
                  {(["local", "shared", "claude"] as const).map(kind => {
                    const skills = visible.filter(skill => skill.kind === kind);
                    if (skills.length === 0) return null;
                    return (
                      <section key={kind} aria-labelledby={`skills-${kind}-title`}>
                        <div className="mb-3 flex items-center gap-2 px-0.5">
                          <h2 id={`skills-${kind}-title`} className="text-[0.6875rem] font-medium tracking-[0.04em] text-muted-foreground uppercase">
                            {t(`skills:market.kind.${kind}`)}
                          </h2>
                          <span className="text-[0.6875rem] text-muted-foreground/75 tabular-nums">{skills.length}</span>
                        </div>
                        <ul aria-label={t(`skills:market.kind.${kind}`)} className="grid grid-cols-1 gap-x-5 gap-y-3 @min-[640px]:grid-cols-2">
                          {skills.map(skill => {
                            const key = `${skill.directoryId}::${skill.name}`;
                            return (
                              <SkillCard
                                key={skill.filePath}
                                skill={skill}
                                selected={selectedSkillKey === key}
                                toggling={settingsMutation.isPending}
                                onSelect={() => setSelectedSkillKey(key)}
                                onToggle={enabled => void applySettings({ toggleSkill: { name: skill.name, enabled } })}
                              />
                            );
                          })}
                        </ul>
                      </section>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <SkillDetailSheet
        skill={selectedSkill}
        directory={selectedSkill ? directoryMap.get(selectedSkill.directoryId) : undefined}
        projectId={catalog?.projectId}
        open={Boolean(selectedSkill)}
        toggling={settingsMutation.isPending}
        uninstalling={uninstallMutation.isPending}
        onOpenChange={open => { if (!open) setSelectedSkillKey(null); }}
        onToggleSkill={(name, enabled) => void applySettings({ toggleSkill: { name, enabled } })}
        onTrustProject={() => {
          if (activeProject) void applySettings({ trustProject: { projectId: activeProject.id, trusted: true } });
        }}
        onEnableDirectoryKind={kind => {
          void applySettings(kind === "shared" ? { sharedDirectories: true } : { claudeDirectories: true });
        }}
        onUninstall={handleUninstall}
      />

      <InstallSkillDialog
        open={installOpen}
        projectId={catalog?.projectId}
        directories={catalog?.directories ?? []}
        initialFile={droppedFile}
        isPending={installMutation.isPending}
        error={installMutation.error}
        onOpenChange={open => {
          setInstallOpen(open);
          if (!open) setDroppedFile(undefined);
        }}
        onResetError={installMutation.reset}
        onInstall={handleInstall}
      />

      <SkillDirectoriesDialog
        open={settingsOpen}
        catalog={catalog}
        saving={settingsMutation.isPending}
        onOpenChange={setSettingsOpen}
        onToggleShared={enabled => void applySettings({ sharedDirectories: enabled })}
        onToggleClaude={enabled => void applySettings({ claudeDirectories: enabled })}
        onToggleTrust={(targetProjectId, trusted) => void applySettings({ trustProject: { projectId: targetProjectId, trusted } })}
      />
    </>
  );
}
