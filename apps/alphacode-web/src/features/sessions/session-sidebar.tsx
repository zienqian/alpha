import { useTranslation } from "@/i18n/react";
import { useEffect, useRef, useState } from "react";
import { Folder, Plus, Search, SquareTerminal, X, Blocks } from "lucide-react";
import { sessionErrorMessage } from "@/features/sessions/api";
import { SessionSearch } from "@/features/sessions/session-search";
import { SessionTitle } from "@/features/sessions/session-title";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageToggle } from "@/components/language-toggle";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton,
  SidebarMenuSubItem, useSidebar,
} from "@/components/ui/sidebar";
import type { SessionFolder } from "@/features/sessions/types";

interface SessionSidebarProps {
  folders: SessionFolder[];
  selectedSessionId: string | undefined;
  onSelectSession: (sessionId: string) => void;
  onNewSession: (folderId?: string) => void;
  loading: boolean;
  refreshing: boolean;
  error: Error | null;
  onRefresh: () => void;
  onOpenSkills?: () => void;
  skillsActive?: boolean;
}

export function SessionSidebar({ folders, selectedSessionId, onSelectSession, onNewSession, loading, refreshing, error, onRefresh, onOpenSkills, skillsActive }: SessionSidebarProps) {
  const { t } = useTranslation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const { setOpenMobile, isMobile, openMobile } = useSidebar();
  const activeFolderId = folders.find((folder) => folder.sessions.some((session) => session.id === selectedSessionId))?.id;

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
    const activeFolder = (folderId ? folders.find((folder) => folder.id === folderId) : folders.find((folder) => folder.sessions.some((session) => session.id === selectedSessionId))) ?? folders[0];
    if (activeFolder) setFolderOpen(activeFolder.id, true);
    setSearchOpen(false);
    onNewSession(activeFolder?.id);
    setOpenMobile(false);
  }

  return (
    <>
    <Sidebar aria-label={t("workspace:sidebar")} variant="sidebar">
      <SidebarHeader className="gap-0 p-0">
        <div className="flex h-11 items-center gap-2 pr-2.5 pl-4">
          <SquareTerminal className="size-[18px]" strokeWidth={1.8} aria-hidden="true" />
          {/* i18next-instrument-ignore-next-line — Product name. */}
          <span className="text-sm font-semibold tracking-tight">AlphaCode</span>
          <Button variant="ghost" size="icon-sm" className="ml-auto text-muted-foreground md:hidden" aria-label={t("workspace:closeSidebar")} onClick={() => setOpenMobile(false)}>
            <X aria-hidden="true" />
          </Button>
        </div>
        <div className="space-y-1 px-2.5 pt-2">
        <Button ref={searchTriggerRef} variant="ghost" className="h-9 w-full justify-start gap-2 rounded-md px-2.5 text-[13px] font-normal text-muted-foreground md:h-8" aria-label={t("sessions:search")} aria-haspopup="dialog" aria-expanded={searchOpen}
          onClick={() => setSearchOpen(true)}>
          <Search className="size-3.5" aria-hidden="true" /><span>{t("sessions:search")}</span>
          <kbd className="ml-auto rounded border border-sidebar-border px-1 font-sans text-[10px] leading-4 text-muted-foreground">{/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ K" : "Ctrl K"}</kbd>
        </Button>
        {onOpenSkills && <Button variant="ghost" className="h-9 w-full justify-start gap-2 rounded-md px-2.5 text-[13px] font-normal text-muted-foreground aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-foreground md:h-8"
          aria-current={skillsActive ? "page" : undefined} onClick={() => { onOpenSkills(); setOpenMobile(false); }}>
          <Blocks className="size-3.5" aria-hidden="true" /><span>{t("skills:market.title")}</span>
        </Button>}
        </div>
      </SidebarHeader>
      <SidebarContent className="pt-5" style={{ scrollbarGutter: "stable both-edges" }}>
        <SidebarGroup className="px-2.5 py-0">
          <SidebarGroupLabel className="mb-1.5 h-5 px-2 text-[11px] font-medium text-muted-foreground">{t("workspace:title")}</SidebarGroupLabel>
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
                          <SidebarMenuButton title={folder.path} aria-label={t("workspace:folder", { name: folder.name })} className="h-8 w-full gap-2 rounded-md pr-8 pl-2 text-xs text-muted-foreground group-hover/folder-header:bg-sidebar-accent md:h-7">
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
                              <SidebarMenuSubButton asChild isActive={!skillsActive && selectedSessionId === session.id}
                                className="h-9 w-full translate-x-0 rounded-md border border-transparent pr-2 pl-7 text-[13px] text-sidebar-foreground/80 data-[active=true]:border-sidebar-border data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-foreground md:h-8">
                                <button type="button" title={session.title} aria-label={session.title} aria-current={!skillsActive && selectedSessionId === session.id ? "page" : undefined}
                                  onClick={() => { onSelectSession(session.id); setOpenMobile(false); }}>
                                  <SessionTitle title={session.title} pending={session.titleStatus === "pending"} />
                                </button>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                          {folder.sessions.length === 0 && <SidebarMenuSubItem className="px-2 py-2 text-xs text-muted-foreground">{t("sessions:none")}</SidebarMenuSubItem>}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                ))}
              </SidebarMenu>
              {!loading && !error && folders.length === 0 && <p role="status" className="px-2 py-5 text-xs text-muted-foreground">{t("sessions:startCli")}</p>}
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="h-11 flex-row items-center justify-end gap-2 px-3 py-1.5">
        <div className="flex items-center"><LanguageToggle /><ThemeToggle /></div>
      </SidebarFooter>
    </Sidebar>
    <SessionSearch open={searchOpen} onOpenChange={setSearchOpen} folders={folders}
      onSelectSession={(id) => { onSelectSession(id); setOpenMobile(false); }}
      onCloseFocus={() => {
        if (isMobile ? openMobile : searchTriggerRef.current && !searchTriggerRef.current.closest("[inert]")) searchTriggerRef.current?.focus();
        else document.querySelector<HTMLButtonElement>('[data-slot="sidebar-trigger"]')?.focus();
      }} />
    </>
  );
}
