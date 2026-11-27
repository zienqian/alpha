import { lazy, Suspense, type ComponentProps } from "react";
import { useTranslation } from "@/i18n/react";
import { PromptInput } from "@/components/ai-elements/prompt-input";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { sessionErrorMessage } from "./api";
import { SessionApproval } from "./session-approval";
import { SessionQueue } from "./session-queue";
import type { SessionWorkspace } from "./use-session-workspace";
import { presentNotice } from "@/i18n/presentation";
import { cn } from "@/lib/utils";
import { ProjectPicker } from "./project-picker";
const SessionContent = lazy(() => import("./session-content").then(module => ({ default: module.SessionContent })));

function HistoryColumn({ className, ...props }: ComponentProps<"div">) {
  // Reserve the same native scrollbar gutter as the message viewport.
  return <div className="shrink-0 overflow-y-hidden scrollbar-gutter-stable">
    <div className={cn("mx-auto w-full max-w-[744px] px-3 sm:px-8", className)} {...props} />
  </div>;
}

export function HistoryLoading() {
  const { t } = useTranslation();
  return <HistoryColumn role="status" aria-label={t("sessions:loadingHistory")} className="space-y-4 py-8">
    <Skeleton className="ms-auto h-12 w-2/3 rounded-2xl" />
    <Skeleton className="mt-8 h-4 w-24 rounded-md" />
    <Skeleton className="h-4 w-full rounded-md" />
    <Skeleton className="h-4 w-4/5 rounded-md" />
  </HistoryColumn>;
}

export function SessionPane({ workspace, contentId = "session-content" }: { workspace: SessionWorkspace; contentId?: string }) {
  const { t } = useTranslation();
  const { selectedFolder, selectedSession, selectedSessionId, draft } = workspace;
  const isWelcome = workspace.isWelcome;
  const view = workspace.history.data;
  const connectionLabel = workspace.connected ? t("sessions:connected") : workspace.history.connection === "error" ? t("sessions:connectionFailed") : workspace.history.connection === "reconnecting" ? t("sessions:reconnecting") : t("sessions:connecting");
  const composer = <>
    {workspace.actionError && <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-status-danger-border bg-status-danger-bg px-3.5 py-2.5 text-xs leading-[1.5] text-status-danger">
      <p className="min-w-0 flex-1">{workspace.actionError}</p>
      {workspace.actions.pending?.status === "uncertain" && <Button size="sm" variant="outline" disabled={!workspace.connected} onClick={workspace.actions.retry}>{t("sessions:retrySend")}</Button>}
    </div>}
    {view?.state.approval && <SessionApproval approval={view.state.approval}
      disabled={!workspace.connected || workspace.actions.controlling || !view.approvalId} onAnswer={workspace.actions.approve} />}
    <SessionQueue key={selectedSessionId} requests={view?.state.queuedRequests} disabled={!workspace.connected || workspace.actions.controlling}
      canSteer={Boolean(view?.state.canSteer)} onRemove={workspace.actions.cancelQueued} onEdit={workspace.actions.editQueued}
      onMove={workspace.actions.moveQueued} onSteer={workspace.actions.steerQueued} />
    <PromptInput key={`composer-${selectedSessionId}`} draft={draft} onChange={workspace.updateDraft} focusRequest={workspace.focusRequest}
      folder={isWelcome ? selectedFolder : undefined}
      projectPicker={isWelcome && (selectedFolder || (!workspace.projects.isPending && !workspace.index.isPending)) ? <ProjectPicker folders={workspace.folders.filter(folder => folder.path)} selectedId={selectedFolder?.path ? selectedFolder.id : undefined} onSelect={workspace.selectProject}
        onCreate={() => workspace.setProjectDialogOpen(true)} disabled={Boolean(workspace.submitting)} /> : undefined}
      showContextUsage={Boolean(view?.state.messages.length)}
      contextUsage={view?.state.contextUsage ?? (selectedSession?.local ? selectedFolder?.defaultContext : undefined)}
      permissionMode={workspace.permissionMode} onPermissionChange={workspace.changePermission}
      canChangePermission={workspace.canChangePermission} permissionSaving={workspace.actions.permissionSaving || Boolean(view?.state.settingsSaving)}
      onSend={() => void workspace.send()} canSend={workspace.canSend} busy={workspace.busy} submitting={workspace.submitting}
      onCancel={workspace.actions.cancel} canCancel={workspace.connected && !workspace.actions.controlling && Boolean(view?.requestId) && view?.state.phase !== "stopping"}
      status={isWelcome ? "" : !workspace.connected ? connectionLabel : workspace.busy ? view?.state.phase === "stopping" ? t("sessions:stopping") : "" : view?.state.canSend ? "" : t("sessions:unavailable")} />
  </>;

  return <>
  {isWelcome ? (
    <section id={contentId} tabIndex={-1} aria-labelledby={`${contentId}-welcome`} className="welcome-stage min-h-0 flex-1 overflow-y-auto px-5 outline-none sm:px-8">
      <div className="task-entry mx-auto w-full max-w-[680px]">
        <div className="stage-enter mb-6 flex flex-col items-start gap-3.5">
          <span className="flex size-10 items-center justify-center rounded-xl bg-muted ring-1 ring-foreground/6" aria-hidden="true">
            <img src="/icons/alphacode-64.png" srcSet="/icons/alphacode-32.png 1x, /icons/alphacode-64.png 2x, /icons/alphacode-128.png 4x" width={26} height={26} className="size-6.5 shrink-0" alt="" aria-hidden="true" draggable={false} />
          </span>
          <h1 id={`${contentId}-welcome`} className="text-[1.625rem] leading-[1.2] font-semibold tracking-[-0.025em] text-balance text-foreground">{t("workspace:welcome")}</h1>
        </div>
        <div className="stage-enter stage-delay-1">
          {composer}
        </div>
      </div>
    </section>
  ) : (
    <>
      <div id={contentId} key={selectedSessionId} tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
        {workspace.history.isError && <HistoryColumn role="alert" className="pt-4">
          <div className="space-y-2.5 rounded-xl border border-status-danger-border bg-status-danger-bg px-4 py-3 text-xs leading-[1.5]">
            <p className="text-status-danger">{sessionErrorMessage(t, workspace.history.error, "history")}</p>
            <Button variant="outline" size="sm" disabled={workspace.history.isFetching} onClick={() => void workspace.history.refetch()}>{t("sessions:retryHistory")}</Button>
          </div>
        </HistoryColumn>}
        {workspace.history.data?.state.error && <HistoryColumn role="status" className="py-2 text-xs leading-[1.5] text-status-danger">{presentNotice(t, workspace.history.data.state.notice, workspace.history.data.state.error)}</HistoryColumn>}
        {workspace.history.isPending ? <HistoryLoading /> : selectedSession?.historyLoaded && (
          <Suspense fallback={<HistoryLoading />}><SessionContent session={selectedSession} busy={workspace.busy} phase={view?.state.phase} connected={workspace.connected} modelActivity={view?.state.modelActivity} /></Suspense>
        )}
      </div>
      <HistoryColumn className="pt-2.5 pb-5">{composer}</HistoryColumn>
    </>
  )}
  </>;
}
