import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArchiveRestore,
  ArrowUp,
  Folder,
  GitBranch,
  Layers,
  LoaderCircle,
  Paperclip,
  Settings,
  ShieldAlert,
  Square,
  Terminal,
  Upload,
} from "lucide-react";
import { useTranslation } from "@/i18n/react";
import { ChatMessage } from "@/components/ai-elements/message";
import { DraftAttachmentList } from "@/components/ai-elements/attachment-list";
import { ReplyProgress } from "@/components/ai-elements/chain-of-thought";
import { MarkdownEditor } from "@/components/ai-elements/markdown-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupButton } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Skeleton } from "@/components/ui/skeleton";
import { ContextUsageIndicator } from "@/features/sessions/context-usage";
import { maxAttachmentBytes, maxAttachmentCount, type DraftAttachment } from "@/features/sessions/use-session-workspace";
import { cn } from "@/lib/utils";
import {
  answerBotApproval,
  botErrorMessage,
  cancelBotRouter,
  markBotVisited,
  sendBotMessage,
  setBotArchived,
  uploadBotFiles,
  type BotApprovalView,
} from "./api";
import { BotAvatar, BotStatusLabel } from "./bot-avatar";
import { botKeys, useBotDetail } from "./use-bots";
import { WorkerInspectorDrawer } from "./worker-inspector-drawer";

function BotApprovalCard({
  approval,
  disabled,
  onAnswer,
}: {
  approval: BotApprovalView;
  disabled: boolean;
  onAnswer: (allow: boolean) => void;
}) {
  const { t } = useTranslation();
  const commandPreview = approval.request.preview.type === "command" ? approval.request.preview : undefined;
  return (
    <Item variant="outline" size="sm" className="flex-col items-stretch gap-2.5 bg-card">
      <div className="flex items-start gap-3">
        <ItemMedia variant="icon" className="text-foreground">
          {commandPreview ? <Terminal aria-hidden="true" /> : <ShieldAlert aria-hidden="true" />}
        </ItemMedia>
        <ItemContent>
          <div className="flex flex-wrap items-center gap-1.5">
            <ItemTitle>{t("tools:allow", { toolName: approval.request.name })}</ItemTitle>
            <Badge variant="outline" className="text-[0.6875rem] font-normal text-muted-foreground">
              {t("bots:chat.approvalTaskLabel", { shortId: approval.taskShortId, title: approval.taskTitle })}
            </Badge>
          </div>
          {commandPreview && (
            <ItemDescription className="font-mono text-[0.6875rem] break-all">
              {commandPreview.cwd} · {commandPreview.shell}
            </ItemDescription>
          )}
        </ItemContent>
        <ItemActions className="ms-auto">
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => onAnswer(false)}>
            {t("tools:deny")}
          </Button>
          <Button size="sm" disabled={disabled} onClick={() => onAnswer(true)}>
            {t("tools:allowOnce")}
          </Button>
        </ItemActions>
      </div>
      {commandPreview && (
        <CodeBlock size="sm">
          <CodeBlockContent wrap className="max-h-32">{commandPreview.command}</CodeBlockContent>
        </CodeBlock>
      )}
    </Item>
  );
}

export function BotChatPage() {
  const { botId } = useParams<{ botId: string }>();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { t } = useTranslation();
  const detail = useBotDetail(botId);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [busyAction, setBusyAction] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string>();
  const lastVisitedMarker = useRef<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const statusId = useId();

  const data = detail.data;
  const bot = data?.bot;
  const router = data?.router;
  const tasks = useMemo(() => data?.tasks ?? [], [data?.tasks]);
  const approvals = useMemo(() => data?.approvals ?? [], [data?.approvals]);

  // Mark bot visited when entering or when a background completion arrives while viewing.
  useEffect(() => {
    if (!bot) return;
    const marker = `${bot.id}:${bot.status}:${bot.updatedAt}`;
    if (marker === lastVisitedMarker.current) return;
    if (bot.status === "done" || bot.status === "attention_error") {
      lastVisitedMarker.current = marker;
      void markBotVisited(bot.id).catch(() => undefined);
    }
  }, [bot]);

  useEffect(() => {
    setDraft("");
    setAttachments([]);
    setUploading(false);
    setDragActive(false);
    dragDepth.current = 0;
    setActionError(undefined);
    setSelectedTaskId(undefined);
    setInspectorOpen(false);
    setFocusRequest(count => count + 1);
  }, [botId]);

  const chatMessages = useMemo(
    () => (router?.messages ?? []).filter((m): m is typeof m & { role: "user" | "assistant" } => m.role === "user" || m.role === "assistant"),
    [router?.messages],
  );

  const highlightTasks = useMemo(
    () => tasks.filter(task => task.status === "running" || task.status === "awaiting_approval" || task.status === "queued" || task.worktreeState === "ready_for_review"),
    [tasks],
  );

  const hasContent = draft.trim().length > 0 || attachments.length > 0;
  const composerDisabled = Boolean(!bot || bot.archivedAt || bot.projectMissing || submitting || uploading);
  const canSend = Boolean(
    bot &&
    !bot.archivedAt &&
    !bot.projectMissing &&
    router?.canSend !== false &&
    hasContent &&
    !submitting &&
    !uploading,
  );

  function addFiles(incoming: readonly File[]) {
    if (!incoming.length || composerDisabled) return;
    let rejectedError: string | undefined;
    setAttachments(previous => {
      const next = [...previous];
      for (const file of incoming) {
        if (next.length >= maxAttachmentCount) {
          rejectedError ??= t("sessions:tooManyAttachments", { limit: maxAttachmentCount });
          break;
        }
        if (file.size > maxAttachmentBytes) {
          rejectedError ??= t("sessions:attachmentTooLarge", { name: file.name });
          continue;
        }
        next.push({ id: crypto.randomUUID(), file, status: "idle" });
      }
      return next;
    });
    setActionError(rejectedError);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (selected.length > 0) addFiles(selected);
  }

  function hasDraggedFiles(event: DragEvent): boolean {
    return Array.from(event.dataTransfer?.types ?? []).includes("Files");
  }

  async function handleSend() {
    if (!bot || !canSend) return;
    const text = draft.trim();
    const currentAttachments = attachments;
    const requestId = `botreq_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    setActionError(undefined);
    let attachmentIds: string[] | undefined;
    if (currentAttachments.length > 0) {
      const pending = currentAttachments.filter(item => !item.uploaded);
      if (pending.length > 0) {
        const pendingIds = new Set(pending.map(item => item.id));
        setUploading(true);
        setAttachments(prev => prev.map(item => pendingIds.has(item.id) ? { ...item, status: "uploading", error: undefined } : item));
        try {
          const uploaded = await uploadBotFiles(bot.id, pending.map(item => item.file));
          const map = new Map(pending.map((item, idx) => [item.id, uploaded[idx]] as const));
          setAttachments(prev => prev.map(item => {
            const saved = map.get(item.id);
            return saved ? { ...item, status: "done", uploaded: saved, error: undefined } : item;
          }));
          attachmentIds = currentAttachments
            .map(item => (item.uploaded ?? map.get(item.id))?.id)
            .filter((itemId): itemId is string => Boolean(itemId));
        } catch (cause) {
          const message = botErrorMessage(t, cause);
          setActionError(message);
          setAttachments(prev => prev.map(item => pendingIds.has(item.id) ? { ...item, status: "error", error: message } : item));
          setUploading(false);
          return;
        } finally {
          setUploading(false);
        }
      } else {
        attachmentIds = currentAttachments
          .map(item => item.uploaded?.id)
          .filter((itemId): itemId is string => Boolean(itemId));
      }
    }

    setSubmitting(true);
    setDraft("");
    setAttachments([]);
    try {
      await sendBotMessage(bot.id, requestId, text, attachmentIds);
      void detail.refetch();
    } catch (cause) {
      setDraft(text);
      setAttachments(currentAttachments);
      setActionError(botErrorMessage(t, cause));
    } finally {
      setSubmitting(false);
      setFocusRequest(count => count + 1);
    }
  }

  async function handleStopRouter() {
    if (!bot) return;
    setActionError(undefined);
    try {
      await cancelBotRouter(bot.id);
      void detail.refetch();
    } catch (cause) {
      setActionError(botErrorMessage(t, cause));
    }
  }

  async function handleAnswerApproval(approval: BotApprovalView, allow: boolean) {
    if (!bot) return;
    setBusyAction(approval.approvalId);
    setActionError(undefined);
    try {
      await answerBotApproval(bot.id, approval.approvalId, approval.taskId, allow);
      void detail.refetch();
      void client.invalidateQueries({ queryKey: botKeys.all });
    } catch (cause) {
      setActionError(botErrorMessage(t, cause));
    } finally {
      setBusyAction(undefined);
    }
  }

  async function handleUnarchive() {
    if (!bot) return;
    setBusyAction("unarchive");
    setActionError(undefined);
    try {
      await setBotArchived(bot.id, false);
      void detail.refetch();
      void client.invalidateQueries({ queryKey: botKeys.all });
    } catch (cause) {
      setActionError(botErrorMessage(t, cause));
    } finally {
      setBusyAction(undefined);
    }
  }

  function openInspector(taskId?: string) {
    setSelectedTaskId(taskId ?? highlightTasks[0]?.id ?? tasks[0]?.id);
    setInspectorOpen(true);
  }

  if (detail.isPending) {
    return (
      <div id="bot-content" tabIndex={-1} role="status" aria-label={t("common:loading")} className="mx-auto w-full max-w-[744px] space-y-4 px-5 py-8 outline-none sm:px-8">
        <Skeleton className="h-7 w-48 rounded-lg" />
        <Skeleton className="h-12 w-2/3 rounded-2xl" />
        <Skeleton className="h-4 w-full rounded-md" />
        <Skeleton className="h-4 w-4/5 rounded-md" />
      </div>
    );
  }

  if (detail.isError || !bot || !router) {
    return (
      <div id="bot-content" tabIndex={-1} className="flex min-h-0 flex-1 items-center justify-center p-6 outline-none">
        <Empty className="max-w-md rounded-2xl border border-dashed border-border bg-card/40 py-10">
          <EmptyHeader>
            <EmptyMedia variant="icon" className="size-10 rounded-xl">
              <AlertTriangle aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>{t("bots:chat.notFoundTitle")}</EmptyTitle>
            <EmptyDescription>
              {detail.error ? botErrorMessage(t, detail.error) : t("bots:chat.notFoundBody")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const totalAttention = bot.activeTaskCount + bot.queuedTaskCount + bot.readyDiffCount + bot.pendingApprovalCount;

  return (
    <div id="bot-content" tabIndex={-1} className="flex min-h-0 flex-1 flex-col overflow-hidden outline-none">
      {/* Compact Bot identity & Workers header */}
      <div className="shrink-0 border-b border-border/70 px-4 py-2.5 sm:px-6">
        <div className="mx-auto flex w-full max-w-[744px] flex-wrap items-center gap-2.5">
          <BotAvatar appearance={bot.appearance} status={bot.archivedAt ? undefined : bot.status} size="md" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-[0.9375rem] leading-[1.3] font-semibold tracking-[-0.015em] text-foreground">
                {bot.name}
              </h1>
              {bot.archivedAt ? (
                <Badge variant="secondary" className="text-[0.6875rem]">{t("bots:archivedBadge")}</Badge>
              ) : (
                <BotStatusLabel status={bot.status} />
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span
                title={bot.workspaceRoot ?? bot.projectId}
                className={cn(
                  "inline-flex min-w-0 items-center gap-1 truncate",
                  bot.projectMissing && "text-status-danger",
                )}
              >
                <Folder aria-hidden="true" className="size-3 shrink-0" />
                <span className="truncate">{bot.projectName}</span>
              </span>
              {bot.effectiveRouterModel?.modelId && (
                <span className="truncate font-mono text-[0.6875rem] text-muted-foreground/80">
                  {bot.effectiveRouterModel.modelId}
                </span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 rounded-lg px-2.5 text-xs"
              onClick={() => openInspector()}
            >
              <Layers aria-hidden="true" className="size-3.5" />
              <span>{t("bots:chat.tasksButton")}</span>
              {totalAttention > 0 && (
                <Badge variant={bot.pendingApprovalCount > 0 ? "default" : "secondary"} className="h-4.5 px-1.5 text-[0.6875rem] tabular-nums">
                  {totalAttention}
                </Badge>
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("bots:settings")}
              title={t("bots:settings")}
              onClick={() => void navigate(`/bots/${encodeURIComponent(bot.id)}/settings`)}
            >
              <Settings aria-hidden="true" />
            </Button>
          </div>
        </div>

        {/* Active / reviewable Worker strip */}
        {highlightTasks.length > 0 && (
          <div aria-label={t("bots:chat.activeTasksLabel")} className="mx-auto mt-2 flex w-full max-w-[744px] flex-wrap items-center gap-1.5">
            {highlightTasks.map(task => (
              <button
                key={task.id}
                type="button"
                onClick={() => openInspector(task.id)}
                className="inline-flex max-w-60 items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-accent dark:bg-card"
              >
                {task.status === "running" ? (
                  <LoaderCircle aria-hidden="true" className="size-3 shrink-0 animate-spin text-blue-500 motion-reduce:animate-none" />
                ) : task.worktreeState === "ready_for_review" ? (
                  <GitBranch aria-hidden="true" className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-amber-500" />
                )}
                <span className="font-mono text-[0.6875rem] text-muted-foreground">#{task.shortId}</span>
                <span className="truncate">{task.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Protection & status banners */}
      {(bot.projectMissing || bot.archivedAt || router.error) && (
        <div className="shrink-0 px-4 pt-3 sm:px-6">
          <div className="mx-auto w-full max-w-[744px] space-y-2">
            {bot.projectMissing && (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-status-danger-border bg-status-danger-bg px-3.5 py-2.5 text-xs leading-[1.5] text-status-danger">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="font-medium">{t("bots:chat.projectMissingTitle")}</p>
                  <p className="opacity-90">{t("bots:chat.projectMissingBody")}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void navigate(`/bots/${encodeURIComponent(bot.id)}/settings`)}
                >
                  {t("bots:chat.rebindProject")}
                </Button>
              </div>
            )}
            {bot.archivedAt && (
              <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-3.5 py-2.5 text-xs text-muted-foreground">
                <p>{t("bots:chat.archivedNotice")}</p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyAction === "unarchive"}
                  onClick={() => void handleUnarchive()}
                >
                  <ArchiveRestore aria-hidden="true" />
                  {t("bots:unarchive")}
                </Button>
              </div>
            )}
            {router.error && (
              <div role="status" className="rounded-xl border border-status-danger-border bg-status-danger-bg px-3.5 py-2 text-xs text-status-danger">
                {t("bots:errors.generic", { code: router.error })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Permanent Chat Timeline */}
      <div className="flex min-h-0 flex-1 flex-col">
        {chatMessages.length === 0 && !router.busy ? (
          <Empty role="status" className="flex-1">
            <EmptyHeader className="max-w-md">
              <BotAvatar appearance={bot.appearance} size="lg" className="mb-1" />
              <EmptyTitle>{t("bots:chat.emptyTitle", { name: bot.name })}</EmptyTitle>
              <EmptyDescription>
                {t("bots:chat.emptyHint", { name: bot.name, project: bot.projectName })}
              </EmptyDescription>
              {bot.instructions && (
                <p className="mt-2 line-clamp-3 rounded-xl border border-border/80 bg-muted/30 px-3.5 py-2.5 text-xs leading-[1.55] text-muted-foreground">
                  {bot.instructions}
                </p>
              )}
            </EmptyHeader>
          </Empty>
        ) : (
          <MessageScrollerProvider autoScroll>
            <MessageScroller>
              <MessageScrollerViewport tabIndex={0} aria-label={t("sessions:history")} className="scroll-pt-4">
                <MessageScrollerContent role="list" aria-label={t("sessions:messages")} className="mx-auto w-full max-w-[744px] gap-6 px-5 py-7 sm:px-8">
                  {chatMessages.map(message => (
                    <MessageScrollerItem key={message.id} messageId={message.id} role="listitem">
                      <article aria-label={message.role === "user" ? t("sessions:userMessage") : t("sessions:assistantMessage")}>
                        <ChatMessage
                          role={message.role}
                          content={message.text}
                          attachments={message.attachments}
                          streaming={Boolean(router.busy && message.streaming)}
                          showCopy={!message.streaming}
                        />
                      </article>
                    </MessageScrollerItem>
                  ))}
                  {router.busy && (
                    <MessageScrollerItem key="bot-reply-progress" messageId={`${bot.id}-progress`} role="listitem">
                      <ReplyProgress
                        hasContent={chatMessages.some(m => m.streaming && m.text.length > 0)}
                        phase={router.phase}
                        connected={detail.connection !== "error"}
                      />
                    </MessageScrollerItem>
                  )}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton
                aria-label={t("sessions:scrollBottom")}
                className="size-8 rounded-full border border-border bg-background text-foreground shadow-sm hover:bg-muted dark:bg-card"
              />
            </MessageScroller>
          </MessageScrollerProvider>
        )}
      </div>

      {/* Inline aggregated Worker approvals + Full-duplex Composer */}
      <div className="shrink-0 overflow-y-hidden scrollbar-gutter-stable">
        <div className="mx-auto w-full max-w-[744px] px-3 pt-2.5 pb-5 sm:px-8">
          {actionError && (
            <div role="alert" className="mb-3 rounded-xl border border-status-danger-border bg-status-danger-bg px-3.5 py-2.5 text-xs leading-[1.5] text-status-danger">
              {actionError}
            </div>
          )}

          {approvals.length > 0 && (
            <section aria-label={t("bots:chat.approvalsHeading")} className="mb-3 space-y-2">
              {approvals.map(approval => (
                <BotApprovalCard
                  key={approval.approvalId}
                  approval={approval}
                  disabled={busyAction === approval.approvalId}
                  onAnswer={allow => void handleAnswerApproval(approval, allow)}
                />
              ))}
            </section>
          )}

          <input
            ref={fileInputRef}
            type="file"
            multiple
            tabIndex={-1}
            aria-hidden="true"
            className="sr-only"
            onChange={handleFileChange}
          />
          <InputGroup
            onDragEnter={event => {
              if (composerDisabled || !hasDraggedFiles(event)) return;
              event.preventDefault();
              dragDepth.current += 1;
              setDragActive(true);
            }}
            onDragOver={event => {
              if (composerDisabled || !hasDraggedFiles(event)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }}
            onDragLeave={event => {
              if (composerDisabled || !hasDraggedFiles(event)) return;
              dragDepth.current = Math.max(0, dragDepth.current - 1);
              if (dragDepth.current === 0) setDragActive(false);
            }}
            onDrop={event => {
              if (composerDisabled || !hasDraggedFiles(event)) return;
              event.preventDefault();
              dragDepth.current = 0;
              setDragActive(false);
              const dropped = Array.from(event.dataTransfer.files ?? []);
              if (dropped.length > 0) addFiles(dropped);
            }}
            className={cn(
              "composer composer-surface relative rounded-2xl bg-clip-padding has-[[data-slot=input-group-control]:focus-visible]:border-ring has-[[data-slot=input-group-control]:focus-visible]:ring-0",
              dragActive && "border-ring bg-muted/35",
            )}
          >
            {dragActive && (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-2xl bg-background/85 backdrop-blur-[1px]">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-xs">
                  <Upload className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  {t("sessions:dropFiles")}
                </span>
              </div>
            )}
            {attachments.length > 0 && (
              <InputGroupAddon align="block-start" className="flex-wrap gap-1.5 px-3 pt-3 pb-0">
                <DraftAttachmentList
                  attachments={attachments}
                  disabled={submitting || uploading}
                  onRemove={id => {
                    setActionError(undefined);
                    setAttachments(prev => prev.filter(item => item.id !== id));
                  }}
                />
              </InputGroupAddon>
            )}
            <MarkdownEditor
              value={draft}
              onChange={setDraft}
              onPasteFiles={addFiles}
              label={t("bots:chat.draft")}
              placeholder={
                bot.activeTaskCount > 0
                  ? t("bots:chat.placeholderBusy")
                  : t("bots:chat.placeholder", { name: bot.name })
              }
              focusRequest={focusRequest}
              onSend={() => void handleSend()}
              canSend={canSend}
            />
            <InputGroupAddon align="block-end" className="min-w-0 flex-wrap gap-1.5 px-2.5 pt-1 pb-2.5">
              <InputGroupButton
                variant="ghost"
                size="icon-sm"
                className="size-8 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                disabled={composerDisabled}
                aria-label={t("sessions:addAttachment")}
                title={t("sessions:addAttachment")}
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="size-icon" aria-hidden="true" />
              </InputGroupButton>
              {chatMessages.length > 0 && router.contextUsage && (
                <ContextUsageIndicator usage={router.contextUsage} />
              )}
              {router.pendingTriggerCount > 0 && (
                <Badge variant="secondary" className="h-6 rounded-full px-2 text-[0.6875rem] font-normal tabular-nums">
                  {t("bots:chat.pendingTriggers", { count: router.pendingTriggerCount })}
                </Badge>
              )}
              <div className="ms-auto flex min-w-0 items-center gap-1.5">
                <span id={statusId} role="status" className="min-w-0 truncate px-1 text-xs font-normal text-muted-foreground empty:px-0">
                  {uploading ? t("sessions:uploading") : submitting ? t("sessions:submitting") : ""}
                </span>
                {router.busy && (
                  <InputGroupButton
                    variant={hasContent ? "ghost" : "default"}
                    size="icon-sm"
                    className="size-8 shrink-0 rounded-full"
                    aria-label={t("bots:chat.stopRouter")}
                    title={t("bots:chat.stopRouter")}
                    onClick={() => void handleStopRouter()}
                  >
                    <Square className="size-3.5 fill-current" aria-hidden="true" />
                  </InputGroupButton>
                )}
                <InputGroupButton
                  variant="default"
                  size="icon-sm"
                  className="size-8 shrink-0 rounded-full disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
                  disabled={!canSend}
                  aria-label={t("bots:chat.send")}
                  title={t("bots:chat.send")}
                  onClick={() => void handleSend()}
                >
                  {submitting || uploading ? (
                    <LoaderCircle className="size-icon motion-safe:animate-spin" aria-hidden="true" />
                  ) : (
                    <ArrowUp className="size-icon" aria-hidden="true" />
                  )}
                </InputGroupButton>
              </div>
            </InputGroupAddon>
          </InputGroup>
        </div>
      </div>

      <WorkerInspectorDrawer
        bot={bot}
        tasks={tasks}
        open={inspectorOpen}
        selectedTaskId={selectedTaskId}
        onSelectTask={setSelectedTaskId}
        onOpenChange={setInspectorOpen}
        onMutated={() => {
          void detail.refetch();
          void client.invalidateQueries({ queryKey: botKeys.all });
        }}
      />
    </div>
  );
}
