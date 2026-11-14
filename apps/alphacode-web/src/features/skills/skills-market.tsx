import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Bug, Check, CircleAlert, Code, FolderOpen, Image, Link, Pencil, Puzzle, RefreshCw, Search, Settings2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useTranslation } from "@/i18n/react";
import { cn } from "@/lib/utils";
import { installSkill, listSkills, skillError, type InstalledSkill, type SkillDirectory } from "./api";

const selectClass = "h-9 min-w-0 rounded-md border border-input bg-background px-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 md:text-xs";

function SkillIcon({ name }: { name: string }) {
  const appearance = /image|photo|design/.test(name) ? { Icon: Image, color: "bg-cyan-50 text-cyan-600 dark:bg-cyan-950 dark:text-cyan-300" }
    : /review|debug|test/.test(name) ? { Icon: Bug, color: "bg-muted text-muted-foreground" }
    : /creat|writ|edit/.test(name) ? { Icon: Pencil, color: "bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-300" }
    : /install|plugin/.test(name) ? { Icon: Puzzle, color: "bg-rose-50 text-rose-500 dark:bg-rose-950 dark:text-rose-300" }
    : /code|develop|build/.test(name) ? { Icon: Code, color: "bg-violet-50 text-violet-500 dark:bg-violet-950 dark:text-violet-300" }
    : { Icon: BookOpen, color: "bg-orange-50 text-orange-500 dark:bg-orange-950 dark:text-orange-300" };
  return <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", appearance.color)} aria-hidden="true">
    <appearance.Icon className="size-6" strokeWidth={1.75} />
  </span>;
}

function SkillEntry({ skill }: { skill: InstalledSkill }) {
  const { t } = useTranslation();
  return <li className="min-w-0">
    <details className="group rounded-2xl open:bg-muted/50">
      <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 rounded-2xl p-2 outline-none transition-colors hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none [&::-webkit-details-marker]:hidden">
        <SkillIcon name={skill.name.toLocaleLowerCase()} />
        <div className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-5 font-medium" title={skill.name}>{skill.name}</span>
          <p className="mt-0.5 truncate text-xs leading-5 text-muted-foreground">{skill.description}</p>
        </div>
        <span className="ml-1 flex shrink-0 items-center gap-1.5 pr-1 text-muted-foreground" title={t(`skills:market.status.${skill.status}`)}>
          {skill.status === "available" ? <><Check className="size-icon opacity-65" aria-hidden="true" /><span className="sr-only">{t("skills:market.status.available")}</span></>
            : <><CircleAlert className="size-icon" aria-hidden="true" /><span className="max-w-20 text-[11px] leading-4">{t(`skills:market.status.${skill.status}`)}</span></>}
        </span>
      </summary>
      <div className="space-y-2 px-3 pt-1 pb-4 text-xs leading-5 sm:pl-[60px]">
        <p className="break-words">{skill.description}</p>
        <p className="text-muted-foreground">{t(`skills:market.scope.${skill.source}`)} · {t(`skills:market.kind.${skill.kind}`)}</p>
        <p className="break-all text-muted-foreground">{skill.filePath}</p>
        {skill.status !== "available" && <p className="text-muted-foreground">{t(`skills:market.reason.${skill.status}`)}</p>}
        {skill.userInvocable && <code className="block break-all">/{skill.name}{skill.argumentHint ? ` ${skill.argumentHint}` : ""}</code>}
        {(!skill.userInvocable || skill.disableModelInvocation) && <p className="text-muted-foreground">{t(!skill.userInvocable ? "skills:modelOnly" : "skills:manualOnly")}</p>}
      </div>
    </details>
  </li>;
}

export function SkillsMarket({ initialProjectId, showHeader = true }: { initialProjectId?: string; showHeader?: boolean }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [projectId, setProjectId] = useState(initialProjectId);
  const [filter, setFilter] = useState<"all" | SkillDirectory["kind"]>("all");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mode, setMode] = useState<"zip" | "link">("zip");
  const [directoryId, setDirectoryId] = useState("user-local");
  const [file, setFile] = useState<File>();
  const [url, setUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const query = useQuery({ queryKey: ["skills", projectId], queryFn: ({ signal }) => listSkills(projectId, signal), retry: false });
  const catalog = query.data;
  const installation = useMutation({ mutationFn: installSkill,
    onSuccess: () => {
      setFile(undefined); setUrl(""); setAdding(false);
      if (fileInput.current) fileInput.current.value = "";
      void client.invalidateQueries({ queryKey: ["skills"] });
    },
  });
  const enabledDirectories = catalog?.directories.filter(item => item.enabled) ?? [];
  const directory = enabledDirectories.find(item => item.id === directoryId)
    ?? enabledDirectories.find(item => item.id === "user-local") ?? enabledDirectories[0];
  const visible = (catalog?.skills ?? []).filter(skill => (filter === "all" || skill.kind === filter)
    && `${skill.name} ${skill.description} ${skill.filePath}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const directoryLabel = (item: SkillDirectory) => `${t(`skills:market.scope.${item.source}`)} · ${t(`skills:market.kind.${item.kind}`)}`;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!catalog?.projectId || installation.isPending || !directory?.enabled || (mode === "zip" ? !file : !url.trim())) return;
    installation.mutate({ projectId: catalog.projectId, directoryId: directory.id, ...(mode === "zip" ? { file } : { url: url.trim() }) });
  }

  return <>
    {showHeader && <header className="workspace-toolbar flex h-11 shrink-0 items-center gap-2 px-3 sm:px-4">
      <SidebarTrigger mobileOnly aria-label={t("workspace:toggleSidebar")} className="text-muted-foreground" />
      <span className="flex-1 text-[13px] font-medium">{t("skills:market.title")}</span>
    </header>}
    <section id="skills-content" aria-labelledby="skills-title" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none">
      <div className="@container mx-auto max-w-[964px] px-5 py-7 sm:px-8 sm:py-9">
        <div className="flex flex-col justify-between gap-5 @min-[740px]:flex-row @min-[740px]:items-start">
          <div className="min-w-0">
            <h1 id="skills-title" className="text-[22px] leading-8 font-medium tracking-tight">{t("skills:market.title")}</h1>
            <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">{t("skills:market.description")}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2 @min-[740px]:pt-0.5">
            <div className="relative min-w-0 flex-1 @min-[740px]:w-60 @min-[740px]:flex-none">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-icon -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input className="h-8 rounded-full border-border/80 bg-transparent pl-8 shadow-none md:text-xs" type="search" aria-label={t("skills:market.search")} placeholder={t("skills:market.search")} value={search} onChange={event => setSearch(event.target.value)} />
            </div>
            <Button variant="ghost" size="icon-sm" className="size-8 rounded-full text-muted-foreground" aria-label={t("skills:market.refresh")} title={t("skills:market.refresh")} disabled={query.isFetching} onClick={() => void query.refetch()}>
              <RefreshCw className={cn(query.isFetching && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="icon-sm" className={cn("size-8 rounded-full text-muted-foreground", settingsOpen && "bg-muted text-foreground")} aria-label={t("skills:market.settings")} title={t("skills:market.settings")} aria-expanded={settingsOpen} aria-controls="skill-settings" onClick={() => setSettingsOpen(previous => !previous)}>
              <Settings2 aria-hidden="true" />
            </Button>
            <Button size="sm" className="h-8 rounded-full bg-foreground px-3 text-background hover:bg-foreground/90" disabled={!catalog?.projectId || installation.isPending} aria-expanded={adding} aria-controls="skill-install" onClick={() => { installation.reset(); setAdding(previous => !previous); }}>
              {t("skills:market.add")}
            </Button>
          </div>
        </div>

        {settingsOpen && catalog && <div id="skill-settings" role="region" aria-label={t("skills:market.settings")} className="mt-6 rounded-2xl bg-muted/50 p-4 sm:p-5">
        {catalog.projects.length > 0 && <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="skills-project" className="text-xs text-muted-foreground">{t("skills:market.project")}</label>
          <select id="skills-project" className={cn(selectClass, "max-w-full flex-1 sm:max-w-md sm:flex-none")} value={catalog.projectId} disabled={installation.isPending}
            onChange={event => { setProjectId(event.target.value); installation.reset(); }}>
            {catalog.projects.map(project => <option key={project.id} value={project.id}>{project.path}</option>)}
          </select>
        </div>}
        <div role="group" aria-label={t("skills:market.filter")} className="mt-4 flex flex-wrap gap-1">
          {(["all", "local", "shared", "claude"] as const).filter(kind => kind !== "claude" || catalog.skills.some(skill => skill.kind === "claude")).map(kind =>
            <Button key={kind} variant={filter === kind ? "secondary" : "ghost"} size="sm" className="rounded-full" aria-pressed={filter === kind} onClick={() => setFilter(kind)}>{t(`skills:market.kind.${kind}`)}</Button>)}
        </div>
        {catalog.directories.length > 0 && <details className="mt-4 border-t border-border/60 pt-4">
          <summary className="cursor-pointer rounded-sm text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50">{t("skills:market.directories")}</summary>
          <ul className="mt-3 space-y-4">{catalog.directories.map(item => <li key={item.id} className="flex items-start gap-2 text-xs leading-5">
            <FolderOpen className="mt-0.5 size-icon shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0"><p>{directoryLabel(item)} <span className="text-muted-foreground">· {t(!item.enabled ? "skills:market.directoryDisabled" : !item.trusted ? "skills:market.directoryUntrusted" : !item.exists ? "skills:market.directoryMissing" : "skills:market.directoryActive")}</span></p>
              <p className="break-all text-muted-foreground">{item.path}</p></div>
          </li>)}</ul>
        </details>}
        {catalog.diagnostics.length > 0 && <details className="mt-4 text-xs leading-5"><summary className="cursor-pointer rounded-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50">{t("skills:market.diagnostics", { count: catalog.diagnostics.length })}</summary>
          <ul className="mt-2 space-y-2">{catalog.diagnostics.map((item, index) => <li key={`${item.path}-${index}`} className="break-all text-muted-foreground"><code>{item.code}</code><p>{item.path}</p></li>)}</ul>
        </details>}
        <p className="mt-4 text-xs leading-5 text-muted-foreground">{t("skills:market.newSession")}</p>
        </div>}

        {installation.isSuccess && <div role="status" className="mt-5 flex items-start gap-2 rounded-md bg-muted p-3 text-xs leading-5">
          <Check className="mt-0.5 size-icon shrink-0" aria-hidden="true" />
          <div className="min-w-0"><p className="break-words font-medium">{t("skills:market.success", { names: installation.data.installed.join(", ") })}</p>
            <p className="mt-1 text-muted-foreground">{t("skills:market.newSession")}</p></div>
        </div>}

        {adding && <form id="skill-install" onSubmit={submit} aria-labelledby="skill-install-title" className="mt-5 space-y-4 rounded-lg border p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 id="skill-install-title" className="text-sm font-medium">{t("skills:market.add")}</h2>
            <Button type="button" variant="ghost" size="icon-xs" disabled={installation.isPending} onClick={() => setAdding(false)} aria-label={t("skills:market.close")}><X aria-hidden="true" /></Button>
          </div>
          <div role="group" aria-label={t("skills:market.method")} className="flex flex-wrap gap-2">
            <Button type="button" variant={mode === "zip" ? "secondary" : "ghost"} size="sm" aria-pressed={mode === "zip"} disabled={installation.isPending} onClick={() => { setMode("zip"); installation.reset(); }}><Upload aria-hidden="true" />{t("skills:market.zip")}</Button>
            <Button type="button" variant={mode === "link" ? "secondary" : "ghost"} size="sm" aria-pressed={mode === "link"} disabled={installation.isPending} onClick={() => { setMode("link"); installation.reset(); }}><Link aria-hidden="true" />{t("skills:market.link")}</Button>
          </div>
          {mode === "zip" ? <div>
            <label htmlFor="skill-zip" className={cn("flex cursor-pointer flex-col items-center gap-1 rounded-md border border-dashed px-4 py-6 text-center text-xs leading-5 focus-within:ring-2 focus-within:ring-ring/50", dragging ? "border-ring bg-muted" : "hover:bg-muted/50", installation.isPending && "pointer-events-none opacity-50")}
              onDragOver={event => { event.preventDefault(); if (!installation.isPending) setDragging(true); }} onDragLeave={() => setDragging(false)}
              onDrop={event => { event.preventDefault(); setDragging(false); if (!installation.isPending) { setFile(event.dataTransfer.files[0]); installation.reset(); } }}>
              <Upload className="mb-1 size-5 text-muted-foreground" aria-hidden="true" />
              <span className="max-w-full break-all font-medium">{file ? file.name : t("skills:market.drop")}</span>
              <span className="text-muted-foreground">{t("skills:market.zipHint")}</span>
              <input id="skill-zip" ref={fileInput} type="file" accept=".zip,application/zip" className="sr-only" aria-label={t("skills:market.zip")} disabled={installation.isPending}
                onChange={event => { setFile(event.target.files?.[0]); installation.reset(); }} />
            </label>
          </div> : <div className="space-y-2">
            <label htmlFor="skill-url" className="text-xs font-medium">{t("skills:market.urlLabel")}</label>
            <Input id="skill-url" type="url" placeholder={t("skills:market.urlPlaceholder")} value={url} required disabled={installation.isPending}
              aria-describedby="skill-link-hint" onChange={event => { setUrl(event.target.value); if (installation.isError) installation.reset(); }} />
            <p id="skill-link-hint" className="text-xs leading-5 text-muted-foreground">{t("skills:market.linkHint")}</p>
          </div>}
          <div className="space-y-2">
            <label htmlFor="skill-directory" className="block text-xs font-medium">{t("skills:market.destination")}</label>
            <select id="skill-directory" className={cn(selectClass, "w-full sm:max-w-xs")} value={directory?.id ?? ""} disabled={installation.isPending} onChange={event => setDirectoryId(event.target.value)}>
              {enabledDirectories.map(item => <option key={item.id} value={item.id}>{directoryLabel(item)}</option>)}
            </select>
            {directory && <p className="break-all text-xs leading-5 text-muted-foreground">{directory.path}</p>}
            {directory && !directory.trusted && <p className="text-xs leading-5 text-muted-foreground">{t("skills:market.trustHint")}</p>}
          </div>
          {installation.isError && <p role="alert" className="text-xs leading-5 text-destructive">{skillError(t, installation.error)}</p>}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className="max-w-lg text-xs leading-5 text-muted-foreground">{t("skills:market.installHint")}</p>
            <Button type="submit" size="sm" disabled={installation.isPending || !directory?.enabled || (mode === "zip" ? !file : !url.trim())}>
              {installation.isPending && <RefreshCw className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              {t(installation.isPending ? "skills:market.installing" : "skills:market.install")}
            </Button>
          </div>
        </form>}

        {query.isError && <div role="alert" className="mt-5 space-y-2 text-xs leading-5"><p className="text-destructive">{skillError(t, query.error)}</p>
          <Button variant="outline" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>{t("skills:market.retry")}</Button></div>}
        {query.isPending && <p role="status" className="py-12 text-center text-xs text-muted-foreground">{t("skills:market.loading")}</p>}

        {catalog && <>
          <div className="mt-6 flex min-h-9 items-center justify-between gap-3 border-b border-border/50 pb-3">
            <h2 className="text-sm font-medium">{t("skills:market.installed")}</h2>
            {filter !== "all" && <Button variant="secondary" size="sm" className="rounded-full" onClick={() => setFilter("all")} aria-label={t("skills:market.clearFilter")}>
              {t(`skills:market.kind.${filter}`)}<X className="size-icon" aria-hidden="true" />
            </Button>}
            <p role="status" className="sr-only">{t("skills:market.count", { count: visible.length })}</p>
          </div>
          {visible.length === 0 ? <div className="py-10 text-center">
            <h2 className="text-sm font-medium">{t(catalog.projects.length === 0 ? "skills:market.noProject" : search || filter !== "all" ? "skills:market.noMatches" : "skills:market.empty")}</h2>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{t(catalog.projects.length === 0 ? "skills:market.noProjectHint" : search || filter !== "all" ? "skills:market.noMatchesHint" : "skills:market.emptyHint")}</p>
          </div> : <div className="mt-4 space-y-8">
            {(["local", "shared", "claude"] as const).map(kind => {
              const skills = visible.filter(skill => skill.kind === kind);
              if (skills.length === 0) return null;
              return <section key={kind} aria-labelledby={`skills-${kind}-title`}>
                {kind !== "local" && <h3 id={`skills-${kind}-title`} className="mb-5 inline-flex rounded-full bg-muted/70 px-4 py-2 text-xs font-medium">{t(`skills:market.kind.${kind}`)}</h3>}
                {kind === "local" && <h3 id={`skills-${kind}-title`} className="sr-only">{t("skills:market.kind.local")}</h3>}
                <ul aria-label={t(`skills:market.kind.${kind}`)} className="grid grid-cols-1 items-start gap-x-6 gap-y-3 @min-[640px]:grid-cols-2">
                  {skills.map(skill => <SkillEntry key={skill.filePath} skill={skill} />)}
                </ul>
              </section>;
            })}
          </div>}
        </>}
      </div>
    </section>
  </>;
}
