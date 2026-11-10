import type { TraceViewStep } from "@alpha/adk-trace/contracts";
import type { TraceIconName } from "./icons";

/** Matches Multica's compact step duration, offset and lane labels. */
export function stepDuration(ms: number | null): string {
  if (ms === null) return "";
  if (ms <= 0) return "—";
  if (ms < 100) return "<0.1s";
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
  return `${Math.floor(ms / 60000)}m ${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}s`;
}
export function offsetLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000)),
    m = Math.floor(s / 60);
  return m < 60
    ? `+${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
    : `+${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
export function laneTotal(ms: number): string {
  const s = Math.round(ms / 1000),
    m = Math.floor(s / 60);
  return s < 60
    ? `${s}s`
    : m < 60
      ? `${m}m ${String(s % 60).padStart(2, "0")}s`
      : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
export function tickLabel(ms: number): string {
  const s = Math.round(ms / 1000),
    m = Math.floor(s / 60);
  return s < 60
    ? `${s}s`
    : m < 60
      ? `${m}m${s % 60 ? ` ${s % 60}s` : ""}`
      : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`;
}
export function stepIcon(step: TraceViewStep): TraceIconName {
  return step.kind === "error"
    ? "CircleAlert"
    : step.kind === "text"
      ? "Bot"
      : step.kind === "model"
        ? "Brain"
        : (
            {
              command: "Terminal",
              write: "FilePen",
              read: "FileText",
              search: "Search",
              other: "Wrench",
            } as const
          )[step.shape];
}
export const filterKey = (step: TraceViewStep) =>
  step.kind === "call" ? `tool:${step.label}` : step.kind;
export type TraceRow =
  | TraceViewStep
  | {
      kind: "group";
      stepId: string;
      label: string;
      offsetMs: number;
      durationMs: number | null;
      steps: TraceViewStep[];
    };
export function groupRows(steps: TraceViewStep[]): TraceRow[] {
  const rows: TraceRow[] = [];
  let run: TraceViewStep[] = [];
  const flush = () => {
    if (run.length < 3) rows.push(...run);
    else {
      const first = run[0]!;
      const duration = run.every(
        (s) => s.durationMs !== null && s.status !== "running",
      )
        ? Math.max(...run.map((s) => s.offsetMs + s.durationMs!)) -
          first.offsetMs
        : null;
      rows.push({
        kind: "group",
        stepId: first.stepId,
        label: first.label,
        offsetMs: first.offsetMs,
        durationMs: duration,
        steps: run,
      });
    }
    run = [];
  };
  for (const step of steps) {
    if (
      step.kind === "call" &&
      step.shape !== "command" &&
      (!run.length || run[0]!.label === step.label)
    ) {
      run.push(step);
      continue;
    }
    flush();
    if (step.kind === "call" && step.shape !== "command") run.push(step);
    else rows.push(step);
  }
  flush();
  return rows;
}
