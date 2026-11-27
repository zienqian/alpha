import { useRef, useState, type DragEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings,
  X,
} from "lucide-react";
import { useTranslation } from "@/i18n/react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  botErrorMessage,
  reorderBots,
  setBotArchived,
  updateBot,
  type BotSummaryView,
} from "./api";
import { BotAvatar } from "./bot-avatar";
import { botKeys } from "./use-bots";

function BotCompactBadge({ bot }: { bot: BotSummaryView }) {
  const { t } = useTranslation();
  if (bot.pendingApprovalCount > 0) {
    return (
      <span
        aria-label={t("bots:statusBadge.approval", { count: bot.pendingApprovalCount })}
        className="ms-auto inline-flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full bg-amber-500/15 px-1.5 text-[0.6875rem] font-medium text-amber-700 tabular-nums dark:text-amber-300"
      >
        {bot.pendingApprovalCount}
      </span>
    );
  }
  if (bot.activeTaskCount > 0 || bot.routerBusy) {
    return (
      <span
        role="img"
        aria-label={t("bots:status.working")}
        className="ms-auto inline-flex shrink-0 items-center gap-1 text-[0.6875rem] text-(--sidebar-muted) tabular-nums"
      >
        <LoaderCircle aria-hidden="true" className="size-3 animate-spin motion-reduce:animate-none" />
        {bot.activeTaskCount > 0 && <span>{bot.activeTaskCount}</span>}
      </span>
    );
  }
  if (bot.readyDiffCount > 0) {
    return (
      <span
        aria-label={t("bots:statusBadge.diff", { count: bot.readyDiffCount })}
        className="ms-auto inline-flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full bg-emerald-500/14 px-1.5 text-[0.6875rem] font-medium text-emerald-700 tabular-nums dark:text-emerald-300"
      >
        {bot.readyDiffCount}
      </span>
    );
  }
  return null;
}

function BotSidebarRow({
  bot,
  active,
  canMoveUp,
  canMoveDown,
  draggable,
  onSelect,
  onOpenSettings,
  onMove,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  bot: BotSummaryView;
  active: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  draggable: boolean;
  onSelect: () => void;
  onOpenSettings: () => void;
  onMove: (direction: -1 | 1) => void;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(bot.name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const focusEditor = useRef(false);

  async function submitRename() {
    const trimmed = draftName.trim();
    if (pending || !trimmed) return;
    setPending(true);
    setError(undefined);
    try {
      await updateBot(bot.id, { name: trimmed });
      setEditing(false);
      void client.invalidateQueries({ queryKey: botKeys.all });
      requestAnimationFrame(() => menuRef.current?.focus());
    } catch (cause) {
      setError(botErrorMessage(t, cause));
    } finally {
      setPending(false);
    }
  }

  async function toggleArchive() {
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      await setBotArchived(bot.id, !bot.archivedAt);
      void client.invalidateQueries({ queryKey: botKeys.all });
    } catch (cause) {
      setError(botErrorMessage(t, cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <SidebarMenuItem>
      <div
        className="group/bot-row relative"
        draggable={draggable && !editing}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {editing ? (
          <form
            className="flex min-h-8.5 items-center gap-1"
            onSubmit={event => {
              event.preventDefault();
              void submitRename();
            }}
          >
            <Input
              ref={inputRef}
              value={draftName}
              maxLength={120}
              disabled={pending}
              aria-label={t("bots:renamePrompt")}
              aria-invalid={Boolean(error)}
              className="h-8 min-w-0 px-2.5 md:text-[0.8125rem]"
              onChange={event => {
                setDraftName(event.target.value);
                setError(undefined);
              }}
              onKeyDown={event => {
                if (event.key === "Escape" && !pending && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.stopPropagation();
                  setEditing(false);
                  setError(undefined);
                  requestAnimationFrame(() => menuRef.current?.focus());
                }
              }}
            />
            <Button
              type="submit"
              variant="ghost"
              size="icon-sm"
              disabled={pending || !draftName.trim()}
              aria-label={t("sessions:saveEdit")}
            >
              <Check aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={pending}
              aria-label={t("sessions:cancelEdit")}
              onClick={() => {
                setEditing(false);
                setError(undefined);
                requestAnimationFrame(() => menuRef.current?.focus());
              }}
            >
              <X aria-hidden="true" />
            </Button>
          </form>
        ) : (
          <>
            <SidebarMenuButton
              asChild
              isActive={active}
              className="h-8.5 w-full gap-2 rounded-lg pe-8 ps-2 text-[0.8125rem] leading-[1.4] text-sidebar-foreground transition-colors duration-100 ease-out hover:bg-(--sidebar-hover) hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground"
            >
              <button
                type="button"
                aria-current={active ? "page" : undefined}
                aria-label={bot.name}
                title={`${bot.name} · ${bot.projectName}`}
                onClick={onSelect}
                onDoubleClick={() => {
                  setDraftName(bot.name);
                  setError(undefined);
                  setEditing(true);
                  requestAnimationFrame(() => {
                    inputRef.current?.focus();
                    inputRef.current?.select();
                  });
                }}
              >
                <BotAvatar
                  appearance={bot.appearance}
                  status={bot.archivedAt ? undefined : bot.status}
                  size="xs"
                />
                <span className={cn("min-w-0 flex-1 truncate text-start", bot.archivedAt && "opacity-65")}>
                  {bot.name}
                </span>
                {!bot.archivedAt && <BotCompactBadge bot={bot} />}
              </button>
            </SidebarMenuButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  ref={menuRef}
                  variant="ghost"
                  size="icon-sm"
                  disabled={pending}
                  className="absolute top-1/2 end-0.5 -translate-y-1/2 text-(--sidebar-muted) hover:bg-(--sidebar-hover) hover:text-sidebar-accent-foreground md:opacity-0 md:group-hover/bot-row:opacity-100 md:group-has-[:focus-visible]/bot-row:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
                  aria-label={t("bots:botMenu", { name: bot.name })}
                >
                  <MoreHorizontal aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                onCloseAutoFocus={event => {
                  if (focusEditor.current) {
                    event.preventDefault();
                    focusEditor.current = false;
                    inputRef.current?.focus();
                    inputRef.current?.select();
                  }
                }}
              >
                <DropdownMenuItem onSelect={onOpenSettings}>
                  <Settings aria-hidden="true" />
                  {t("bots:settings")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setDraftName(bot.name);
                    setError(undefined);
                    focusEditor.current = true;
                    setEditing(true);
                  }}
                >
                  <Pencil aria-hidden="true" />
                  {t("bots:rename")}
                </DropdownMenuItem>
                {(canMoveUp || canMoveDown) && (
                  <>
                    <DropdownMenuSeparator />
                    {canMoveUp && (
                      <DropdownMenuItem onSelect={() => onMove(-1)}>
                        <ArrowUp aria-hidden="true" />
                        {t("bots:moveUp")}
                      </DropdownMenuItem>
                    )}
                    {canMoveDown && (
                      <DropdownMenuItem onSelect={() => onMove(1)}>
                        <ArrowDown aria-hidden="true" />
                        {t("bots:moveDown")}
                      </DropdownMenuItem>
                    )}
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void toggleArchive()}>
                  {bot.archivedAt ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
                  {t(bot.archivedAt ? "bots:unarchive" : "bots:archive")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="px-2 py-1 text-xs leading-[1.45] text-status-danger">
          {error}
        </p>
      )}
    </SidebarMenuItem>
  );
}

export function BotSidebarSection({
  bots,
  selectedBotId,
  onSelectBot,
  onCreateBot,
  onOpenBotSettings,
}: {
  bots: readonly BotSummaryView[];
  selectedBotId?: string;
  onSelectBot: (botId: string) => void;
  onCreateBot: () => void;
  onOpenBotSettings: (botId: string) => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [open, setOpen] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const draggedBotId = useRef<string | null>(null);

  const activeBots = bots.filter(bot => !bot.archivedAt);
  const archivedBots = bots.filter(bot => Boolean(bot.archivedAt));

  async function commitOrder(nextActive: readonly BotSummaryView[]) {
    const ids = [...nextActive.map(b => b.id), ...archivedBots.map(b => b.id)];
    try {
      const updated = await reorderBots(ids);
      client.setQueryData(botKeys.index(true), updated);
      void client.invalidateQueries({ queryKey: botKeys.all });
    } catch {
      void client.invalidateQueries({ queryKey: botKeys.all });
    }
  }

  function moveBot(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= activeBots.length) return;
    const next = [...activeBots];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    void commitOrder(next);
  }

  function dropBot(targetBotId: string) {
    const sourceId = draggedBotId.current;
    draggedBotId.current = null;
    if (!sourceId || sourceId === targetBotId) return;
    const from = activeBots.findIndex(b => b.id === sourceId);
    const to = activeBots.findIndex(b => b.id === targetBotId);
    if (from < 0 || to < 0) return;
    const next = [...activeBots];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    void commitOrder(next);
  }

  return (
    <SidebarGroup className="px-(--sidebar-inset) py-0 pb-3">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="mb-1 flex items-center justify-between gap-2">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              aria-label={t("bots:toggleSection")}
              className="group/bots-hdr inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-[0.75rem] font-medium text-(--sidebar-muted) transition-colors hover:text-sidebar-accent-foreground"
            >
              <ChevronRight
                aria-hidden="true"
                className={cn("size-3 transition-transform duration-150", open && "rotate-90")}
              />
              <SidebarGroupLabel asChild className="h-auto p-0 text-[0.75rem] font-medium text-inherit">
                <span>{t("bots:sectionTitle")}</span>
              </SidebarGroupLabel>
            </button>
          </CollapsibleTrigger>
          <Button
            data-create-bot
            variant="ghost"
            size="icon-sm"
            className="text-(--sidebar-muted) hover:bg-(--sidebar-hover) hover:text-sidebar-accent-foreground"
            aria-label={t("bots:create")}
            title={t("bots:create")}
            onClick={onCreateBot}
          >
            <Plus aria-hidden="true" />
          </Button>
        </div>

        <CollapsibleContent>
          <SidebarGroupContent>
            {activeBots.length > 0 ? (
              <nav aria-label={t("bots:sectionTitle")}>
                <SidebarMenu className="gap-0.5">
                  {activeBots.map((bot, index) => (
                    <BotSidebarRow
                      key={bot.id}
                      bot={bot}
                      active={selectedBotId === bot.id}
                      canMoveUp={index > 0}
                      canMoveDown={index < activeBots.length - 1}
                      draggable={activeBots.length > 1}
                      onSelect={() => onSelectBot(bot.id)}
                      onOpenSettings={() => onOpenBotSettings(bot.id)}
                      onMove={delta => moveBot(index, delta)}
                      onDragStart={() => {
                        draggedBotId.current = bot.id;
                      }}
                      onDragOver={event => {
                        if (draggedBotId.current && draggedBotId.current !== bot.id) {
                          event.preventDefault();
                        }
                      }}
                      onDrop={event => {
                        event.preventDefault();
                        dropBot(bot.id);
                      }}
                    />
                  ))}
                </SidebarMenu>
              </nav>
            ) : (
              <button
                type="button"
                onClick={onCreateBot}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-xs text-(--sidebar-muted) transition-colors hover:bg-(--sidebar-hover) hover:text-sidebar-accent-foreground"
              >
                <Plus aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="truncate">{t("bots:create")}</span>
              </button>
            )}

            {archivedBots.length > 0 && (
              <div className="mt-1.5">
                <button
                  type="button"
                  onClick={() => setShowArchived(prev => !prev)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[0.6875rem] font-medium text-(--sidebar-muted) hover:text-sidebar-accent-foreground"
                >
                  <ChevronRight
                    aria-hidden="true"
                    className={cn("size-3 transition-transform duration-150", showArchived && "rotate-90")}
                  />
                  <span>{t("bots:archivedSection", { count: archivedBots.length })}</span>
                </button>
                {showArchived && (
                  <SidebarMenu className="mt-0.5 gap-0.5">
                    {archivedBots.map(bot => (
                      <BotSidebarRow
                        key={bot.id}
                        bot={bot}
                        active={selectedBotId === bot.id}
                        canMoveUp={false}
                        canMoveDown={false}
                        draggable={false}
                        onSelect={() => onSelectBot(bot.id)}
                        onOpenSettings={() => onOpenBotSettings(bot.id)}
                        onMove={() => undefined}
                      />
                    ))}
                  </SidebarMenu>
                )}
              </div>
            )}
          </SidebarGroupContent>
        </CollapsibleContent>
      </Collapsible>
    </SidebarGroup>
  );
}

export function BotSidebarRail({
  bots,
  selectedBotId,
  onSelectBot,
  onCreateBot,
}: {
  bots: readonly BotSummaryView[];
  selectedBotId?: string;
  onSelectBot: (botId: string) => void;
  onCreateBot: () => void;
}) {
  const { t } = useTranslation();
  const activeBots = bots.filter(bot => !bot.archivedAt);

  return (
    <nav aria-label={t("bots:sectionTitle")} className="flex flex-col items-center gap-1.5">
      {activeBots.map(bot => (
        <Tooltip key={bot.id}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="rail-action hover:bg-(--sidebar-hover) hover:text-sidebar-accent-foreground"
              aria-label={t("bots:openBot", { name: bot.name })}
              aria-current={selectedBotId === bot.id ? "page" : undefined}
              data-active={selectedBotId === bot.id}
              onClick={() => onSelectBot(bot.id)}
            >
              <BotAvatar appearance={bot.appearance} status={bot.status} size="xs" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {bot.name} · {t(`bots:status.${bot.status}`)}
          </TooltipContent>
        </Tooltip>
      ))}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="rail-action hover:bg-(--sidebar-hover) hover:text-sidebar-accent-foreground"
            aria-label={t("bots:create")}
            onClick={onCreateBot}
          >
            <Plus aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{t("bots:create")}</TooltipContent>
      </Tooltip>
    </nav>
  );
}
