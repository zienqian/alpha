import { lazy, Suspense, type CSSProperties } from "react";
import { FolderOpen } from "lucide-react";
import { PromptInput } from "@/components/ai-elements/prompt-input";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { demoFolders } from "@/features/sessions/demo-data";
import { ContinueSessions } from "@/features/sessions/continue-sessions";
import { SessionContext } from "@/features/sessions/session-context";
import { SessionSidebar } from "@/features/sessions/session-sidebar";
import { useSessionWorkspace } from "@/features/sessions/use-session-workspace";
import { WorkspacePicker } from "@/features/sessions/workspace-picker";
import type { SessionFolder } from "@/features/sessions/types";

const SessionContent = lazy(() => import("@/features/sessions/session-content").then((module) => ({ default: module.SessionContent })));

export function App({ folders: sourceFolders = demoFolders }: { folders?: SessionFolder[] }) {
  const workspace = useSessionWorkspace(sourceFolders);
  const { folders, selectedFolder, selectedSession, selectedSessionId, draft } = workspace;
  const isWelcome = !selectedSession?.messages.length;
  const composer = <PromptInput draft={draft} onChange={workspace.updateDraft} focusRequest={workspace.focusRequest} context={isWelcome ? (
    <WorkspacePicker folders={folders} selectedFolder={selectedFolder} onSelect={workspace.changeWorkspace} />
  ) : <span className="flex min-w-0 items-center gap-1.5 text-xs" title={selectedFolder?.path}><FolderOpen className="size-3 shrink-0" aria-hidden="true" /><span className="truncate">{selectedFolder?.path}</span></span>} />;

  return (
    <SidebarProvider className="h-dvh min-h-0 overflow-hidden" style={{ "--sidebar-width": "15rem" } as CSSProperties}>
      <a href="#session-content" className="sr-only z-50 rounded-md bg-background p-3 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        跳转到会话内容
      </a>
      <SessionSidebar folders={folders} selectedSessionId={selectedSessionId} onSelectSession={workspace.selectSession} onNewSession={workspace.newSession} />
      <SidebarInset className="workspace-canvas min-h-0 min-w-0 overflow-hidden">
        <header className="flex h-11 shrink-0 items-center gap-2 px-3 sm:px-4">
          <SidebarTrigger aria-label="切换侧栏" title="切换侧栏 (Ctrl / ⌘ + B)" className="size-7 text-muted-foreground" />
          <div className="flex min-w-0 flex-1 items-center gap-2 text-[13px]">
            {!isWelcome && (
              <span className="hidden shrink-0 items-center gap-1.5 text-muted-foreground sm:flex">
                <FolderOpen className="size-3.5" aria-hidden="true" />{selectedFolder?.name}
              </span>
            )}
            {!isWelcome && <span className="hidden text-border sm:inline" aria-hidden="true">/</span>}
            {isWelcome ? <span className="truncate text-muted-foreground">新会话</span> : (
              <h1 id="session-title" className="truncate font-medium">{selectedSession.title}</h1>
            )}
          </div>
          <span className="mr-1 text-[11px] text-muted-foreground">预览</span>
          <SessionContext folder={selectedFolder} session={selectedSession} draft={draft} />
        </header>
        {isWelcome ? (
          <section id="session-content" tabIndex={-1} aria-labelledby="welcome-title" className="welcome-stage min-h-0 flex-1 overflow-y-auto px-5 outline-none sm:px-8">
            <div className="task-entry mx-auto w-full max-w-[680px]">
              <div className="mb-6">
                <h1 id="welcome-title" className="text-[22px] leading-8 font-medium tracking-tight text-balance">从这里，开始构建。</h1>
              </div>
              {composer}
              <ContinueSessions folder={selectedFolder} onSelect={workspace.selectSession} />
            </div>
          </section>
        ) : (
          <>
            <div id="session-content" key={selectedSession.id} tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
              <Suspense fallback={
                <div role="status" aria-label="正在打开会话" className="mx-auto w-full max-w-[744px] space-y-4 px-5 py-6 sm:px-8">
                  <Skeleton className="ml-auto h-14 w-2/3 rounded-xl" />
                  <Skeleton className="mt-10 h-4 w-24" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-4/5" />
                </div>
              }>
                <SessionContent session={selectedSession} />
              </Suspense>
            </div>
            <div className="mx-auto w-full max-w-[744px] shrink-0 px-5 pt-3 pb-4 sm:px-8">
              {composer}
            </div>
          </>
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}
