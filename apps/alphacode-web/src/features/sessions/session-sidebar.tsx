import { useTranslation } from "@/i18n/react";
import { useEffect, useRef, useState } from "react";
import { Folder, Plus, Search, X, Blocks, SquarePen, RefreshCw, Settings } from "lucide-react";
import { sessionErrorMessage } from "@/features/sessions/api";
import { SessionSearch } from "@/features/sessions/session-search";
import { SessionNavItem } from "@/features/sessions/session-nav-item";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarHeader, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem, SidebarMenuSub,
  SidebarMenuSubItem, SidebarTrigger, useSidebar,
} from "@/components/ui/sidebar";
import type { SessionFolder } from "@/features/sessions/types";
import { ProjectPicker } from "./project-picker";

interface SessionSidebarProps {
  folders: SessionFolder[];
  selectedFolderId?: string;
  onSelectProject: (id: string) => void;
  onCreateProject: () => void;
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
}

export function SessionSidebar({ folders, selectedFolderId, onSelectProject, onCreateProject, selectedSessionId, onSelectSession, onNewSession, onRenameSession, onDeleteSession, creatingIds, loading, refreshing, error, onRefresh, onOpenSkills, skillsActive, onOpenSettings, settingsActive }: SessionSidebarProps) {
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
    const activeFolder = folders.find(folder => folder.id === (folderId ?? activeFolderId)) ?? folders[0];
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
    <Sidebar aria-label={t("workspace:sidebar")} variant="floating" collapsible="icon" className="workspace-sidebar">
      <SidebarHeader className="gap-0 p-0">
        <div className={compact ? "flex h-11 items-center justify-center px-1.5" : "flex h-11 items-center gap-2.5 pr-2.5 pl-4"}>
          {!compact && <>
            <img src="/icons/alphacode-32.png" srcSet="/icons/alphacode-32.png 1x, /icons/alphacode-64.png 2x, /icons/alphacode-128.png 4x" width={28} height={28} className="size-7 shrink-0" alt="" aria-hidden="true" draggable={false} />
            {/* i18next-instrument-ignore-next-line — Product name. */}
            <span className="text-sm font-semibold tracking-tight">AlphaCode</span>
          </>}
          {isMobile ? <Button variant="ghost" size="icon-sm" className="ml-auto text-muted-foreground" aria-label={t("workspace:closeSidebar")} onClick={() => setOpenMobile(false)}>
            <X aria-hidden="true" />
          </Button> : <SidebarTrigger aria-label={t("workspace:toggleSidebar")} title={t("workspace:toggleSidebarHint")} className={compact ? "rail-action text-muted-foreground" : "ml-auto text-muted-foreground"} />}
        </div>
      </SidebarHeader>
      {compact ? <>
        <SidebarHeader className="items-center gap-2 px-1.5 pt-2 pb-2">
          <Tooltip><TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="rail-action" aria-label={t("sessions:new")} disabled={folders.length === 0} onClick={() => startSession()}><SquarePen aria-hidden="true" /></Button>
          </TooltipTrigger><TooltipContent side="right">{t("sessions:new")}</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild>
            <Button ref={searchTriggerRef} variant="ghost" size="icon" className="rail-action" aria-label={t("sessions:search")} aria-haspopup="dialog" aria-expanded={searchOpen} onClick={() => setSearchOpen(true)}><Search aria-hidden="true" /></Button>
          </TooltipTrigger><TooltipContent side="right">{t("sessions:search")}</TooltipContent></Tooltip>
          {onOpenSkills && <Tooltip><TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="rail-action" aria-label={t("skills:market.title")} aria-current={skillsActive ? "page" : undefined} onClick={onOpenSkills}><Blocks aria-hidden="true" /></Button>
          </TooltipTrigger><TooltipContent side="right">{t("skills:market.title")}</TooltipContent></Tooltip>}
        </SidebarHeader>
        <SidebarContent className="items-center gap-2 px-1.5 py-3 group-data-[collapsible=icon]:overflow-y-auto" style={{ scrollbarGutter: "auto", scrollbarWidth: "none" }}>
          <div className="rail-divider" />
          <nav aria-label={t("workspace:folders")} className="flex flex-col gap-2">
            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="rail-action" aria-label={t("workspace:createProject")} onClick={openProjectDialog}><Plus aria-hidden="true" /></Button></TooltipTrigger><TooltipContent side="right">{t("workspace:createProject")}</TooltipContent></Tooltip>
            {folders.map(folder => <Tooltip key={folder.id}><TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="rail-action" aria-label={t("workspace:folder", { name: folder.name })} aria-expanded={false}
                data-active={!skillsActive && !settingsActive && activeFolderId === folder.id}
                onClick={() => { folderFocusRequest.current = folder.id; setFolderOpen(folder.id, true); setOpen(true); }}><Folder strokeWidth={1.7} aria-hidden="true" /></Button>
            </TooltipTrigger><TooltipContent side="right">{folder.name}</TooltipContent></Tooltip>)}
            {error && <Tooltip><TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="rail-action" aria-label={t("sessions:retryList")} disabled={refreshing} onClick={onRefresh}><RefreshCw aria-hidden="true" /></Button>
            </TooltipTrigger><TooltipContent side="right">{t("sessions:retryList")}</TooltipContent></Tooltip>}
          </nav>
        </SidebarContent>
        <SidebarFooter className="items-center px-1.5 py-3">
          <Tooltip><TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="rail-action" aria-label={t("settings:title")} aria-current={settingsActive ? "page" : undefined} onClick={onOpenSettings}><Settings aria-hidden="true" /></Button>
          </TooltipTrigger><TooltipContent side="right">{t("settings:title")}</TooltipContent></Tooltip>
        </SidebarFooter>
      </> : <>
      <SidebarHeader className="gap-0 p-0">
        <div className="space-y-1 px-2.5 pt-2">
        <Button ref={searchTriggerRef} variant="ghost" className="h-9 w-full justify-start gap-2 rounded-lg px-2.5 text-[13px] font-normal text-muted-foreground" aria-label={t("sessions:search")} aria-haspopup="dialog" aria-expanded={searchOpen}
          onClick={() => setSearchOpen(true)}>
          <Search className="size-3.5" aria-hidden="true" /><span>{t("sessions:search")}</span>
          <kbd className="ml-auto rounded border border-sidebar-border px-1 font-sans text-[10px] leading-4 text-muted-foreground">{/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ K" : "Ctrl K"}</kbd>
        </Button>
        {onOpenSkills && <Button variant="ghost" className="h-9 w-full justify-start gap-2 rounded-lg px-2.5 text-[13px] font-normal text-muted-foreground aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-foreground"
          aria-current={skillsActive ? "page" : undefined} onClick={() => { onOpenSkills(); setOpenMobile(false); }}>
          <Blocks className="size-3.5" aria-hidden="true" /><span>{t("skills:market.title")}</span>
        </Button>}
        </div>
      </SidebarHeader>
      <SidebarContent className="pt-5" style={{ scrollbarGutter: "stable both-edges" }}>
        <SidebarGroup className="px-2.5 py-0">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <ProjectPicker compact folders={folders} selectedId={activeFolderId} onSelect={id => { onSelectProject(id); setFolderOpen(id, true); setOpenMobile(false); }} onCreate={openProjectDialog} disabled={Boolean(selectedSessionId && creatingIds[selectedSessionId])} />
            <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={t("workspace:createProject")} onClick={openProjectDialog}><Plus aria-hidden="true" /></Button>
          </div>
          <SidebarGroupContent>
            {loading && <p role="status" className="px-2 py-5 text-xs text-muted-foreground">{t("sessions:loadingList")}</p>}
            {error && <div role="alert" className="space-y-2 px-2 py-3 text-xs leading-5">
              <p>{sessionErrorMessage(t, error, "list")}</p>
              {folders.length > 0 && <p className="text-muted-foreground">{t("sessions:cachedList")}</p>}
              <Button variant="outline" size="sm" disabled={refreshing} onClick={onRefresh}>{t("sessions:retryList")}</Button>
            </div>}
            <nav aria-label={t("workspace:folders")}>
              <SidebarMenu className="gap-4">
                {folders.map((folder) => (
                  <Collapsible key={folder.id} asChild open={!collapsedFolders.has(folder.id)}
                    onOpenChange={(open) => setFolderOpen(folder.id, open)}>
                    <SidebarMenuItem>
                      <div className="group/folder-header relative w-full">
                        <CollapsibleTrigger asChild>
                          <SidebarMenuButton ref={element => { if (element) folderTriggers.current.set(folder.id, element); else folderTriggers.current.delete(folder.id); }} title={folder.path} aria-label={t("workspace:folder", { name: folder.name })} className="h-8 w-full gap-2 rounded-md pr-8 pl-2 text-xs text-muted-foreground group-hover/folder-header:bg-sidebar-accent md:h-7">
                            <Folder className="size-3.5!" strokeWidth={1.7} aria-hidden="true" />
                            <span className="font-medium">{folder.name}</span>
                          </SidebarMenuButton>
                        </CollapsibleTrigger>
                        <Button variant="ghost" size="icon-xs" className="pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground opacity-0 group-hover/folder-header:pointer-events-auto group-hover/folder-header:opacity-100 group-focus-within/folder-header:pointer-events-auto group-focus-within/folder-header:opacity-100" aria-label={t("workspace:createIn", { name: folder.name })} onClick={() => startSession(folder.id)}><Plus aria-hidden="true" /></Button>
                      </div>
                      <CollapsibleContent>
                        <SidebarMenuSub className="mx-0 mt-1 translate-x-0 gap-0.5 border-0 p-0">
                          {folder.sessions.map((session) => (
                            <SidebarMenuSubItem key={session.id}>
                              <SessionNavItem session={session} active={!skillsActive && !settingsActive && selectedSessionId === session.id} disabled={creatingIds[session.id]}
                                onSelect={() => { onSelectSession(session.id); setOpenMobile(false); }}
                                onRename={onRenameSession} onDelete={onDeleteSession} />
                            </SidebarMenuSubItem>
                          ))}
                          {folder.sessions.length === 0 && <SidebarMenuSubItem className="px-2 py-2 text-xs text-muted-foreground">{t("sessions:none")}</SidebarMenuSubItem>}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                ))}
              </SidebarMenu>
              {!loading && !error && folders.length === 0 && <p role="status" className="px-2 py-5 text-xs leading-5 text-muted-foreground">{t("workspace:emptyProjects")}</p>}
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="px-2.5 pt-2 pb-3">
        <Button variant="ghost" className="h-9 w-full justify-start gap-2 rounded-lg px-2.5 text-[13px] font-normal text-muted-foreground aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground"
          aria-current={settingsActive ? "page" : undefined} onClick={() => { onOpenSettings(); setOpenMobile(false); }}>
          <Settings className="size-3.5" aria-hidden="true" /><span>{t("settings:title")}</span>
        </Button>
      </SidebarFooter>
      </>}
    </Sidebar>
    <SessionSearch open={searchOpen} onOpenChange={setSearchOpen} folders={folders}
      onSelectSession={(id) => { onSelectSession(id); setOpenMobile(false); }}
      onCloseFocus={() => {
        const target = searchReturnTarget.current;
        if (target?.isConnected && !target.closest("[inert]") && (!isMobile || openMobile)) target.focus();
        else document.querySelector<HTMLButtonElement>('[data-slot="sidebar-trigger"]')?.focus();
      }} />
    </>
  );
}
