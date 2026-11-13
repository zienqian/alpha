import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, ChevronRight, FolderOpen, Link, Plus, RefreshCw, Search, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useTranslation } from "@/i18n/react";
import { cn } from "@/lib/utils";
import { installSkill, listSkills, skillError, type SkillDirectory } from "./api";

const selectClass = "h-9 min-w-0 rounded-md border border-input bg-background px-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 md:text-xs";

export function SkillsMarket({ initialProjectId, onBack, showHeader = true }: { initialProjectId?: string; onBack: () => void; showHeader?: boolean }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [projectId, setProjectId] = useState(initialProjectId);
  const [filter, setFilter] = useState<"all" | SkillDirectory["kind"]>("all");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
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
      <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft aria-hidden="true" />{t("skills:market.back")}</Button>
    </header>}
    <section id="skills-content" aria-labelledby="skills-title" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none">
      <div className="mx-auto max-w-4xl px-5 py-7 sm:px-8 sm:py-9">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 id="skills-title" className="text-[22px] leading-8 font-medium tracking-tight">{t("skills:market.title")}</h1>
            <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">{t("skills:market.description")}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="icon-sm" aria-label={t("skills:market.refresh")} title={t("skills:market.refresh")} disabled={query.isFetching} onClick={() => void query.refetch()}>
              <RefreshCw className={cn(query.isFetching && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
            </Button>
            <Button size="sm" disabled={!catalog?.projectId || installation.isPending} aria-expanded={adding} aria-controls="skill-install" onClick={() => { installation.reset(); setAdding(previous => !previous); }}>
              <Plus aria-hidden="true" />{t("skills:market.add")}
            </Button>
          </div>
        </div>

        {catalog && catalog.projects.length > 0 && <div className="mt-5 flex flex-wrap items-center gap-2">
          <label htmlFor="skills-project" className="text-xs text-muted-foreground">{t("skills:market.project")}</label>
          <select id="skills-project" className={cn(selectClass, "max-w-full flex-1 sm:max-w-md sm:flex-none")} value={catalog.projectId} disabled={installation.isPending}
            onChange={event => { setProjectId(event.target.value); installation.reset(); }}>
            {catalog.projects.map(project => <option key={project.id} value={project.id}>{project.path}</option>)}
          </select>
        </div>}

        {installation.isSuccess && <div role="status" className="mt-5 flex items-start gap-2 rounded-md bg-muted p-3 text-xs leading-5">
          <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
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
          <div className="mt-7 flex flex-col justify-between gap-3 border-b pb-3 sm:flex-row sm:items-center">
            <div role="group" aria-label={t("skills:market.filter")} className="flex flex-wrap gap-1">
              {(["all", "local", "shared", "claude"] as const).filter(kind => kind !== "claude" || catalog.skills.some(skill => skill.kind === "claude")).map(kind =>
                <Button key={kind} variant={filter === kind ? "secondary" : "ghost"} size="sm" aria-pressed={filter === kind} onClick={() => setFilter(kind)}>{t(`skills:market.kind.${kind}`)}</Button>)}
            </div>
            <div className="relative sm:w-56"><Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input className="h-8 pl-8 md:text-xs" type="search" aria-label={t("skills:market.search")} placeholder={t("skills:market.search")} value={search} onChange={event => setSearch(event.target.value)} />
            </div>
          </div>
          <p role="status" className="py-3 text-[11px] text-muted-foreground">{t("skills:market.count", { count: visible.length })}</p>
          {visible.length === 0 ? <div className="py-10 text-center">
            <h2 className="text-sm font-medium">{t(catalog.projects.length === 0 ? "skills:market.noProject" : search || filter !== "all" ? "skills:market.noMatches" : "skills:market.empty")}</h2>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{t(catalog.projects.length === 0 ? "skills:market.noProjectHint" : search || filter !== "all" ? "skills:market.noMatchesHint" : "skills:market.emptyHint")}</p>
          </div> : <ul aria-label={t("skills:market.installed")} className="divide-y divide-border/70">
            {visible.map(skill => <li key={skill.filePath} className="py-4">
              <details className="group">
                <summary className="flex cursor-pointer list-none items-start gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="break-all text-[13px] font-medium">{skill.name}</span>
                      <span className="text-[11px] text-muted-foreground">{t(`skills:market.scope.${skill.source}`)} · {t(`skills:market.kind.${skill.kind}`)}</span>
                      <span className={cn("rounded border px-1.5 py-0.5 text-[10px] leading-3", skill.status === "available" ? "border-transparent bg-muted text-foreground" : "text-muted-foreground")}>{t(`skills:market.status.${skill.status}`)}</span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 break-words text-xs leading-5 text-muted-foreground">{skill.description}</p>
                  </div>
                </summary>
                <div className="mt-3 space-y-2 pl-5.5 text-xs leading-5">
                  <p className="break-words">{skill.description}</p>
                  <p className="break-all text-muted-foreground">{skill.filePath}</p>
                  {skill.status !== "available" && <p className="text-muted-foreground">{t(`skills:market.reason.${skill.status}`)}</p>}
                  {skill.userInvocable && <code className="block break-all">/{skill.name}{skill.argumentHint ? ` ${skill.argumentHint}` : ""}</code>}
                  {(!skill.userInvocable || skill.disableModelInvocation) && <p className="text-muted-foreground">{t(!skill.userInvocable ? "skills:modelOnly" : "skills:manualOnly")}</p>}
                </div>
              </details>
            </li>)}
          </ul>}

          {catalog.directories.length > 0 && <details className="mt-7 border-t pt-4">
            <summary className="cursor-pointer rounded-sm text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50">{t("skills:market.directories")}</summary>
            <ul className="mt-3 space-y-4">{catalog.directories.map(item => <li key={item.id} className="flex items-start gap-2 text-xs leading-5">
              <FolderOpen className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0"><p>{directoryLabel(item)} <span className="text-muted-foreground">· {t(!item.enabled ? "skills:market.directoryDisabled" : !item.trusted ? "skills:market.directoryUntrusted" : !item.exists ? "skills:market.directoryMissing" : "skills:market.directoryActive")}</span></p>
                <p className="break-all text-muted-foreground">{item.path}</p></div>
            </li>)}</ul>
          </details>}
          {catalog.diagnostics.length > 0 && <details className="mt-4 text-xs leading-5"><summary className="cursor-pointer rounded-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50">{t("skills:market.diagnostics", { count: catalog.diagnostics.length })}</summary>
            <ul className="mt-2 space-y-2">{catalog.diagnostics.map((item, index) => <li key={`${item.path}-${index}`} className="break-all text-muted-foreground"><code>{item.code}</code><p>{item.path}</p></li>)}</ul>
          </details>}
          <p className="mt-7 text-xs leading-5 text-muted-foreground">{t("skills:market.newSession")}</p>
        </>}
      </div>
    </section>
  </>;
}
