import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  GitMerge,
  LoaderCircle,
  RefreshCw,
  Send,
  Square,
  Trash2,
  Wrench,
} from "lucide-react";
import { useTranslation } from "@/i18n/react";
import { ChatMessage } from "@/components/ai-elements/message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { buildSessionHistory } from "@/features/sessions/domain/history";
import { ToolActivity } from "@/features/sessions/tool-message";
import type { SessionMessage } from "@/features/sessions/types";
import { cn } from "@/lib/utils";
import {
  applyBotTask,
  botErrorMessage,
  cancelBotTask,
  discardBotTask,
  getBotTaskDiff,
  getBotTaskSession,
  steerBotTask,
  type BotSummaryView,
  type BotTaskApplyResult,
  type BotTaskRecord,
} from "./api";
import { BotAvatar } from "./bot-avatar";

function isActiveTaskStatus(status: BotTaskRecord["status"]): boolean {
  return status === "running" || status === "awaiting_approval" || status === "queued";
}

export function WorkerInspectorDrawer({
  bot,
  tasks,
  open,
  selectedTaskId,
  onSelectTask,
  onOpenChange,
  onMutated,
}: {
  bot: BotSummaryView;
  tasks: readonly BotTaskRecord[];
  open: boolean;
  selectedTaskId?: string;
  onSelectTask: (taskId: string) => void;
  onOpenChange: (open: boolean) => void;
  onMutated: () => void;
}) {
  const { t } = useTranslation();
  const [steerInput, setSteerInput] = useState("");
  const [busyAction, setBusyAction] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [applyOutcome, setApplyOutcome] = useState<BotTaskApplyResult>();

  const selectedTask = useMemo(
    () => tasks.find(task => task.id === selectedTaskId) ?? tasks[0],
    [tasks, selectedTaskId],
  );

  useEffect(() => {
    setActionError(undefined);
    setApplyOutcome(undefined);
    setSteerInput("");
  }, [selectedTask?.id, open]);

  const active = Boolean(selectedTask && isActiveTaskStatus(selectedTask.status));
  const hasWorktree = Boolean(selectedTask && selectedTask.isolationMode === "git_worktree" && selectedTask.worktreeState !== "none");

  const diffQuery = useQuery({
    queryKey: ["bots", "task-diff", bot.id, selectedTask?.id],
    enabled: Boolean(open && selectedTask && hasWorktree),
    queryFn: ({ signal }) => getBotTaskDiff(bot.id, selectedTask?.id ?? "", signal),
    refetchInterval: active && open ? 4_000 : false,
  });

  const sessionQuery = useQuery({
    queryKey: ["bots", "task-session", bot.id, selectedTask?.id],
    enabled: Boolean(open && selectedTask),
    queryFn: ({ signal }) => getBotTaskSession(bot.id, selectedTask?.id ?? "", signal),
    refetchInterval: active && open ? 2_500 : false,
  });

  const traceItems = useMemo(() => {
    const raw = sessionQuery.data?.messages ?? [];
    const mapped: SessionMessage[] = raw.map(({ text, ...rest }) => ({ ...rest, content: text }));
    return buildSessionHistory(mapped, active, active ? "running" : "idle", true).items;
  }, [sessionQuery.data?.messages, active]);

  async function handleSteer() {
    if (!selectedTask || !steerInput.trim()) return;
    setBusyAction("steer");
    setActionError(undefined);
    try {
      await steerBotTask(bot.id, selectedTask.id, steerInput.trim());
      setSteerInput("");
      void sessionQuery.refetch();
      onMutated();
    } catch (cause) {
      setActionError(botErrorMessage(t, cause));
    } finally {
      setBusyAction(undefined);
    }
  }

  async function handleCancel() {
    if (!selectedTask) return;
    setBusyAction("cancel");
    setActionError(undefined);
    try {
      await cancelBotTask(bot.id, selectedTask.id, false);
      void diffQuery.refetch();
      void sessionQuery.refetch();
      onMutated();
    } catch (cause) {
      setActionError(botErrorMessage(t, cause));
    } finally {
      setBusyAction(undefined);
    }
  }

  async function handleApply(strategy: "merge" | "apply_patch") {
    if (!selectedTask) return;
    setBusyAction(strategy);
    setActionError(undefined);
    setApplyOutcome(undefined);
    try {
      const result = await applyBotTask(bot.id, selectedTask.id, { strategy, cleanup: true });
      setApplyOutcome(result);
      void diffQuery.refetch();
      onMutated();
    } catch (cause) {
      setActionError(botErrorMessage(t, cause));
    } finally {
      setBusyAction(undefined);
    }
  }

  async function handleDiscard() {
    if (!selectedTask) return;
    setBusyAction("discard");
    setActionError(undefined);
    setApplyOutcome(undefined);
    try {
      await discardBotTask(bot.id, selectedTask.id);
      void diffQuery.refetch();
      onMutated();
    } catch (cause) {
      setActionError(botErrorMessage(t, cause));
    } finally {
      setBusyAction(undefined);
    }
  }

  const canApplyWorktree = Boolean(
    selectedTask &&
    hasWorktree &&
    !active &&
    (selectedTask.worktreeState === "ready_for_review" || selectedTask.worktreeState === "active") &&
    diffQuery.data?.hasChanges,
  );
  const canDiscardWorktree = Boolean(
    selectedTask &&
    hasWorktree &&
    !active &&
    (selectedTask.worktreeState === "ready_for_review" || selectedTask.worktreeState === "active"),
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="border-b border-border/80 px-5 py-4 pe-12">
          <div className="flex items-center gap-2.5">
            <BotAvatar appearance={bot.appearance} status={bot.status} size="sm" />
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-[0.9375rem] leading-[1.3]">{t("bots:inspector.title")}</SheetTitle>
              <SheetDescription className="mt-0.5 text-xs">{t("bots:inspector.description")}</SheetDescription>
            </div>
          </div>
        </SheetHeader>

        {tasks.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <Empty className="max-w-sm">
              <EmptyHeader>
                <EmptyMedia variant="icon" className="size-10 rounded-xl">
                  <Wrench aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>{t("bots:inspector.title")}</EmptyTitle>
                <EmptyDescription>{t("bots:inspector.empty")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Task selector strip */}
            <div aria-label={t("bots:inspector.taskList")} className="shrink-0 border-b border-border/70 bg-muted/25 px-4 py-2.5">
              <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                {tasks.map(task => {
                  const selected = task.id === selectedTask?.id;
                  return (
                    <button
                      key={task.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onSelectTask(task.id)}
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors",
                        selected
                          ? "border-foreground/30 bg-background font-medium text-foreground shadow-2xs dark:bg-card"
                          : "border-transparent bg-transparent text-muted-foreground hover:border-border hover:bg-background/60 hover:text-foreground",
                      )}
                    >
                      {task.status === "running" && (
                        <LoaderCircle aria-hidden="true" className="size-3 shrink-0 animate-spin text-blue-500 motion-reduce:animate-none" />
                      )}
                      <span className="font-mono text-[0.6875rem]">#{task.shortId}</span>
                      <span className="max-w-36 truncate">{task.title}</span>
                      <Badge variant="secondary" className="h-4.5 px-1.5 text-[0.625rem]">
                        {t(`bots:inspector.taskStatus.${task.status}`)}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedTask && (
              <ScrollArea className="min-h-0 flex-1" viewportClassName="[&>div]:block!">
                <div className="space-y-5 p-5">
                  {/* Task Metadata */}
                  <section className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <h2 className="text-sm font-semibold text-foreground">{selectedTask.title}</h2>
                          <Badge variant="outline" className="font-mono text-[0.6875rem]">#{selectedTask.shortId}</Badge>
                          <Badge variant="secondary" className="text-[0.6875rem]">
                            {t(`bots:inspector.taskStatus.${selectedTask.status}`)}
                          </Badge>
                          <Badge variant="outline" className="text-[0.6875rem]">
                            {t(`bots:inspector.isolation.${selectedTask.isolationMode}`)}
                          </Badge>
                        </div>
                        <p className="mt-1.5 text-xs leading-[1.55] text-muted-foreground">{selectedTask.goal}</p>
                      </div>
                    </div>

                    <dl className="grid grid-cols-1 gap-2 rounded-xl border border-border/80 bg-muted/20 p-3 text-xs sm:grid-cols-2">
                      <div>
                        <dt className="text-[0.6875rem] text-muted-foreground">{t("bots:inspector.model")}</dt>
                        <dd className="mt-0.5 truncate font-mono text-foreground">{selectedTask.workerModelId}</dd>
                      </div>
                      {selectedTask.worktreeBranch && (
                        <div>
                          <dt className="text-[0.6875rem] text-muted-foreground">{t("bots:inspector.branch")}</dt>
                          <dd className="mt-0.5 inline-flex items-center gap-1 truncate font-mono text-foreground">
                            <GitBranch aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
                            <span className="truncate">{selectedTask.worktreeBranch}</span>
                          </dd>
                        </div>
                      )}
                      <div className="sm:col-span-2">
                        <dt className="text-[0.6875rem] text-muted-foreground">{t("bots:inspector.workspace")}</dt>
                        <dd className="mt-0.5 truncate font-mono text-[0.6875rem] text-foreground">
                          {selectedTask.worktreePath ?? selectedTask.workspaceRoot}
                        </dd>
                      </div>
                    </dl>

                    {selectedTask.mainRepoDirtyAtStart && (
                      <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                        <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                        <span>{t("bots:inspector.dirtyWarning")}</span>
                      </div>
                    )}

                    {selectedTask.resultSummary && (
                      <div className="rounded-xl border border-border/80 bg-card px-3.5 py-2.5 text-xs leading-[1.55]">
                        <p className="mb-1 text-[0.6875rem] font-medium text-muted-foreground">{t("bots:inspector.resultSummary")}</p>
                        <p className="whitespace-pre-wrap text-foreground">{selectedTask.resultSummary}</p>
                      </div>
                    )}
                  </section>

                  {actionError && (
                    <div role="alert" className="rounded-xl border border-status-danger-border bg-status-danger-bg px-3.5 py-2.5 text-xs text-status-danger">
                      {actionError}
                    </div>
                  )}

                  {/* Active Worker Steer & Cancel Controls */}
                  {active && (
                    <section aria-label={t("bots:inspector.steerLabel")} className="space-y-2.5 rounded-xl border border-border bg-card p-3.5">
                      <p className="text-xs font-medium text-foreground">{t("bots:inspector.steerLabel")}</p>
                      <form
                        className="flex items-center gap-2"
                        onSubmit={event => {
                          event.preventDefault();
                          void handleSteer();
                        }}
                      >
                        <Input
                          value={steerInput}
                          disabled={Boolean(busyAction)}
                          aria-label={t("bots:inspector.steerLabel")}
                          placeholder={t("bots:inspector.steerPlaceholder")}
                          className="h-8 flex-1 text-xs"
                          onChange={event => setSteerInput(event.target.value)}
                        />
                        <Button
                          type="submit"
                          size="sm"
                          disabled={Boolean(busyAction) || !steerInput.trim()}
                        >
                          <Send aria-hidden="true" />
                          {t("bots:inspector.steerSend")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={Boolean(busyAction)}
                          onClick={() => void handleCancel()}
                        >
                          <Square aria-hidden="true" className="size-3 fill-current" />
                          {t("bots:inspector.cancelTask")}
                        </Button>
                      </form>
                    </section>
                  )}

                  {/* Worktree Diff & Safe Merge */}
                  {hasWorktree && (
                    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <h3 className="text-xs font-semibold text-foreground">{t("bots:inspector.diffHeading")}</h3>
                          <Badge variant="secondary" className="text-[0.6875rem]">
                            {t(`bots:inspector.worktreeState.${selectedTask.worktreeState}`)}
                          </Badge>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          disabled={diffQuery.isFetching}
                          onClick={() => void diffQuery.refetch()}
                        >
                          <RefreshCw aria-hidden="true" className={cn("size-3", diffQuery.isFetching && "animate-spin motion-reduce:animate-none")} />
                          {t("bots:inspector.refresh")}
                        </Button>
                      </div>

                      {applyOutcome && (
                        applyOutcome.applied ? (
                          <div role="status" className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
                            <CheckCircle2 aria-hidden="true" className="size-3.5 shrink-0" />
                            <span>{t("bots:inspector.mergeSuccess")}</span>
                          </div>
                        ) : (
                          <div role="alert" className="space-y-1 rounded-lg border border-status-danger-border bg-status-danger-bg px-3 py-2 text-xs text-status-danger">
                            <p className="font-medium">
                              {applyOutcome.reason === "MAIN_REPO_DIRTY"
                                ? t("bots:errors.mainRepoDirty")
                                : applyOutcome.reason === "MERGE_CONFLICT"
                                  ? t("bots:errors.mergeConflict")
                                  : t("bots:inspector.conflictHeading")}
                            </p>
                            {applyOutcome.conflictFiles && applyOutcome.conflictFiles.length > 0 && (
                              <p className="font-mono text-[0.6875rem]">
                                {t("bots:inspector.conflictFiles", { files: applyOutcome.conflictFiles.join(", ") })}
                              </p>
                            )}
                          </div>
                        )
                      )}

                      {diffQuery.isPending ? (
                        <p className="text-xs text-muted-foreground">{t("bots:inspector.loadingDiff")}</p>
                      ) : !diffQuery.data?.hasChanges ? (
                        <p className="text-xs text-muted-foreground">{t("bots:inspector.noChanges")}</p>
                      ) : (
                        <>
                          {diffQuery.data.files.length > 0 && (
                            <ul className="space-y-1 rounded-lg border border-border/70 bg-muted/20 p-2.5 font-mono text-[0.75rem]">
                              {diffQuery.data.files.map(file => (
                                <li key={file.path} className="flex items-center justify-between gap-2">
                                  <span className="min-w-0 truncate text-foreground">{file.path}</span>
                                  <span className="shrink-0 tabular-nums">
                                    <span className="text-emerald-600 dark:text-emerald-400">+{file.additions}</span>{" "}
                                    <span className="text-status-danger">-{file.deletions}</span>
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                          {diffQuery.data.patch && (
                            <CodeBlock size="sm">
                              <CodeBlockContent wrap={false} className="max-h-72">{diffQuery.data.patch}</CodeBlockContent>
                            </CodeBlock>
                          )}
                          {diffQuery.data.truncated && (
                            <p className="text-[0.6875rem] text-muted-foreground">{t("bots:inspector.truncatedDiff")}</p>
                          )}
                        </>
                      )}

                      {(canApplyWorktree || canDiscardWorktree) && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          {canApplyWorktree && (
                            <>
                              <Button
                                size="sm"
                                disabled={Boolean(busyAction)}
                                onClick={() => void handleApply("merge")}
                              >
                                <GitMerge aria-hidden="true" />
                                {t("bots:inspector.merge")}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={Boolean(busyAction)}
                                onClick={() => void handleApply("apply_patch")}
                              >
                                {t("bots:inspector.applyPatch")}
                              </Button>
                            </>
                          )}
                          {canDiscardWorktree && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="ms-auto text-status-danger hover:bg-status-danger-bg hover:text-status-danger"
                              disabled={Boolean(busyAction)}
                              onClick={() => void handleDiscard()}
                            >
                              <Trash2 aria-hidden="true" />
                              {t("bots:inspector.discard")}
                            </Button>
                          )}
                        </div>
                      )}
                    </section>
                  )}

                  <Separator />

                  {/* Worker Execution Trace */}
                  <section className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold text-foreground">{t("bots:inspector.traceHeading")}</h3>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={sessionQuery.isFetching}
                        onClick={() => void sessionQuery.refetch()}
                      >
                        <RefreshCw aria-hidden="true" className={cn("size-3", sessionQuery.isFetching && "animate-spin motion-reduce:animate-none")} />
                        {t("bots:inspector.refresh")}
                      </Button>
                    </div>

                    {sessionQuery.isPending ? (
                      <p className="text-xs text-muted-foreground">{t("bots:inspector.loadingTrace")}</p>
                    ) : traceItems.length === 0 ? (
                      <p className="text-xs text-muted-foreground">{t("bots:inspector.emptyTrace")}</p>
                    ) : (
                      <div className="space-y-4">
                        {traceItems.map(item => (
                          <div key={item.id}>
                            {item.type === "tools" ? (
                              <ToolActivity messages={item.messages} active={active} />
                            ) : (
                              <ChatMessage
                                role={item.message.role}
                                content={item.message.content}
                                streaming={Boolean(active && item.message.streaming)}
                                showCopy={!item.message.streaming}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              </ScrollArea>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
