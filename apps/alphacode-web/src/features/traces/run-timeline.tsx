/* Multica run-timeline.tsx, pinned 10f0ab3. Adapted to scoped CSS and Alpha DTOs. */
import { useEffect, useMemo, useRef, useState } from "react";
import type { TraceLanes } from "@alpha/adk-trace/contracts";
import { useTranslation } from "@/i18n/react";
import { timelineTicks, laneSegmentPosition } from "./vendor/build-steps";
import { TraceIcon } from "./icons";
import { Hint } from "./primitives";
import { laneTotal, tickLabel } from "./format";

export function RunTimeline({
  lanes,
  selectedOffset,
  onSeek,
}: {
  lanes: TraceLanes;
  selectedOffset?: number;
  onSeek: (ms: number) => void;
}) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState(1);
  const scroller = useRef<HTMLDivElement>(null);
  const ticks = useMemo(
    () => timelineTicks(lanes.totalMs, 6 * zoom),
    [lanes.totalMs, zoom],
  );
  const labels = { model: t("traces:lane_model"), tool: t("traces:lane_tool") };
  function changeZoom(next: number) {
    const el = scroller.current;
    const center = el
      ? (el.scrollLeft + el.clientWidth / 2) / (el.clientWidth * zoom)
      : 0;
    setZoom(next);
    requestAnimationFrame(() => {
      if (el)
        el.scrollLeft = center * el.clientWidth * next - el.clientWidth / 2;
    });
  }
  useEffect(() => {
    const el = scroller.current;
    if (!el || selectedOffset === undefined || zoom === 1) return;
    const x = (selectedOffset / lanes.totalMs) * el.clientWidth * zoom;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth)
      el.scrollLeft = Math.max(0, x - el.clientWidth / 2);
  }, [selectedOffset, lanes.totalMs, zoom]);
  return (
    <div className="timeline">
      <div className="timeline-row">
        <div className="lane-labels">
          <div className="tick-space" />
          <div className="lanes">
            {(["model", "tool"] as const).map((kind) => (
              <div className="lane-label" key={kind}>
                <span>{labels[kind]}</span>
                <span className="total">
                  {laneTotal(kind === "model" ? lanes.modelMs : lanes.toolMs)}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="track-scroll" ref={scroller}>
          <div className="track-inner" style={{ width: `${zoom * 100}%` }}>
            <div className="ticks">
              {ticks.map((tick) => (
                <span
                  className="tick"
                  key={tick}
                  style={{ left: `${(tick / lanes.totalMs) * 100}%` }}
                >
                  {tickLabel(tick)}
                </span>
              ))}
            </div>
            <div className="lanes">
              {(["model", "tool"] as const).map((kind) => (
                <div className="track" key={kind} aria-label={labels[kind]}>
                  {lanes[kind].map((segment, i) => (
                    <Hint
                      key={`${segment.startMs}:${i}`}
                      label={`${labels[kind]} · ${laneTotal(segment.durationMs)}`}
                    >
                      <button
                        type="button"
                        className={`segment ${segment.kind}`}
                        style={laneSegmentPosition(segment, lanes.totalMs)}
                        aria-label={`${labels[kind]} ${laneTotal(segment.durationMs)}`}
                        onClick={() => onSeek(segment.startMs)}
                      />
                    </Hint>
                  ))}
                </div>
              ))}
            </div>
            {selectedOffset !== undefined && (
              <div
                className="playhead"
                aria-hidden
                style={{
                  left: `${Math.min(100, Math.max(0, (selectedOffset / lanes.totalMs) * 100))}%`,
                }}
              />
            )}
          </div>
        </div>
      </div>
      <div className={`zoom ${zoom > 1 ? "engaged" : ""}`}>
        <Hint label={t("traces:timeline_zoom_out")}>
          <button
            type="button"
            disabled={zoom === 1}
            aria-label={t("traces:timeline_zoom_out")}
            onClick={() => changeZoom(zoom / 2)}
          >
            <TraceIcon name="Minus" />
          </button>
        </Hint>
        <span>{zoom}×</span>
        <Hint label={t("traces:timeline_zoom_in")}>
          <button
            type="button"
            disabled={zoom === 8}
            aria-label={t("traces:timeline_zoom_in")}
            onClick={() => changeZoom(zoom * 2)}
          >
            <TraceIcon name="Plus" />
          </button>
        </Hint>
      </div>
    </div>
  );
}
