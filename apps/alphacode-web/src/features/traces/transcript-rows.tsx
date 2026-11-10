/* Adapted from Multica's pinned agent-transcript-dialog.tsx. See vendor notice. */
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { TraceViewStep } from "@alpha/adk-trace/contracts";
import { useTranslation } from "@/i18n/react";
import { TraceIcon } from "./icons";
import { Hint } from "./primitives";
import { offsetLabel, stepDuration, stepIcon, type TraceRow } from "./format";

export function StepDuration({ step }: { step: TraceViewStep }) {
  const { t } = useTranslation();
  return step.status === "running" ? (
    <span className="duration pending">{t("traces:step_running")}</span>
  ) : (
    <Hint
      label={
        step.durationMs === null
          ? t("traces:step_duration_unknown")
          : stepDuration(step.durationMs)
      }
    >
      <span className="duration">{stepDuration(step.durationMs) || "—"}</span>
    </Hint>
  );
}
export function TranscriptRow({
  row,
  selectedId,
  onSelect,
}: {
  row: TraceRow;
  selectedId?: string;
  onSelect: (step: TraceViewStep) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const containsSelection =
    row.kind === "group" &&
    row.steps.some((step) => step.stepId === selectedId);
  useEffect(() => {
    if (containsSelection) setExpanded(true);
  }, [containsSelection, selectedId]);
  if (row.kind === "group")
    return (
      <div
        className={`row-wrap ${row.steps.some((s) => s.stepId === selectedId) ? "group-selected" : ""}`}
      >
        <button
          type="button"
          className="step-row"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <span className="offset">{offsetLabel(row.offsetMs)}</span>
          <span className="marker" />
          <TraceIcon name={stepIcon(row.steps[0]!)} className="row-icon" />
          <span className="row-main">
            <span className="label">{row.label}</span>
            <span className="group-count">
              {t("traces:group_calls", { count: row.steps.length })}
            </span>
            <TraceIcon name="ChevronRight" className="chevron" />
          </span>
          <span className="duration">
            {stepDuration(row.durationMs) || "—"}
          </span>
        </button>
        {expanded && (
          <div className="group-children">
            {row.steps.map((step) => (
              <button
                key={step.stepId}
                type="button"
                className={`group-child ${step.stepId === selectedId ? "selected" : ""}`}
                onClick={() => onSelect(step)}
              >
                <span className="summary mono">
                  {step.summary || step.label}
                </span>
                <StepDuration step={step} />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  if (row.kind === "text")
    return (
      <div className="row-wrap">
        <div className="prose-row">
          <span className="offset">{offsetLabel(row.offsetMs)}</span>
          <span className="marker" />
          <div className="prose">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
                img: () => null,
              }}
            >
              {row.content ?? row.summary}
            </ReactMarkdown>
            {row.detailState==='truncated'&&<button type="button" className="muted" onClick={()=>onSelect(row)}>{t('traces:display_clipped')}</button>}
          </div>
        </div>
      </div>
    );
  return (
    <div className="row-wrap">
      <button
        type="button"
        aria-pressed={row.stepId === selectedId}
        className={`step-row ${row.stepId === selectedId ? "selected" : ""} ${row.status === "error" || row.status === "denied" ? "error-row" : ""}`}
        onClick={() => onSelect(row)}
      >
        <span className="offset">{offsetLabel(row.offsetMs)}</span>
        <span className="marker" />
        <TraceIcon name={stepIcon(row)} className="row-icon" />
        <span className="row-main">
          <span className="label">
            {row.kind === "model"
              ? t("traces:model_request")
              : row.kind === "error"
                ? t("traces:kind_error")
                : row.label}
          </span>
          <span className="summary mono">{row.summary}</span>
        </span>
        <StepDuration step={row} />
      </button>
    </div>
  );
}
