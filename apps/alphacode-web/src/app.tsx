import { lazy, Suspense, useEffect, type CSSProperties } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useMatch, useNavigate, useOutletContext } from "react-router";
import { X } from "lucide-react";
import { useTranslation } from "@/i18n/react";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DesktopTitlebar } from "@/components/desktop-titlebar";
import { HistoryNavigation } from "@/components/history-navigation";
import { SessionSidebar } from "@/features/sessions/session-sidebar";
import { SessionPage } from "@/features/sessions/session-page";
import { CreateProjectDialog } from "@/features/sessions/create-project-dialog";
import { useSessionWorkspace, type SessionWorkspace } from "@/features/sessions/use-session-workspace";
import { SessionWorkspaceProvider } from "@/features/sessions/workspace-state";
import { useSessionNotifications } from "@/features/sessions/use-session-notifications";
import { useBotsIndex } from "@/features/bots/use-bots";
import type { BotSummaryView } from "@/features/bots/api";
import { useExperimentalFeatures } from "@/features/settings/experimental-features";

const emptyBots: readonly BotSummaryView[] = [];

const SkillsMarket = lazy(() => import("@/features/skills/skills-market").then(module => ({ default: module.SkillsMarket })));
const SettingsPage = lazy(() => import("@/features/settings/settings-page").then(module => ({ default: module.SettingsPage })));
const BotChatPage = lazy(() => import("@/features/bots/bot-chat-page").then(module => ({ default: module.BotChatPage })));
const BotSettingsPage = lazy(() => import("@/features/bots/bot-settings-page").then(module => ({ default: module.BotSettingsPage })));

function SkillsPage() {
  const workspace = useOutletContext<SessionWorkspace>();
  return <SkillsMarket initialProjectId={workspace.selectedFolder?.id} showHeader={false} />;
}

function WorkspaceLayout() {
  const { t } = useTranslation();
  const workspace = useSessionWorkspace();
  useSessionNotifications();
  const botsIndex = useBotsIndex({ includeArchived: true });
  const location = useLocation();
  const experiments = useExperimentalFeatures();
  const navigate = useNavigate();
  const settingsOpen = Boolean(useMatch("/settings"));
  const skillsOpen = Boolean(useMatch("/skills"));
  const botNewOpen = Boolean(useMatch("/bots/new"));
  const botSettingsMatch = useMatch("/bots/:botId/settings");
  const botChatMatch = useMatch("/bots/:botId");
  const activeBotId = botNewOpen ? undefined : (botSettingsMatch?.params.botId ?? botChatMatch?.params.botId);
  const botSettingsOpen = Boolean(botSettingsMatch);
  const botChatOpen = Boolean(botChatMatch && !botNewOpen);
  const botOpen = botNewOpen || botSettingsOpen || botChatOpen;
  const sessionOpen = !settingsOpen && !skillsOpen && !botOpen;
  const canvasOpen = sessionOpen;
  const contentId = settingsOpen
    ? "settings-content"
    : skillsOpen
      ? "skills-content"
      : botNewOpen || botSettingsOpen
        ? "bot-settings-content"
        : botChatOpen
          ? "bot-content"
          : "session-content";
  const { folders, selectedFolder, selectedSession, selectedSessionId } = workspace;
  const bots = botsIndex.data?.bots ?? emptyBots;
  const activeBot = activeBotId ? bots.find(item => item.id === activeBotId) : undefined;

  // Keep document.title synchronized with client-side route & session transitions (better-accessibility).
  useEffect(() => {
    const viewTitle = settingsOpen
      ? t("settings:title")
      : skillsOpen
        ? t("skills:market.title")
        : botNewOpen
          ? t("bots:createTitle")
          : botSettingsOpen
            ? (activeBot ? `${activeBot.name} · ${t("bots:settingsTitle")}` : t("bots:settingsTitle"))
            : botChatOpen
              ? (activeBot?.name || t("bots:sectionTitle"))
              : workspace.isWelcome
                ? t("workspace:title")
                : selectedSession?.title?.trim() || t("sessions:new");
    document.title = `${viewTitle} · AlphaCode`;
  }, [settingsOpen, skillsOpen, botNewOpen, botSettingsOpen, botChatOpen, activeBot, workspace.isWelcome, selectedSession?.title, t]);

  const openPage = (pathname: "/settings" | "/skills") => {
    if (location.pathname !== pathname) void navigate(pathname, { state: { sessionId: selectedSessionId, sessionLocal: workspace.isLocal } });
  };
  const openBotRoute = (pathname: string) => {
    if (location.pathname !== pathname) void navigate(pathname, { state: { sessionId: selectedSessionId, sessionLocal: workspace.isLocal } });
  };
  const returnToSession = () => workspace.selectSession(selectedSessionId);

  return <SidebarProvider mobileMode="inline" className="workspace-shell h-dvh min-h-0 overflow-hidden"
    style={{ "--sidebar-width": "var(--workspace-sidebar-width, 16.5rem)", "--sidebar-width-icon": "3.5rem" } as CSSProperties}>
    <a href={`#${contentId}`} onClick={event => { event.preventDefault(); document.getElementById(contentId)?.focus(); }}
      className="sr-only z-50 rounded-lg bg-background px-3 py-2 text-xs font-medium shadow-(--shadow-overlay) focus:not-sr-only focus:fixed focus:top-2 focus:start-2">
      {sessionOpen ? t("sessions:skip") : botChatOpen ? t("bots:chat.skip") : t("common:skipContent")}</a>
    <SessionSidebar
      bots={bots}
      selectedBotId={activeBotId}
      botActive={botOpen}
      onSelectBot={id => openBotRoute(`/bots/${encodeURIComponent(id)}`)}
      onCreateBot={() => openBotRoute("/bots/new")}
      onOpenBotSettings={id => openBotRoute(`/bots/${encodeURIComponent(id)}/settings`)}
      folders={folders} selectedSessionId={selectedSessionId} onSelectSession={id => workspace.selectSession(id)} onNewSession={id => workspace.newSession(id)}
      selectedFolderId={selectedFolder?.id} onCreateProject={() => workspace.setProjectDialogOpen(true)} onDeleteProject={workspace.removeProject}
      onRenameSession={workspace.renameSession} onDeleteSession={workspace.deleteSession} creatingIds={workspace.creatingIds}
      onOpenSkills={() => openPage("/skills")} skillsActive={skillsOpen}
      onOpenSettings={() => openPage("/settings")} settingsActive={settingsOpen}
      onAddToCanvas={id => { experiments.setAddition({ sessionId: id }); workspace.selectSession(selectedSessionId); }}
      loading={workspace.index.isPending && workspace.projects.isPending} error={workspace.index.error ?? workspace.projects.error} refreshing={workspace.index.isFetching || workspace.projects.isFetching}
      onRefresh={() => { void workspace.index.refetch(); void workspace.projects.refetch(); }} />
    <CreateProjectDialog open={workspace.projectDialogOpen} onOpenChange={workspace.setProjectDialogOpen} onCreate={workspace.addProject} />
    <SidebarInset className="workspace-canvas min-h-0 min-w-0 overflow-hidden" data-docking={canvasOpen || undefined}>
      <header className="workspace-toolbar flex h-11 shrink-0 items-center gap-2 overflow-hidden px-3.5 sm:px-4">
        <SidebarTrigger mobileOnly aria-label={t("workspace:toggleSidebar")} title={t("workspace:toggleSidebarHint")} className="text-(--sidebar-muted) hover:bg-(--sidebar-hover) hover:text-sidebar-accent-foreground" />
        <HistoryNavigation />
        {(settingsOpen || skillsOpen || botNewOpen || botSettingsOpen) ? <>
          <span aria-hidden="true" className="select-none text-xs text-(--sidebar-muted)/50">/</span>
          <div className="flex min-w-0 flex-1 items-center gap-2 text-[0.8125rem] leading-[1.4]">
            <span className="truncate font-medium tracking-[-0.008em] text-foreground">
              {settingsOpen
                ? t("settings:title")
                : skillsOpen
                  ? t("skills:market.title")
                  : botNewOpen
                    ? t("bots:createTitle")
                    : t("bots:settingsTitle")}
            </span>
          </div>
          <Button variant="ghost" size="icon-sm" className="shrink-0 text-(--sidebar-muted) hover:bg-(--sidebar-hover) hover:text-sidebar-accent-foreground"
            aria-label={t(settingsOpen ? "settings:backToSession" : skillsOpen ? "skills:market.back" : botSettingsOpen ? "bots:backToBot" : "settings:backToSession")}
            title={t(settingsOpen ? "settings:backToSession" : skillsOpen ? "skills:market.back" : botSettingsOpen ? "bots:backToBot" : "settings:backToSession")}
            onClick={() => {
              if (botSettingsOpen && activeBotId) void navigate(`/bots/${encodeURIComponent(activeBotId)}`);
              else returnToSession();
            }}><X aria-hidden="true" /></Button>
        </> : sessionOpen && !workspace.isWelcome ? (
          <div className="sr-only">
            <h1 id="session-title">{selectedSession?.title || t("sessions:new")}</h1>
          </div>
        ) : null}
      </header>
      <div className="workspace-surface flex min-h-0 flex-1 flex-col overflow-hidden" data-docking={canvasOpen || undefined}>
        <Suspense fallback={<div role="status" aria-label={t("common:loading")} className="space-y-3 p-6"><Skeleton className="h-5 w-24 rounded-md" /><Skeleton className="h-4 max-w-sm rounded-md" /></div>}>
          <Outlet context={workspace} />
        </Suspense>
      </div>
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
        <Route path="bots/new" element={<BotSettingsPage mode="create" />} />
        <Route path="bots/:botId" element={<BotChatPage />} />
        <Route path="bots/:botId/settings" element={<BotSettingsPage mode="edit" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  </BrowserRouter>;
}
