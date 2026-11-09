import { ChevronRight, CircleAlert, CircleCheck, Clock3, ShieldQuestion, Terminal } from "lucide-react";
import { ChainOfThought } from "@/components/ai-elements/chain-of-thought";
import { MorphingSpinner } from "@/components/ui/morphing-spinner";
import { TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import type { SessionMessage } from "@/features/sessions/types";

const statusLabels: Record<string, string> = {
  queued: "排队中", running: "执行中", awaiting_approval: "等待审批", succeeded: "已完成",
  failed: "失败", denied: "已拒绝", not_executed: "未执行", outcome_unknown: "结果未知",
};

function activityStatus(messages: SessionMessage[]) {
  const statuses = messages.map((message) => message.tool?.status);
  const counts: [string, string][] = [
    ["awaiting_approval", "待审批"], ["running", "执行中"], ["queued", "排队中"],
    ["failed", "失败"], ["denied", "已拒绝"], ["outcome_unknown", "结果未知"], ["not_executed", "未执行"],
  ];
  const summaries = counts.flatMap(([status, label]) => {
    const count = statuses.filter((value) => value === status).length;
    return count ? [`${count} 项${label}`] : [];
  });
  return summaries.join(" · ") || (statuses.every((status) => status === "succeeded") ? "已完成" : "查看详情");
}

export function ToolActivity({ messages, active = false }: { messages: SessionMessage[]; active?: boolean }) {
  const running = active && messages.some((message) => ["running", "queued", "awaiting_approval"].includes(message.tool?.status ?? ""));
  const executing = active && messages.some((message) => message.tool?.status === "running");
  const failed = messages.some((message) => message.tool?.status === "failed" || message.tool?.status === "outcome_unknown");
  return (
    <ChainOfThought label={`执行过程 · ${messages.length} 步`} description={activityStatus(messages)} running={running}
      status={running ? "running" : failed ? "error" : undefined} indicator={executing ? <MorphingSpinner /> : undefined}>
      <ul aria-label="工具执行记录" className="space-y-0.5">
        {messages.map((message) => <li key={message.id}><ToolMessage message={message} active={active} /></li>)}
      </ul>
    </ChainOfThought>
  );
}

export function ToolMessage({ message, active = false }: { message: SessionMessage; active?: boolean }) {
  const tool = message.tool;
  const running = active && tool?.status === "running";
  const failed = tool?.status === "failed" || tool?.status === "outcome_unknown";
  const Icon = failed ? CircleAlert : tool?.status === "succeeded" ? CircleCheck
    : tool?.status === "awaiting_approval" ? ShieldQuestion : tool?.status === "queued" ? Clock3 : Terminal;
  const label = tool?.description || tool?.name || message.content || "工具调用";
  return (
    <details className="group/tool min-w-0 text-xs">
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-md px-1 py-1 text-muted-foreground outline-none hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 md:min-h-8 [&::-webkit-details-marker]:hidden">
        <TraceLine className="w-full" status={failed ? "error" : running ? "running" : tool?.status === "queued" ? "pending" : undefined}>
          <TraceIcon className="h-4 w-6">{running ? <MorphingSpinner className="size-full" /> : <Icon />}</TraceIcon>
          <TraceTitle className="flex-1" title={label}>{label}</TraceTitle>
          {tool && <TraceDescription>{statusLabels[tool.status] ?? tool.status}</TraceDescription>}
        </TraceLine>
        <ChevronRight className="size-3 shrink-0 transition-transform group-open/tool:rotate-90" aria-hidden="true" />
      </summary>
      <div className="my-1 ml-2.5 min-w-0 space-y-2 border-l py-2 pr-1 pl-4">
        {tool && <p className="text-muted-foreground">{tool.name}{tool.exitCode !== undefined ? ` · 退出码 ${tool.exitCode}` : ""}</p>}
        {(tool?.cwd || tool?.path) && <p className="break-all text-muted-foreground">{[tool.cwd, tool.path].filter(Boolean).join(" · ")}</p>}
        {tool?.command && <pre className="overflow-x-auto rounded bg-muted p-2"><code>{tool.command}</code></pre>}
        {(tool?.output || message.content) && <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono leading-5">{tool?.output || message.content}</pre>}
        {tool?.error && <p className="whitespace-pre-wrap break-words text-destructive">{tool.error}</p>}
        {(tool?.truncated || tool?.outputIncomplete || Boolean(tool?.omittedLines)) && <p className="text-muted-foreground">输出不完整{tool?.omittedLines ? `，省略 ${tool.omittedLines} 行` : ""}。</p>}
        {message.note && <p className="text-muted-foreground">{message.note}</p>}
      </div>
    </details>
  );
}
