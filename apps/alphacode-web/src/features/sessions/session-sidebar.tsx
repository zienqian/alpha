import { useTranslation } from "@/i18n/react";
import { useEffect, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Folder, Plus, Search, X, Blocks, SquarePen, RefreshCw, Settings } from "lucide-react";
import { sessionErrorMessage } from "@/features/sessions/api";
import { SessionSearch } from "@/features/sessions/session-search";
import { SessionNavItem } from "@/features/sessions/session-nav-item";
import { ProjectActions } from "@/features/sessions/project-actions";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem, SidebarMenuSub,
  SidebarMenuSubItem, SidebarTrigger, useSidebar,
} from "@/components/ui/sidebar";
import type { SessionFolder } from "@/features/sessions/types";

interface SessionSidebarProps {
  folders: SessionFolder[];
  selectedFolderId?: string;
  onCreateProject: () => void;
  onDeleteProject: (id: string) => Promise<void>;
  selectedSessionId: string | undefined;
  onSelectSession: (sessionId: string) => void;
  onNewSession: (folderId?: string) => void;
  onRenameSession: (id: string, title: string) => Promise<void>;
  onDeleteSession: (id: string) => Promise<void>;
  creatingIds: Record<string, boolean>;
  loading: boolean;
  refreshing: boolean;
  error: Error | null;
  onRefresh: () => void;
  onOpenSkills?: () => void;
  skillsActive?: boolean;
  onOpenSettings: () => void;
  settingsActive: boolean;
  onAddToCanvas?: (id: string) => void;
}

export function SessionSidebar({ folders, selectedFolderId, onCreateProject, onDeleteProject, selectedSessionId, onSelectSession, onNewSession, onRenameSession, onDeleteSession, creatingIds, loading, refreshing, error, onRefresh, onOpenSkills, skillsActive, onOpenSettings, settingsActive, onAddToCanvas }: SessionSidebarProps) {
  const { t } = useTranslation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const searchReturnTarget = useRef<HTMLButtonElement | null>(null);
  const folderTriggers = useRef(new Map<string, HTMLButtonElement>());
  const folderFocusRequest = useRef<string | null>(null);
  const { setOpenMobile, isMobile, openMobile, state, setOpen } = useSidebar();
  const compact = !isMobile && state === "collapsed";
  const activeFolderId = selectedFolderId ?? folders.find((folder) => folder.sessions.some((session) => session.id === selectedSessionId))?.id;

  useEffect(() => {
    if (searchOpen) searchReturnTarget.current = searchTriggerRef.current;
  }, [searchOpen]);

  useEffect(() => {
    if (!compact && folderFocusRequest.current) {
      folderTriggers.current.get(folderFocusRequest.current)?.focus();
      folderFocusRequest.current = null;
    }
  }, [compact]);

  useEffect(() => {
    if (!activeFolderId) return;
    setCollapsedFolders((previous) => {
      if (!previous.has(activeFolderId)) return previous;
      const next = new Set(previous);
      next.delete(activeFolderId);
      return next;
    });
  }, [activeFolderId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((previous) => !previous);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function setFolderOpen(folderId: string, open: boolean) {
    setCollapsedFolders((previous) => {
      const next = new Set(previous);
      if (open) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  function startSession(folderId?: string) {
    const activeFolder = folders.find(folder => folder.id === folderId);
    if (activeFolder) setFolderOpen(activeFolder.id, true);
    setSearchOpen(false);
    onNewSession(activeFolder?.id);
    setOpenMobile(false);
  }

  function openProjectDialog() {
    setOpenMobile(false);
    onCreateProject();
  }

  return (
    <>
    <Sidebar aria-label={t("workspace:sidebar")} variant="sidebar" collapsible="icon" className="workspace-sidebar">
      <SidebarHeader className="sidebar-drag-header gap-0 p-0">
        <div className={compact ? "sidebar-brand-row flex h-11 items-center justify-center px-1.5" : "sidebar-brand-row flex h-11 min-w-0 items-center gap-2 px-(--sidebar-inset) @max-[200px]:gap-1.5 @max-[200px]:px-1.5"}>
          {!compact && <>
            <img src="/icons/alphacode-32.png" srcSet="/icons/alphacode-32.png 1x, /icons/alphacode-64.png 2x, /icons/alphacode-128.png 4x" width={20} height={20} className="size-5 shrink-0" alt="" aria-hidden="true" draggable={false} />
            {/* i18next-instrument-ignore-next-line — Product name. */}
            <span className="min-w-0 truncate text-[0.875rem] leading-[1.3] font-semibold tracking-[-0.018em] text-foreground">AlphaCode</span>
          </>}
          {isMobile ? <Button variant="ghost" size="icon-sm" className="ms-auto shrink-0 text-(--sidebar-muted) hover:bg-(--sidebar-hover) hover:text-sidebar-accent-foreground" aria-label={t("workspace:closeSidebar")} onClick={() => setOpenMobile(false)}>
            <X aria-hidden="true" />
          </Button> : <SidebarTrigger aria-label={t("workspace:toggleSidebar")} title={t("workspace:toggleSidebarHint")} className={compact ? "rail-action shrink-0 text-(--sidebar-muted) hover:bg-(--sidebar-hover) hover:text-sidebar-accent-foreground" : "ms-auto shrink-0 text-(--sidebar-muted) hover:bg-(--sidebar-hover) hover:text-sidebar-accent-foreground"} />}
        </div>
      </SidebarHeader>
      {compact ? <>
        <SidebarHeader className="items-center gap-1.5 px-1.5 pt-2 pb-2">
          <Tooltip><TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="rail-action hover:bg-(--sidebar-hover) hover:text-sidebar-accent-foreground" aria-label={t("sessions:new")} onClick={() => startSession()}><SquarePen aria-hidden="true" /></Button>
          </TooltipTrigger><TooltipContent side="right">{t("sessions:new")}</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild>
            <Button ref={searchTriggerRef} variant="ghost" size="icon" className="rail-action hover:bg-(--sidebar-hover) hover:text-sidebar-accent-foreground" aria-label={t("sessions:search")} aria-haspopup="dialog" aria-expanded={searchOpen} onClick={() => setSearchOpen(true)}><Search aria-hidden="true" /></Button>
          </TooltipTrigger><TooltipContent side="right">{t("sessions:search")}</TooltipContent></Tooltip>
          {onOpenSkills && <Tooltip><TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="rail-action hover:bg-(--sidebar-hover) hover:text-sidebar-accent-foreground" aria-label={t("skills:market.title")} aria-current={skillsActive ? "page" : undefined} onClick={onOpenSkills}><Blocks aria-hidden="true" /></Button>
          </TooltipTrigger><TooltipContent side="right">{t("skills:market.title")}</TooltipContent></Tooltip>}
        </SidebarHeader>
        <SidebarContent className="items-center gap-1.5 px-1.5 py-2.5 group-data-[collapsible=icon]:overflow-y-auto" style={{ scrollbarGutter: "auto", scrollbarWidth: "none" }}>
          <div className="rail-divider" />
          <nav aria-label={t("workspace:folders")} className="flex flex-col gap-1.5">
            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="rail-action hover:bg-(--sidebar-hover) hover:text-sidebar-accent-foreground" aria-label={t("workspace:createProject")} onClick={openProjectDialog}><Plus aria-hidden="true" /></Button></TooltipTrigger><TooltipContent side="right">{t("workspace:createProject")}</TooltipContent></Tooltip>
            {folders.map(folder => <Tooltip key={folder.id}><TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="rail-action hover:bg-(--sidebar-hover) hover:text-sidebar-accent-foreground" aria-label={t("workspace:folder", { name: folder.name })} aria-expanded={false}
                data-active={!skillsActive && !settingsActive && activeFolderId === folder.id}
                onClick={() => { folderFocusRequest.current = folder.id; setFolderOpen(folder.id, true); setOpen(true); }}><Folder aria-hidden="true" /></Button>
            </TooltipTrigger><TooltipContent side="right">{folder.name}</TooltipContent></Tooltip>)}
            {error && <Tooltip><TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="rail-action hover:bg-(--sidebar-hover) hover:text-sidebar-accent-foreground" aria-label={t("sessions:retryList")} disabled={refreshing} onClick={onRefresh}><RefreshCw aria-hidden="true" /></Button>
            </TooltipTrigger><TooltipContent side="right">{t("sessions:retryList")}</TooltipContent></Tooltip>}
          </nav>
        </SidebarContent>
        <SidebarFooter className="items-center px-1.5 py-2.5">
          <Tooltip><TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="rail-action hover:bg-(--sidebar-hover) hover:text-sidebar-accent-foreground" aria-label={t("settings:title")} aria-current={settingsActive ? "page" : undefined} onClick={onOpenSettings}><Settings aria-hidden="true" /></Button>
          </TooltipTrigger><TooltipContent side="right">{t("settings:title")}</TooltipContent></Tooltip>
        </SidebarFooter>
      </> : <>
      <SidebarHeader className="gap-0 p-0">
        <div className="space-y-0.5 px-(--sidebar-inset) pt-1.5">
          <Button ref={searchTriggerRef} variant="ghost" size="sm" static
            className="sidebar-nav-link h-8.5 w-full justify-start gap-2.5 rounded-lg px-2.5 text-[0.8125rem] font-normal text-sidebar-foreground hover:bg-(--sidebar-hover) hover:text-sidebar-accent-foreground"
            aria-label={t("sessions:search")} aria-haspopup="dialog" aria-expanded={searchOpen}
            onClick={() => setSearchOpen(true)}>
            <Search className="size-icon text-(--sidebar-muted)" aria-hidden="true" />
            <span className="truncate">{t("sessions:search")}</span>
            <kbd className="ms-auto rounded-[5px] border border-sidebar-border/70 bg-black/[0.03] px-1.5 py-0.5 font-sans text-[0.6875rem] leading-none font-medium text-(--sidebar-muted) dark:bg-white/[0.06] @max-[200px]:hidden">{/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ K" : "Ctrl K"}</kbd>
          </Button>
          {onOpenSkills && <Button variant="ghost" size="sm"
            className="sidebar-nav-link h-8.5 w-full justify-start gap-2.5 rounded-lg px-2.5 text-[0.8125rem] font-normal text-sidebar-foreground hover:bg-(--sidebar-hover) hover:text-sidebar-accent-foreground"
            aria-current={skillsActive ? "page" : undefined} onClick={() => { onOpenSkills(); setOpenMobile(false); }}>
            <Blocks className="size-icon text-(--sidebar-muted)" aria-hidden="true" /><span>{t("skills:market.title")}</span>
          </Button>}
        </div>
      </SidebarHeader>
      <SidebarContent className="relative overflow-hidden pt-4">
        <ScrollArea type="auto" className="sidebar-scroll-fade min-h-0 flex-1" viewportClassName="[&>div]:block!" scrollbarClassName="w-1.5 border-0">
        <SidebarGroup className="px-(--sidebar-inset) py-0 pb-6">
          <div className="mb-1 flex items-center justify-between gap-2">
            <SidebarGroupLabel className="h-7 px-2.5 text-[0.75rem] font-medium text-(--sidebar-muted)">{t("workspace:projects")}</SidebarGroupLabel>
            <Button data-create-project variant="ghost" size="icon-sm" className="text-(--sidebar-muted) hover:bg-(--sidebar-hover) hover:text-sidebar-accent-foreground" aria-label={t("workspace:createProject")} onClick={openProjectDialog}><Plus aria-hidden="true" /></Button>
          </div>
          <SidebarGroupContent>
            {loading && <p role="status" className="px-2.5 py-5 text-xs text-(--sidebar-muted)">{t("sessions:loadingList")}</p>}
            {error && <div role="alert" className="space-y-2.5 rounded-xl border border-status-danger-border bg-status-danger-bg p-3 text-xs leading-[1.45]">
              <p className="text-status-danger">{sessionErrorMessage(t, error, "list")}</p>
              <Button variant="outline" size="sm" disabled={refreshing} onClick={onRefresh}>{t("sessions:retryList")}</Button>
            </div>}
            <nav aria-label={t("workspace:folders")}>
              <SidebarMenu className="gap-3">
                {folders.map((folder) => (
                  <Collapsible key={folder.id} asChild open={!collapsedFolders.has(folder.id)}
                    onOpenChange={(open) => setFolderOpen(folder.id, open)}>
                    <SidebarMenuItem>
                      <div className="group/folder-header relative w-full">
                        <CollapsibleTrigger asChild>
                          <SidebarMenuButton ref={element => { if (element) folderTriggers.current.set(folder.id, element); else folderTriggers.current.delete(folder.id); }}
                            title={folder.path} aria-label={t("workspace:folder", { name: folder.name })}
                            className="h-8 w-full gap-2 rounded-lg pe-14 ps-2.5 text-[0.75rem] text-(--sidebar-muted) transition-colors duration-100 ease-out hover:bg-(--sidebar-hover) hover:text-sidebar-accent-foreground group-hover/folder-header:bg-(--sidebar-hover) group-hover/folder-header:text-sidebar-accent-foreground md:h-7.5">
                            <Folder className="size-icon text-(--sidebar-muted)" aria-hidden="true" />
                            <span className="font-medium">{folder.name}</span>
                          </SidebarMenuButton>
                        </CollapsibleTrigger>
                        <ProjectActions folder={folder} onNewSession={() => startSession(folder.id)} onDelete={onDeleteProject} />
                      </div>
                      <CollapsibleContent>
                        <SidebarMenuSub className="mx-0 mt-0.5 translate-x-0 gap-0.5 border-0 p-0">
                          {folder.sessions.map((session) => (
                            <SidebarMenuSubItem key={session.id}>
                              <SessionNavItem session={session} active={!skillsActive && !settingsActive && selectedSessionId === session.id} disabled={creatingIds[session.id]}
                                onSelect={() => { onSelectSession(session.id); setOpenMobile(false); }}
                                onAddToCanvas={onAddToCanvas ? () => { onAddToCanvas(session.id); setOpenMobile(false); } : undefined}
                                onRename={onRenameSession} onDelete={onDeleteSession} />
                            </SidebarMenuSubItem>
                          ))}
                          {folder.sessions.length === 0 && <SidebarMenuSubItem className="py-1.5 pe-3 ps-8 text-xs text-(--sidebar-muted)/80">{t("sessions:none")}</SidebarMenuSubItem>}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                ))}
              </SidebarMenu>
              {!loading && !error && folders.length === 0 && <p role="status" className="px-2.5 py-5 text-xs leading-[1.5] text-(--sidebar-muted)">{t("workspace:emptyProjects")}</p>}
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
        </ScrollArea>
      </SidebarContent>
      <SidebarFooter className="px-(--sidebar-inset) py-2">
        <Button variant="ghost" size="sm"
          className="sidebar-nav-link h-8.5 w-full justify-start gap-2.5 rounded-lg px-2.5 text-[0.8125rem] font-normal text-sidebar-foreground hover:bg-(--sidebar-hover) hover:text-sidebar-accent-foreground"
          aria-current={settingsActive ? "page" : undefined} onClick={() => { onOpenSettings(); setOpenMobile(false); }}>
          <Settings className="size-icon text-(--sidebar-muted)" aria-hidden="true" /><span>{t("settings:title")}</span>
        </Button>
      </SidebarFooter>
      </>}
    </Sidebar>
    <SessionSearch open={searchOpen} onOpenChange={setSearchOpen} folders={folders}
      onNewSession={() => startSession()} onOpenFolder={openProjectDialog}
      onSelectSession={(id) => { onSelectSession(id); setOpenMobile(false); }}
      onCloseFocus={() => {
        const target = searchReturnTarget.current;
        if (target?.isConnected && !target.closest("[inert]") && (!isMobile || openMobile)) target.focus();
        else document.querySelector<HTMLButtonElement>('[data-slot="sidebar-trigger"]')?.focus();
      }} />
    </>
  );
}
