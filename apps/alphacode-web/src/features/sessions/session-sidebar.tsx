import { useEffect, useRef, useState } from "react";
import { ChevronRight, Folder, Monitor, Plus, Search, SquarePen, SquareTerminal, X } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarInput, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton,
  SidebarMenuSubItem, useSidebar,
} from "@/components/ui/sidebar";
import type { SessionFolder } from "@/features/sessions/types";

interface SessionSidebarProps {
  folders: SessionFolder[];
  selectedSessionId: string | undefined;
  onSelectSession: (sessionId: string) => void;
  onNewSession: (folderId?: string) => void;
}

export function SessionSidebar({ folders, selectedSessionId, onSelectSession, onNewSession }: SessionSidebarProps) {
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const { setOpen, setOpenMobile, openMobile, isMobile } = useSidebar();
  const query = search.trim().toLocaleLowerCase();
  const activeFolderId = folders.find((folder) => folder.sessions.some((session) => session.id === selectedSessionId))?.id;
  const visibleFolders = folders.map((folder) => ({
    ...folder,
    sessions: `${folder.name} ${folder.path}`.toLocaleLowerCase().includes(query)
      ? folder.sessions
      : folder.sessions.filter((session) => session.title.toLocaleLowerCase().includes(query)),
  })).filter((folder) => !query || folder.sessions.length > 0);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen, openMobile]);

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
        setSearchOpen(true);
        if (isMobile) setOpenMobile(true);
        else setOpen(true);
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isMobile, setOpen, setOpenMobile]);

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
    setSearch("");
    setSearchOpen(false);
    onNewSession(activeFolder?.id);
    setOpenMobile(false);
  }

  return (
    <Sidebar aria-label="工作区侧栏" variant="sidebar">
      <SidebarHeader className="gap-0 p-0">
        <div className="flex h-11 items-center gap-2 pr-2.5 pl-4">
          <SquareTerminal className="size-[18px]" strokeWidth={1.8} aria-hidden="true" />
          <span className="text-sm font-semibold tracking-tight">AlphaCode</span>
          <Button variant="ghost" size="icon-sm" className="ml-auto size-7 text-muted-foreground" onClick={() => startSession()} disabled={!folders.length} aria-label="新建会话" title="新建会话">
            <SquarePen className="size-3.5" aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="icon-sm" className="size-7 md:hidden" aria-label="关闭侧栏" onClick={() => setOpenMobile(false)}>
            <X aria-hidden="true" />
          </Button>
        </div>
        <div className="space-y-1 px-2.5 pt-2">
        <Button variant="ghost" className="h-9 w-full justify-start gap-2 rounded-md px-2.5 text-[13px] font-normal text-muted-foreground md:h-8" aria-label="搜索会话" aria-expanded={searchOpen}
          onClick={() => {
            setSearchOpen(!searchOpen);
            if (searchOpen) setSearch("");
          }}>
          <Search className="size-3.5" aria-hidden="true" /><span>搜索会话</span>
          <kbd className="ml-auto rounded border border-sidebar-border px-1 font-sans text-[10px] leading-4 text-muted-foreground">Ctrl K</kbd>
        </Button>
        {searchOpen && (
          <div className="relative pt-1">
            <SidebarInput ref={searchRef} aria-label="搜索会话或文件夹" placeholder="搜索标题或工作区…" value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") { setSearch(""); setSearchOpen(false); }
              }} className="h-8 rounded-md pr-8 text-base md:text-[13px]" />
            {search && <Button variant="ghost" size="icon-xs" aria-label="清除搜索" className="absolute top-2 right-1" onClick={() => setSearch("")}><X aria-hidden="true" /></Button>}
          </div>
        )}
        </div>
      </SidebarHeader>
      <SidebarContent className="pt-5">
        <SidebarGroup className="px-2.5 py-0">
          <SidebarGroupLabel className="mb-1.5 h-5 px-2 text-[11px] font-medium text-muted-foreground">工作区</SidebarGroupLabel>
          <SidebarGroupContent>
            <nav aria-label="文件夹与会话">
              <SidebarMenu className="gap-4">
                {visibleFolders.map((folder) => (
                  <Collapsible key={folder.id} asChild open={Boolean(query) || !collapsedFolders.has(folder.id)}
                    onOpenChange={(open) => setFolderOpen(folder.id, open)} className="group/folder">
                    <SidebarMenuItem>
                      <div className="flex items-center gap-1">
                        <CollapsibleTrigger asChild>
                        <SidebarMenuButton title={folder.path} aria-label={`文件夹 ${folder.name}`} className="h-8 flex-1 gap-2 rounded-md px-2 text-xs text-muted-foreground md:h-7">
                          <Folder className="size-3.5!" strokeWidth={1.7} aria-hidden="true" />
                          <span className="font-medium">{folder.name}</span>
                          <ChevronRight className="ml-auto size-3! transition-transform group-data-[state=open]/folder:rotate-90" aria-hidden="true" />
                        </SidebarMenuButton>
                        </CollapsibleTrigger>
                        <Button variant="ghost" size="icon-xs" className="shrink-0 text-muted-foreground md:opacity-0 md:group-hover/folder:opacity-100 md:focus-visible:opacity-100" aria-label={`在 ${folder.name} 中新建会话`} onClick={() => startSession(folder.id)}><Plus aria-hidden="true" /></Button>
                      </div>
                      <CollapsibleContent>
                        <SidebarMenuSub className="mx-0 mt-1 gap-0.5 border-0 p-0">
                          {folder.sessions.map((session) => (
                            <SidebarMenuSubItem key={session.id}>
                              <SidebarMenuSubButton asChild isActive={selectedSessionId === session.id}
                                className="h-9 w-full rounded-md border border-transparent pr-2 pl-7 text-[13px] text-sidebar-foreground/80 data-[active=true]:border-sidebar-border data-[active=true]:bg-background data-[active=true]:font-medium data-[active=true]:text-sidebar-foreground md:h-8 dark:data-[active=true]:bg-sidebar-accent">
                                <button type="button" title={session.title} aria-current={selectedSessionId === session.id ? "page" : undefined}
                                  onClick={() => { onSelectSession(session.id); setOpenMobile(false); }}>
                                  <span>{session.title}</span>
                                </button>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                          {folder.sessions.length === 0 && <SidebarMenuSubItem className="px-2 py-2 text-xs text-muted-foreground">暂无会话</SidebarMenuSubItem>}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                ))}
              </SidebarMenu>
              {visibleFolders.length === 0 && <p role="status" className="px-2 py-5 text-xs text-muted-foreground">{query ? "没有找到匹配的会话" : "暂无工作区"}</p>}
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="h-11 flex-row items-center justify-between gap-2 px-3 py-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <div tabIndex={0} className="flex min-w-0 items-center gap-2 rounded-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Monitor className="size-3.5" aria-hidden="true" />
              <span className="text-[11px]">本地工作区</span><span className="sr-only">预览模式</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top">示例数据与本地草稿 · 未连接模型</TooltipContent>
        </Tooltip>
        <ThemeToggle />
      </SidebarFooter>
    </Sidebar>
  );
}
