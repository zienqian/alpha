import { useTranslation } from "@/i18n/react";
import { lazy, Suspense, useEffect, useState, type ComponentProps, type CSSProperties } from "react";
import { PromptInput } from "@/components/ai-elements/prompt-input";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { sessionErrorMessage } from "@/features/sessions/api";
import { ContinueSessions } from "@/features/sessions/continue-sessions";
import { SessionContext } from "@/features/sessions/session-context";
import { SessionSidebar } from "@/features/sessions/session-sidebar";
import { SessionApproval } from "@/features/sessions/session-approval";
import { useSessionWorkspace } from "@/features/sessions/use-session-workspace";
import { ServerUpdate } from "@/features/sessions/server-update";
import { presentNotice } from "@/i18n/presentation";
import { cn } from "@/lib/utils";

const SessionContent = lazy(() => import("@/features/sessions/session-content").then((module) => ({ default: module.SessionContent })));
const SkillsMarket = lazy(() => import("@/features/skills/skills-market").then(module => ({ default: module.SkillsMarket })));

function HistoryColumn({ className, ...props }: ComponentProps<"div">) {
  // Reserve the same native scrollbar gutter as the message viewport.
  return <div className="shrink-0 overflow-y-hidden scrollbar-gutter-stable">
    <div className={cn("mx-auto w-full max-w-[744px] px-5 sm:px-8", className)} {...props} />
  </div>;
}

function HistoryLoading() {
  const { t } = useTranslation();
  return <HistoryColumn role="status" aria-label={t("sessions:loadingHistory")} className="space-y-4 py-6">
    <Skeleton className="ml-auto h-14 w-2/3 rounded-xl" />
    <Skeleton className="mt-10 h-4 w-24" />
    <Skeleton className="h-4 w-full" />
    <Skeleton className="h-4 w-4/5" />
  </HistoryColumn>;
}

export function App() {
  const { t } = useTranslation();
  const workspace = useSessionWorkspace();
  const [skillsOpen, setSkillsOpen] = useState(() => new URL(window.location.href).searchParams.get("view") === "skills");
  useEffect(() => {
    const update = () => setSkillsOpen(new URL(window.location.href).searchParams.get("view") === "skills");
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  function showSkills(open: boolean) {
    const url = new URL(window.location.href);
    if (open) url.searchParams.set("view", "skills");
    else url.searchParams.delete("view");
    if (url.href !== window.location.href) window.history.pushState(window.history.state, "", url);
    setSkillsOpen(open);
  }
  const { folders, selectedFolder, selectedSession, selectedSessionId, draft } = workspace;
  const isWelcome = workspace.isWelcome;
  const view = workspace.history.data;
  const connectionLabel = workspace.connected ? t("sessions:connected") : workspace.history.connection === "error" ? t("sessions:connectionFailed") : workspace.history.connection === "reconnecting" ? t("sessions:reconnecting") : t("sessions:connecting");
  const composer = <>
    {workspace.actionError && <div role="alert" className="mb-3 space-y-2 text-xs text-destructive">
      <p>{workspace.actionError}</p>
      {workspace.actions.pending?.status === "uncertain" && <Button size="sm" variant="outline" disabled={!workspace.connected} onClick={workspace.actions.retry}>{t("sessions:retrySend")}</Button>}
    </div>}
    {view?.state.approval && <SessionApproval approval={view.state.approval}
      disabled={!workspace.connected || workspace.actions.controlling || !view.approvalId} onAnswer={workspace.actions.approve} />}
    <PromptInput draft={draft} onChange={workspace.updateDraft} focusRequest={workspace.focusRequest}
      permissionMode={workspace.permissionMode} onPermissionChange={workspace.changePermission}
      canChangePermission={workspace.canChangePermission} permissionSaving={workspace.actions.permissionSaving || Boolean(view?.state.settingsSaving)}
      onSend={() => void workspace.send()} canSend={workspace.canSend} busy={workspace.busy} submitting={workspace.submitting}
      onCancel={workspace.actions.cancel} canCancel={workspace.connected && !workspace.actions.controlling && Boolean(view?.requestId) && view?.state.phase !== "stopping"}
      status={isWelcome ? selectedFolder?.name ?? t("workspace:registerProject") : !workspace.connected ? connectionLabel : workspace.busy ? view?.state.phase === "stopping" ? t("sessions:stopping") : "" : view?.state.canSend ? "" : t("sessions:unavailable")} />
  </>;

  return (
    <SidebarProvider className="h-dvh min-h-0 overflow-hidden" style={{ "--sidebar-width": "15rem" } as CSSProperties}>
      <a href="#session-content" className="sr-only z-50 rounded-md bg-background p-3 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        {t("sessions:skip")}</a>
      <SessionSidebar folders={folders} selectedSessionId={selectedSessionId} onSelectSession={id => { showSkills(false); workspace.selectSession(id); }} onNewSession={id => { showSkills(false); workspace.newSession(id); }}
        onOpenSkills={() => showSkills(true)} skillsActive={skillsOpen}
        loading={workspace.index.isPending} error={workspace.index.error} refreshing={workspace.index.isFetching} onRefresh={() => void workspace.index.refetch()} />
      <SidebarInset className="workspace-canvas min-h-0 min-w-0 overflow-hidden">
        <ServerUpdate submitting={!workspace.canRefresh} onRefresh={() => {
          if (!workspace.preserveDrafts()) return false;
          window.location.reload();
          return true;
        }} />
        {skillsOpen ? <Suspense fallback={<HistoryLoading />}><SkillsMarket initialProjectId={selectedFolder?.id} onBack={() => showSkills(false)} /></Suspense> : <>
        <header className="flex h-11 shrink-0 items-center gap-2 px-3 sm:px-4">
          <SidebarTrigger aria-label={t("workspace:toggleSidebar")} title={t("workspace:toggleSidebarHint")} className="text-muted-foreground" />
          <div className="flex min-w-0 flex-1 items-center gap-2 text-[13px]">
            {isWelcome ? <span className="truncate text-muted-foreground">{t("sessions:new")}</span> : (
              <h1 id="session-title" className="min-w-0 flex-1 truncate font-medium" title={selectedSession?.title}>{selectedSession?.title || t("sessions:new")}</h1>
            )}
          </div>
          <SessionContext folder={selectedFolder} session={selectedSession} draft={draft} />
        </header>
        {isWelcome ? (
          <section id="session-content" tabIndex={-1} aria-labelledby="welcome-title" className="welcome-stage min-h-0 flex-1 overflow-y-auto px-5 outline-none sm:px-8">
            <div className="task-entry mx-auto w-full max-w-[680px]">
              <div className="mb-6">
                <h1 id="welcome-title" className="text-[22px] leading-8 font-medium tracking-tight text-balance">{t("workspace:welcome")}</h1>
              </div>
              {composer}
              <ContinueSessions folder={selectedFolder} onSelect={workspace.selectSession} />
            </div>
          </section>
        ) : (
          <>
            <div id="session-content" key={selectedSessionId} tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
              {workspace.history.isError && <HistoryColumn role="alert" className="space-y-2 py-4 text-xs leading-5">
                <p>{sessionErrorMessage(t, workspace.history.error, "history")}</p>
                {workspace.history.data && <p className="text-xs text-muted-foreground">{t("sessions:cachedHistory")}</p>}
                <Button variant="outline" size="sm" disabled={workspace.history.isFetching} onClick={() => void workspace.history.refetch()}>{t("sessions:retryHistory")}</Button>
              </HistoryColumn>}
              {workspace.history.data?.state.error && <HistoryColumn role="status" className="py-2 text-xs leading-5 text-destructive">{presentNotice(t, workspace.history.data.state.notice, workspace.history.data.state.error)}</HistoryColumn>}
              {!workspace.connected && workspace.history.data && <HistoryColumn role="status" className="py-2 text-xs leading-5 text-muted-foreground">{workspace.history.connection === "error" ? t("errors:subscribe") : t("sessions:connectingPreserved")}</HistoryColumn>}
              {workspace.history.isPending ? <HistoryLoading /> : selectedSession?.historyLoaded && (
                <Suspense fallback={<HistoryLoading />}><SessionContent session={selectedSession} busy={workspace.busy} phase={view?.state.phase} connected={workspace.connected} /></Suspense>
              )}
            </div>
            <HistoryColumn className="pt-3 pb-4">{composer}</HistoryColumn>
          </>
        )}
        </>}
      </SidebarInset>
    </SidebarProvider>
  );
}
