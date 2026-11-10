/* Layout and interaction adapted from Multica 10f0ab3. See third-party notice. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DropdownMenu, Popover } from "radix-ui";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type {
  TraceRunStatus,
  TraceView,
  TraceViewStep,
} from "@alpha/adk-trace/contracts";
import { useTranslation } from "@/i18n/react";
import { copyTrace, useTraceSearch, useTraceView } from "./api";
import { TraceIcon } from "./icons";
import { Hint, IconButton, useTracePortal } from "./primitives";
import { filterKey, groupRows, laneTotal } from "./format";
import { RunTimeline } from "./run-timeline";
import { TranscriptRow } from "./transcript-rows";
import { StepInspector } from "./step-inspector";
import multicaLogo from "./assets/multica.svg";
import "./trace.css";

export const statusKey = (status: TraceRunStatus) =>
  (
    ({
      running: "status_running",
      completed: "status_completed",
      failed: "status_failed",
      cancelled: "run_cancelled",
      refused: "run_refused",
      limited: "run_limited",
      incomplete: "run_incomplete",
      unknown: "run_unknown",
    }) as const
  )[status];
function RunHeader({
  view,
  onClose,
}: {
  view: TraceView;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const container = useTracePortal();
  const { summary } = view;
  const running = summary.runStatus === "running",
    completed = summary.runStatus === "completed";
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const duration =
    summary.durationMs ??
    (running ? Math.max(0, now - summary.startedAtMs) : null);
  const total =
    summary.inputTokens !== null && summary.outputTokens !== null
      ? summary.inputTokens + summary.outputTokens
      : null;
  const facts = [
    [t("traces:details_runtime"), view.agentName],
    [t("traces:details_provider"), view.provider],
    [t("traces:details_mode"), view.modelId],
    [t("traces:details_workdir"), view.workspace],
    [
      t("traces:details_started"),
      new Date(summary.startedAtMs).toLocaleString(i18n.language),
    ],
    [
      t("traces:details_completed"),
      summary.durationMs === null
        ? undefined
        : new Date(summary.startedAtMs + summary.durationMs).toLocaleString(
            i18n.language,
          ),
    ],
    [
      t("traces:input_tokens"),
      summary.inputTokens?.toLocaleString(i18n.language),
    ],
    [
      t("traces:output_tokens"),
      summary.outputTokens?.toLocaleString(i18n.language),
    ],
  ];
  return (
    <header className="header">
      <div className="header-line">
        <span
          className={`badge ${running ? "running" : completed ? "completed" : summary.runStatus === "failed" ? "failed" : "neutral"}`}
        >
          <TraceIcon
            name={running ? "Loader2" : completed ? "CheckCircle2" : "XCircle"}
            className={running ? "spin" : ""}
          />
          {t(`traces:${statusKey(summary.runStatus)}`)}
        </span>
        <div className="identity">
          <span className="avatar">
            <TraceIcon name="Bot" size={14} />
          </span>
          <span className="agent-name">{view.agentName}</span>
        </div>
        <div className="provenance">
          {view.provider && <span>{view.provider}</span>}
          {view.modelId && (
            <>
              <span>·</span>
              <span>{view.modelId}</span>
            </>
          )}
          {duration !== null && (
            <>
              <span>·</span>
              <span>
                {t("traces:fact_took", {
                  duration: laneTotal(duration),
                })}
              </span>
            </>
          )}
        </div>
        {total !== null && (
          <Hint label={t("traces:recorded_usage")}>
            <span className="usage">
              <TraceIcon name="Coins" />
              {total.toLocaleString(i18n.language)}
            </span>
          </Hint>
        )}
        <div className="header-actions">
          <Popover.Root>
            <Popover.Trigger asChild>
              <IconButton icon="Info" label={t("traces:run_info")} />
            </Popover.Trigger>
            <Popover.Portal container={container}>
              <Popover.Content
                className="popup info-popup"
                align="end"
                sideOffset={8}
              >
                <h3>{t("traces:run_info")}</h3>
                {facts.map(
                  ([label, value]) =>
                    value !== undefined && (
                      <div className="info-row" key={label}>
                        <span>{label}</span>
                        <span>{value}</span>
                      </div>
                    ),
                )}
                <div className="brand-attribution">
                  <a
                    href="https://github.com/multica-ai/multica"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <img src={multicaLogo} alt={t("traces:brand_name")} />
                    {t("traces:source")}
                  </a>
                  <span> · </span>
                  <a
                    href="/third-party/multica/LICENSE"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("traces:license")}
                  </a>
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <IconButton icon="X" label={t("traces:close")} onClick={onClose} />
        </div>
      </div>
    </header>
  );
}
function Transcript({
  sessionId,
  view,
}: {
  sessionId: string;
  view: TraceView;
}) {
  const { t } = useTranslation();
  const container = useTracePortal();
  const list = useRef<VirtuosoHandle>(null);
  const [search, setSearch] = useState(""),
    [filters, setFilters] = useState<Set<string>>(() => new Set()),
    [newest, setNewest] = useState(false),
    [selectedId, setSelectedId] = useState<string>(),
    [copyState, setCopyState] = useState<
      "copied" | "copy_failed" | "copy_truncated" | null
    >(null);
  const [atLiveEnd, setAtLiveEnd] = useState(true);
  const searchResult = useTraceSearch(
    sessionId,
    view.summary.traceId,
    search,
    view.summary.revision,
  );
  const steps = useMemo(() => {
    const matches = new Set(searchResult.data?.stepIds);
    return view.steps.filter(
      (step) =>
        (!filters.size || filters.has(filterKey(step))) &&
        (!search.trim() || matches.has(step.stepId)),
    );
  }, [view.steps, filters, search, searchResult.data]);
  const rows = useMemo(() => {
    const grouped = groupRows(steps);
    return newest ? grouped.reverse() : grouped;
  }, [steps, newest]);
  const selected = view.steps.find((s) => s.stepId === selectedId);
  const categories = useMemo(
    () => [...new Set(view.steps.map(filterKey))],
    [view.steps],
  );
  const labelFor = (key: string) =>
    key.startsWith("tool:")
      ? key.slice(5)
      : key === "text"
        ? t("traces:kind_text")
        : key === "error"
          ? t("traces:kind_error")
          : t("traces:model_request");
  const choose = (step: TraceViewStep) =>
    setSelectedId((current) =>
      current === step.stepId ? undefined : step.stepId,
    );
  function seek(ms: number) {
    const step = steps.find((s) => s.offsetMs >= ms) ?? steps.at(-1);
    if (!step) return;
    setSelectedId(step.stepId);
    const index = rows.findIndex((r) =>
      r.kind === "group"
        ? r.steps.some((s) => s.stepId === step.stepId)
        : r.stepId === step.stepId,
    );
    list.current?.scrollToIndex({ index, align: "center", behavior: "auto" });
  }
  async function copy() {
    try {
      const value = await copyTrace(
        sessionId,
        view.summary.traceId,
        (newest ? [...steps].reverse() : steps).map((s) => s.stepId),
      );
      await navigator.clipboard.writeText(value.text);
      setCopyState(value.truncated ? "copy_truncated" : "copied");
    } catch {
      setCopyState("copy_failed");
    }
  }
  return (
    <>
      {view.triggerSummary && (
        <div className="trigger">
          <span className="trigger-label">{t("traces:trigger_text")}</span>
          <p>{view.triggerSummary}</p>
        </div>
      )}
      {view.outcome && (
        <div className="outcome">
          <span className="outcome-label">{t("traces:outcome_label")}</span>
          {view.outcome.files > 0 && (
            <span className="chip">
              <TraceIcon name="FilePen" />
              <strong>
                {t("traces:outcome_files", { count: view.outcome.files })}
              </strong>
              {view.outcome.added > 0 && (
                <span className="success mono">+{view.outcome.added}</span>
              )}
              {view.outcome.removed > 0 && (
                <span className="error mono">−{view.outcome.removed}</span>
              )}
            </span>
          )}
          {view.outcome.commands > 0 && (
            <span className="chip">
              <TraceIcon name="Terminal" />
              <strong>
                {t("traces:outcome_commands", { count: view.outcome.commands })}
              </strong>
            </span>
          )}
        </div>
      )}
      {view.lanes && (
        <RunTimeline
          lanes={view.lanes}
          selectedOffset={selected?.offsetMs}
          onSeek={seek}
        />
      )}
      <div className="toolbar">
        <Hint label={t("traces:search_scope")}>
          <label className="search">
            <TraceIcon name="Search" />
            <input
              maxLength={500}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("traces:search_placeholder")}
              aria-label={t("traces:search_placeholder")}
            />
          </label>
        </Hint>
        <span className="count">
          {steps.length === view.steps.length
            ? t("traces:steps_count", { count: steps.length })
            : t("traces:steps_filtered", {
                shown: steps.length,
                total: view.steps.length,
              })}
        </span>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label={t("traces:filter")}
              className={`filter-button ${filters.size ? "active" : ""}`}
            >
              <TraceIcon name="Filter" />
              <span className="filter-label">{t("traces:filter")}</span>
              {filters.size > 0 && (
                <span className="filter-number">{filters.size}</span>
              )}
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal container={container}>
            <DropdownMenu.Content className="popup" align="end" sideOffset={4}>
              {categories.map((key) => (
                <DropdownMenu.CheckboxItem
                  className="menu-item"
                  key={key}
                  checked={filters.has(key)}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={(checked) =>
                    setFilters((previous) => {
                      const next = new Set(previous);
                      if (checked) next.add(key);
                      else next.delete(key);
                      return next;
                    })
                  }
                >
                  <span className="check-slot">
                    <DropdownMenu.ItemIndicator>
                      <TraceIcon name="Check" />
                    </DropdownMenu.ItemIndicator>
                  </span>
                  {labelFor(key)}
                </DropdownMenu.CheckboxItem>
              ))}
              {filters.size > 0 && (
                <>
                  <DropdownMenu.Separator className="menu-separator" />
                  <DropdownMenu.Item
                    className="menu-item"
                    onSelect={() => setFilters(new Set())}
                  >
                    {t("traces:clear_filters")}
                  </DropdownMenu.Item>
                </>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <IconButton
              icon="MoreHorizontal"
              label={t("traces:more_actions")}
            />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal container={container}>
            <DropdownMenu.Content className="popup" align="end" sideOffset={4}>
              <DropdownMenu.Item
                className="menu-item"
                onSelect={() => {
                  setNewest(!newest);
                  setAtLiveEnd(true);
                  list.current?.scrollToIndex({ index: 0 });
                }}
              >
                <TraceIcon
                  name={newest ? "ArrowDownNarrowWide" : "ArrowUpNarrowWide"}
                />
                {t(
                  newest
                    ? "traces:sort_chronological"
                    : "traces:sort_newest_first",
                )}
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="menu-separator" />
              <DropdownMenu.Item
                className="menu-item"
                disabled={!steps.length}
                onSelect={() => void copy()}
              >
                <TraceIcon name="Copy" />
                {t(
                  search || filters.size
                    ? "traces:copy_filtered"
                    : "traces:copy_all",
                )}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      {copyState && (
        <p className="copy-feedback" role="status">
          {t(`traces:${copyState}`)}
        </p>
      )}
      {search.trim() && searchResult.isFetching && (
        <p className="copy-feedback" role="status">
          {t("traces:loading")}
        </p>
      )}
      {searchResult.isError && (
        <p className="trace-health" role="alert">
          {t("traces:load_error")}
        </p>
      )}
      <div className={`body ${selected ? "has-inspector" : ""}`}>
        <div className="list">
          {rows.length ? (
            <Virtuoso
              ref={list}
              style={{ height: "100%", flex: 1 }}
              data={rows}
              computeItemKey={(_, row) => row.stepId}
              increaseViewportBy={300}
              followOutput={(atBottom) =>
                !newest && atBottom ? "auto" : false
              }
              atBottomStateChange={(bottom) => {
                if (!newest) setAtLiveEnd(bottom);
              }}
              atTopStateChange={(top) => {
                if (newest) setAtLiveEnd(top);
              }}
              itemsRendered={() => {
                if (newest && atLiveEnd)
                  list.current?.scrollToIndex({ index: 0, behavior: "auto" });
              }}
              itemContent={(_, row) => (
                <TranscriptRow
                  row={row}
                  selectedId={selectedId}
                  onSelect={choose}
                />
              )}
            />
          ) : (
            <p className="empty">
              {t(
                search || filters.size
                  ? "traces:no_matches"
                  : view.summary.runStatus === "running"
                    ? "traces:waiting_events"
                    : "traces:no_data",
              )}
            </p>
          )}
        </div>
        {selected && (
          <StepInspector
            key={selected.stepId}
            sessionId={sessionId}
            traceId={view.summary.traceId}
            revision={view.summary.revision}
            step={selected}
            onClose={() => setSelectedId(undefined)}
          />
        )}
      </div>
    </>
  );
}
export function TraceDialog({
  sessionId,
  traceId,
  onClose,
}: {
  sessionId: string;
  traceId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const container = useTracePortal();
  const query = useTraceView(sessionId, traceId);
  const view = query.data;
  const notice =
    query.connection === "error" || query.connection === "reconnecting"
      ? "disconnected"
      : view?.health.persistence === "memory" ||
          view?.health.persistence === "degraded"
        ? "memory"
        : view &&
            (view.summary.captureStatus !== "complete" ||
              view.health.droppedEvents > 0)
          ? "partial"
          : view?.summary.sessionPersistence === "unsaved"
            ? "unsaved"
            : undefined;
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal container={container}>
        <Dialog.Overlay className="backdrop" />
        <Dialog.Content className="dialog" aria-describedby={undefined}>
          <Dialog.Title className="sr-only">
            {t("traces:dialog_title")}
          </Dialog.Title>
          {view ? (
            <RunHeader view={view} onClose={onClose} />
          ) : (
            <header className="header">
              <div className="header-line">
                <span className="agent-name">{t("traces:dialog_title")}</span>
                <span style={{ flex: 1 }} />
                <IconButton
                  icon="X"
                  label={t("traces:close")}
                  onClick={onClose}
                />
              </div>
            </header>
          )}
          {notice && (
            <p className="trace-health" role="status">
              {t(`traces:${notice}`)}
            </p>
          )}
          {query.isError && (
            <p className="trace-health" role="alert">
              {t("traces:load_error")}
              <button type="button" onClick={() => void query.refetch()}>
                {t("traces:retry")}
              </button>
            </p>
          )}
          {view ? (
            <Transcript sessionId={sessionId} view={view} />
          ) : (
            <div className="empty dialog-empty">
              {t(query.isPending ? "traces:loading" : "traces:no_data")}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
