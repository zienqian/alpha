import { useTranslation } from "@/i18n/react";
import { useState, type ReactNode } from "react";
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

export function ReplyProgress({ hasContent = false, phase, connected = true }: {
  hasContent?: boolean;
  phase?: string;
  connected?: boolean;
}) {
  const { t } = useTranslation();
  const label = !connected ? t("sessions:awaitConnection") : phase === "stopping" ? t("sessions:stoppingShort")
    : phase === "saving" ? t("sessions:saving") : hasContent ? t("sessions:replying") : t("sessions:thinking");
  return <ChainOfThought label={label} running={connected} indicator={<MorphingSpinner active={connected} />} />;
}
