import { lazy, Suspense, type CSSProperties } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useMatch, useNavigate, useOutletContext } from "react-router";
import { X } from "lucide-react";
import { useTranslation } from "@/i18n/react";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DesktopTitlebar } from "@/components/desktop-titlebar";
import { SessionContext } from "@/features/sessions/session-context";
import { SessionSidebar } from "@/features/sessions/session-sidebar";
import { SessionPage } from "@/features/sessions/session-page";
import { CreateProjectDialog } from "@/features/sessions/create-project-dialog";
import { useSessionWorkspace, type SessionWorkspace } from "@/features/sessions/use-session-workspace";
import { SessionWorkspaceProvider } from "@/features/sessions/workspace-state";
import { useExperimentalFeatures } from "@/features/settings/experimental-features";

const SkillsMarket = lazy(() => import("@/features/skills/skills-market").then(module => ({ default: module.SkillsMarket })));
const SettingsPage = lazy(() => import("@/features/settings/settings-page").then(module => ({ default: module.SettingsPage })));

function SkillsPage() {
  const workspace = useOutletContext<SessionWorkspace>();
  return <SkillsMarket initialProjectId={workspace.selectedFolder?.id} showHeader={false} />;
}

function WorkspaceLayout() {
  const { t } = useTranslation();
  const workspace = useSessionWorkspace();
  const location = useLocation();
  const experiments = useExperimentalFeatures();
  const navigate = useNavigate();
  const settingsOpen = Boolean(useMatch("/settings"));
  const skillsOpen = Boolean(useMatch("/skills"));
  const sessionOpen = !settingsOpen && !skillsOpen;
  const canvasOpen = sessionOpen && experiments.sessionCanvas;
  const contentId = settingsOpen ? "settings-content" : skillsOpen ? "skills-content" : "session-content";
  const { folders, selectedFolder, selectedSession, selectedSessionId, draft } = workspace;
  const openPage = (pathname: "/settings" | "/skills") => {
    if (location.pathname !== pathname) void navigate(pathname, { state: { sessionId: selectedSessionId, sessionLocal: workspace.isLocal } });
  };
  const returnToSession = () => workspace.selectSession(selectedSessionId);

  return <SidebarProvider mobileMode="inline" className="workspace-shell h-[calc(100dvh-var(--window-header-height))] min-h-0 overflow-hidden"
    style={{ "--sidebar-width": "var(--workspace-sidebar-width, 16.5rem)", "--sidebar-width-icon": "3.5rem" } as CSSProperties}>
    <a href={`#${contentId}`} onClick={event => { event.preventDefault(); document.getElementById(contentId)?.focus(); }}
      className="sr-only z-50 rounded-md bg-background p-3 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
      {sessionOpen ? t("sessions:skip") : t("common:skipContent")}</a>
    <SessionSidebar folders={folders} selectedSessionId={selectedSessionId} onSelectSession={id => workspace.selectSession(id)} onNewSession={id => workspace.newSession(id)}
      selectedFolderId={selectedFolder?.id} onCreateProject={() => workspace.setProjectDialogOpen(true)} onDeleteProject={workspace.removeProject}
      onRenameSession={workspace.renameSession} onDeleteSession={workspace.deleteSession} creatingIds={workspace.creatingIds}
      onOpenSkills={() => openPage("/skills")} skillsActive={skillsOpen}
      onOpenSettings={() => openPage("/settings")} settingsActive={settingsOpen}
      onAddToCanvas={experiments.sessionCanvas ? id => { experiments.setAddition({ sessionId: id }); workspace.selectSession(selectedSessionId); } : undefined}
      loading={workspace.index.isPending && workspace.projects.isPending} error={workspace.index.error ?? workspace.projects.error} refreshing={workspace.index.isFetching || workspace.projects.isFetching}
      onRefresh={() => { void workspace.index.refetch(); void workspace.projects.refetch(); }} />
    <CreateProjectDialog open={workspace.projectDialogOpen} onOpenChange={workspace.setProjectDialogOpen} onCreate={workspace.addProject} />
    <SidebarInset className="workspace-canvas min-h-0 min-w-0 overflow-hidden" data-docking={canvasOpen || undefined}>
      {!canvasOpen && <header className="workspace-toolbar flex h-11 shrink-0 items-center gap-2 px-3 sm:px-4">
        <SidebarTrigger mobileOnly aria-label={t("workspace:toggleSidebar")} title={t("workspace:toggleSidebarHint")} className="text-muted-foreground" />
        <div className="flex min-w-0 flex-1 items-center gap-2 text-[13px]">
          {!sessionOpen ? <span className="truncate font-medium">{settingsOpen ? t("settings:title") : t("skills:market.title")}</span> : workspace.isWelcome ?
            <span className="truncate text-muted-foreground">{t("sessions:new")}</span> :
            <h1 id="session-title" className="min-w-0 flex-1 truncate font-medium" title={selectedSession?.title}>{selectedSession?.title || t("sessions:new")}</h1>}
        </div>
        {sessionOpen ? <SessionContext folder={selectedFolder} session={selectedSession} draft={draft} /> : settingsOpen ?
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={t("settings:backToSession")} title={t("settings:backToSession")} onClick={returnToSession}><X aria-hidden="true" /></Button> : null}
      </header>}
      <Suspense fallback={<div role="status" aria-label={t("common:loading")} className="space-y-3 p-6"><Skeleton className="h-5 w-24" /><Skeleton className="h-4 max-w-sm" /></div>}>
        <Outlet context={workspace} />
      </Suspense>
    </SidebarInset>
  </SidebarProvider>;
}

export function App() {
  return <BrowserRouter useTransitions={false}>
    <DesktopTitlebar />
    <Routes>
      <Route element={<SessionWorkspaceProvider><WorkspaceLayout /></SessionWorkspaceProvider>}>
        <Route index element={<SessionPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="skills" element={<SkillsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  </BrowserRouter>;
}
