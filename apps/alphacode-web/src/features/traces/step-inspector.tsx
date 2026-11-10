import { useState } from "react";
import type { TraceViewStep } from "@alpha/adk-trace/contracts";
import { useTranslation } from "@/i18n/react";
import { useTraceDetail } from "./api";
import { TraceIcon } from "./icons";
import { IconButton } from "./primitives";
import { offsetLabel, stepDuration, stepIcon } from "./format";
import { DetailSurface, TextSurface } from "./detail-surfaces";
import { traceEventDetail } from "./vendor/trace-event-presenter";

export function StepInspector({
  sessionId,
  traceId,
  revision,
  step,
  onClose,
}: {
  sessionId: string;
  traceId: string;
  revision: number;
  step: TraceViewStep;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const query = useTraceDetail(sessionId, traceId, step.stepId, revision);
  const [copyState, setCopyState] = useState<"copied" | "copy_failed" | null>(
    null,
  );
  const detail = query.data;
  async function copy() {
    if (!detail) return;
    try {
      await navigator.clipboard.writeText(
        [
          step.label,
          detail.input && JSON.stringify(detail.input, null, 2),
          detail.output,
          detail.content,
        ]
          .filter(Boolean)
          .join("\n\n"),
      );
      setCopyState("copied");
    } catch {
      setCopyState("copy_failed");
    }
  }
  return (
    <aside className="inspector" aria-label={t("traces:run_info")}>
      <div className="inspector-head">
        <TraceIcon name={stepIcon(step)} size={16} />
        <h2 className="inspector-title">
          {step.kind === "text"
            ? t("traces:kind_text")
            : step.kind === "model"
              ? t("traces:model_request")
              : step.label}
        </h2>
        <div className="inspector-meta">
          <span className="mono">{offsetLabel(step.offsetMs)}</span>
          {step.durationMs !== null && (
            <>
              <span>·</span>
              <span>{stepDuration(step.durationMs)}</span>
            </>
          )}
        </div>
        <IconButton
          icon={copyState === "copied" ? "Check" : "Copy"}
          label={t("traces:copy_step")}
          disabled={!detail}
          onClick={() => void copy()}
        />
        <IconButton icon="X" label={t("traces:close_step")} onClick={onClose} />
      </div>
      {copyState && (
        <p role="status" className="copy-feedback">
          {t(`traces:${copyState}`)}
        </p>
      )}
      <div className="inspector-content">
        {query.isPending && (
          <p className="empty">{t("traces:detail_loading")}</p>
        )}
        {query.isError && (
          <div className="empty" role="alert">
            {t("traces:detail_error")}
            <button type="button" onClick={() => void query.refetch()}>
              {t("traces:retry")}
            </button>
          </div>
        )}
        {detail &&
          (detail.state === "missing" || detail.state === "not_captured") && (
            <p className="empty">{t(`traces:${detail.state}`)}</p>
          )}
        {detail?.input && (
          <section className="detail-section">
            <h3>{t("traces:step_input")}</h3>
            <div className="detail-body">
              <DetailSurface
                detail={traceEventDetail({
                  type: "tool_use",
                  tool: step.label,
                  input: detail.input,
                })}
              />
            </div>
          </section>
        )}
        {detail?.output !== undefined && (
          <section className="detail-section">
            <h3>{t("traces:step_result")}</h3>
            <div className="detail-body">
              <TextSurface text={detail.output} />
            </div>
          </section>
        )}
        {detail?.content !== undefined && (
          <section className="detail-section">
            <div className="detail-body">
              <TextSurface text={detail.content} />
            </div>
          </section>
        )}
        {detail?.state === "truncated" && (
          <p className="tool-detail-note">
            {t("traces:output_truncated_note")}
          </p>
        )}
      </div>
    </aside>
  );
}
