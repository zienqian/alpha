import { useTranslation } from "@/i18n/react";
import { useEffect, useState, type ReactNode } from "react";
import type { ModelActivity } from "@/features/sessions/api";
import { Workflow, type LucideIcon } from "lucide-react";
import { MorphingSpinner } from "@/components/ui/morphing-spinner";
import {
  Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger,
  TraceDescription, TraceIcon, TraceLine, TraceTitle, type TraceStatus,
} from "@/components/ui/trace";

// https://ui.shadcn.com/docs/ai-elements/radix/chain-of-thought
// Follow the live activity until the user explicitly chooses an open state.
export function ChainOfThought({ label, description, running = false, status, icon: Icon = Workflow, indicator, children }: {
  label: string;
  description?: string;
  running?: boolean;
  status?: TraceStatus;
  icon?: LucideIcon;
  indicator?: ReactNode;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState<boolean>();
  const line = <TraceLine status={status ?? (running ? "running" : undefined)}>
    {indicator ?? <TraceIcon><Icon /></TraceIcon>}
    <TraceTitle className="shrink-0">{label}</TraceTitle>
    {description && <TraceDescription className="min-w-0 shrink truncate" title={description}>{description}</TraceDescription>}
  </TraceLine>;
  return <Trace>
    {children ? <TraceCollapsible open={open ?? running} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent><Trace>{children}</Trace></TraceCollapsibleContent>
    </TraceCollapsible> : <div role="status" aria-live="polite" className="flex min-h-8 items-center">{line}</div>}
  </Trace>;
}

export function ReplyProgress({ hasContent = false, phase, connected = true, activity }: {
  hasContent?: boolean;
  phase?: string;
  connected?: boolean;
  activity?: ModelActivity;
}) {
  const { t, i18n } = useTranslation();
  const [now, setNow] = useState(Date.now);
  const active = connected && phase !== "stopping" && phase !== "saving";
  const activityId = active ? activity?.id : undefined;
  useEffect(() => {
    if (!activityId) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activityId]);
  const quietSeconds = activity ? Math.max(0, Math.floor((now - activity.updatedAt) / 1000)) : 0;
  const fileInput = activity?.kind === "tool-input" && ["create_file", "edit_file"].includes(activity.toolName ?? "");
  const label = !connected ? t("sessions:awaitConnection") : phase === "stopping" ? t("sessions:stoppingShort")
    : phase === "saving" ? t("sessions:saving") : activity?.kind === "tool-input"
      ? fileInput ? t("sessions:generatingFile") : t("sessions:generatingTool")
    : activity?.kind === "reasoning" ? t("sessions:thinking")
    : activity?.kind === "waiting" ? t("sessions:waitingModel") : hasContent ? t("sessions:replying") : t("sessions:thinking");
  const amount = activity?.kind === "tool-input" && activity.bytes > 0
    ? t("sessions:generatedSize", { size: new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(activity.bytes / 1024) }) : undefined;
  const detail = active && activity ? [
    activity.kind === "tool-input" && !fileInput ? activity.toolName : undefined,
    amount,
    t("sessions:elapsedSeconds", { seconds: Math.max(0, Math.floor((now - activity.startedAt) / 1000)) }),
  ].filter(Boolean).join(" · ") : undefined;
  return <div className="min-w-0">
    <ChainOfThought label={label} running={connected} indicator={<MorphingSpinner active={connected} />} />
    {detail && <p className="mt-1 break-words text-xs leading-5 text-muted-foreground" aria-live="off">{detail}</p>}
    {active && activity && quietSeconds >= 30 && <p className="mt-1 text-xs leading-5 text-muted-foreground">
      {t("sessions:modelQuiet", { seconds: quietSeconds })}
    </p>}
  </div>;
}
