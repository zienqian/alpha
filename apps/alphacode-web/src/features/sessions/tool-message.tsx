import { useTranslation } from "@/i18n/react";
import type { Translate } from "@/i18n/instance";
import { presentNote, presentStatus, presentToolDescription, presentToolOutput, presentToolError } from "@/i18n/presentation";
import { ChevronRight, CircleAlert, CircleCheck, Clock3, ShieldQuestion, Terminal } from "lucide-react";
import { ChainOfThought } from "@/components/ai-elements/chain-of-thought";
import { MorphingSpinner } from "@/components/ui/morphing-spinner";
import { TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import type { SessionMessage } from "@/features/sessions/types";
import { hasActiveTools } from "@/features/sessions/domain/history";

function activityStatus(t: Translate, messages: SessionMessage[]) {
  const statuses = messages.map((message) => message.tool?.status);
  const counts = [
    ["awaiting_approval", "tools:counts.awaiting_approval"], ["running", "tools:counts.running"], ["queued", "tools:counts.queued"],
    ["failed", "tools:counts.failed"], ["denied", "tools:counts.denied"], ["outcome_unknown", "tools:counts.outcome_unknown"], ["not_executed", "tools:counts.not_executed"],
  ] as const;
  const summaries = counts.flatMap(([status, label]) => {
    const count = statuses.filter((value) => value === status).length;
    return count ? [t(label, { count })] : [];
  });
  return summaries.join(" · ") || (statuses.every((status) => status === "succeeded") ? t("tools:status.succeeded") : t("tools:details"));
}

export function ToolActivity({ messages, active = false }: { messages: SessionMessage[]; active?: boolean }) {
  const { t } = useTranslation();
  const running = active && hasActiveTools(messages);
  const executing = active && messages.some((message) => message.tool?.status === "running");
  const failed = messages.some((message) => message.tool?.status === "failed" || message.tool?.status === "outcome_unknown");
  return (
    <ChainOfThought label={t("tools:steps", { count: messages.length })} description={activityStatus(t, messages)} running={running}
      status={running ? "running" : failed ? "error" : undefined} indicator={executing ? <MorphingSpinner /> : undefined}>
      <ul aria-label={t("tools:records")} className="space-y-0.5">
        {messages.map((message) => <li key={message.id}><ToolMessage message={message} active={active} /></li>)}
      </ul>
    </ChainOfThought>
  );
}

export function ToolMessage({ message, active = false }: { message: SessionMessage; active?: boolean }) {
  const tool = message.tool;
  const { t } = useTranslation();
  const running = active && tool?.status === "running";
  const failed = tool?.status === "failed" || tool?.status === "outcome_unknown";
  const Icon = failed ? CircleAlert : tool?.status === "succeeded" ? CircleCheck
    : tool?.status === "awaiting_approval" ? ShieldQuestion : tool?.status === "queued" ? Clock3 : Terminal;
  const label = (tool ? presentToolDescription(t, tool) : message.content) || t("tools:call");
  return (
    <details className="group/tool min-w-0 text-xs">
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-md px-1 py-1 text-muted-foreground outline-none hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 md:min-h-8 [&::-webkit-details-marker]:hidden">
        <TraceLine className="w-full" status={failed ? "error" : running ? "running" : tool?.status === "queued" ? "pending" : undefined}>
          <TraceIcon className="h-4 w-6">{running ? <MorphingSpinner className="size-full" /> : <Icon />}</TraceIcon>
          <TraceTitle className="flex-1" title={label}>{label}</TraceTitle>
          {tool && <TraceDescription>{presentStatus(t, tool.status)}</TraceDescription>}
        </TraceLine>
        <ChevronRight className="size-3 shrink-0 transition-transform group-open/tool:rotate-90" aria-hidden="true" />
      </summary>
      <div className="my-1 ml-2.5 min-w-0 space-y-2 border-l py-2 pr-1 pl-4">
        {tool && <p className="text-muted-foreground">{tool.name}{tool.exitCode !== undefined ? ` · ${t("tools:exit", { code: tool.exitCode })}` : ""}</p>}
        {(tool?.cwd || tool?.path) && <p className="break-all text-muted-foreground">{[tool.cwd, tool.path].filter(Boolean).join(" · ")}</p>}
        {tool?.command && <pre className="overflow-x-auto rounded bg-muted p-2"><code>{tool.command}</code></pre>}
        {(tool?.output || message.content) && <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono leading-5">{tool ? presentToolOutput(t, tool) || message.content : message.content}</pre>}
        {tool?.error && <p className="whitespace-pre-wrap break-words text-destructive">{presentToolError(t, tool)}</p>}
        {(tool?.truncated || tool?.outputIncomplete || Boolean(tool?.omittedLines)) && <p className="text-muted-foreground">{tool?.omittedLines ? t("tools:omitted", { count: tool.omittedLines }) : t("tools:incomplete")}</p>}
        {message.note && <p className="text-muted-foreground">{presentNote(t, message)}</p>}
      </div>
    </details>
  );
}
