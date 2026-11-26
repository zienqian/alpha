import { useEffect, useId, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { InputGroupButton } from "@/components/ui/input-group";
import type { ContextUsage } from "./api";
import { useTranslation } from "@/i18n/react";
import { cn } from "@/lib/utils";

const categories = [
  { key: "system", color: "bg-foreground/30" },
  { key: "tools", color: "bg-foreground/55" },
  { key: "summary", color: "bg-foreground/75" },
  { key: "messages", color: "bg-foreground" },
] as const;

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(2))}M`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`;
  return String(value);
}

// https://ui.shadcn.com/docs/ai-elements/radix/context
export function ContextUsageIndicator({ usage }: { usage?: ContextUsage }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const headingId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const tokens = usage?.tokens;
  const limit = usage?.contextWindow;
  const ratio = tokens && limit ? tokens.total / limit : undefined;
  const percent = ratio === undefined ? "—" : `${Math.round(ratio * 100)}%`;
  const progress = Math.min(1, ratio ?? 0);
  const critical = ratio !== undefined && ratio >= 0.9;
  const enter = () => { clearTimeout(closeTimer.current); setOpen(true); };
  const leave = () => {
    clearTimeout(closeTimer.current);
    if (!pinned.current) closeTimer.current = setTimeout(() => setOpen(false), 180);
  };
  const changeOpen = (value: boolean) => {
    clearTimeout(closeTimer.current);
    pinned.current = value;
    setOpen(value);
  };
  return <Popover open={open} onOpenChange={changeOpen}>
    <PopoverTrigger asChild>
      <InputGroupButton ref={trigger} size="sm" className={cn("h-7.5 shrink-0 gap-1.5 rounded-full px-2.5 text-xs font-normal text-muted-foreground tabular-nums hover:text-foreground",
        open && "bg-accent text-foreground", critical && "bg-status-danger-bg text-status-danger hover:text-status-danger")}
        aria-label={t("sessions:context.open", { percent })} aria-haspopup="dialog" aria-expanded={open}
        onPointerEnter={event => { if (event.pointerType === "mouse") enter(); }} onPointerLeave={leave}
        onClick={event => { event.preventDefault(); if (open && pinned.current) changeOpen(false); else changeOpen(true); }}>
        {critical ? <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" /> : (
          <svg viewBox="0 0 20 20" className="size-4 shrink-0" fill="none" aria-hidden="true">
            <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="2" className="opacity-20" />
            <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="2" pathLength="100"
              strokeDasharray={`${progress * 100} 100`} strokeLinecap="round" transform="rotate(-90 10 10)" />
          </svg>
        )}
        {percent}
      </InputGroupButton>
    </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={10} collisionPadding={12}
        aria-labelledby={headingId}
        onPointerEnter={enter} onPointerLeave={leave}
        onOpenAutoFocus={event => event.preventDefault()}
        onCloseAutoFocus={event => { event.preventDefault(); if (pinned.current) trigger.current?.focus(); }}
        onEscapeKeyDown={() => { pinned.current = false; trigger.current?.focus(); }}
        className="workspace-popover z-50 w-76 max-w-[calc(100vw-24px)] p-4 text-popover-foreground outline-none">
        <div className="flex items-baseline justify-between gap-3 text-[0.8125rem]">
          <h2 id={headingId} className="font-medium text-foreground">{t("sessions:context.used")} <span className="ms-1 font-normal text-muted-foreground tabular-nums">{percent}</span></h2>
          <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{tokens ? `~${formatTokens(tokens.total)}` : "—"} / {limit ? formatTokens(limit) : "—"}</span>
        </div>
        <div className="my-3 flex h-1.5 overflow-hidden rounded-full bg-muted" role={ratio === undefined ? undefined : "progressbar"}
          aria-label={t("sessions:context.used")} aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={ratio === undefined ? undefined : Math.round(progress * 100)} aria-valuetext={percent}>
          {tokens && limit && categories.map(({ key, color }) => <span key={key} className={cn("h-full shrink-0", color)}
            style={{ width: `${(tokens[key] ?? 0) / Math.max(limit, tokens.total) * 100}%` }} />)}
        </div>
        <dl className="space-y-1.5 text-xs">
          {categories.map(({ key, color }) => <div key={key} className="flex items-center justify-between gap-4">
            <dt className="flex items-center gap-2 text-muted-foreground"><span className={cn("size-2 shrink-0 rounded-[2px]", color)} aria-hidden="true" />{t(`sessions:context.${key}`)}</dt>
            <dd className="font-mono text-xs text-foreground tabular-nums">{tokens ? `~${formatTokens(tokens[key] ?? 0)}` : "—"}</dd>
          </div>)}
        </dl>
        <p className="mt-3 border-t border-separator pt-2.5 text-xs leading-[1.45] text-muted-foreground" role="status">
          {usage?.compaction?.status === "start" ? t("sessions:context.compacting")
            : usage?.compaction?.status === "failed" ? t("sessions:context.failed")
            : usage?.automatic === false ? t("sessions:context.manual") : t("sessions:context.estimated")}
        </p>
        {usage?.inputBudget !== undefined && <p className="mt-1 text-xs leading-[1.45] text-muted-foreground tabular-nums">
          {t("sessions:context.budget", { input: formatTokens(usage.inputBudget), output: formatTokens(usage.maxOutputTokens ?? 0) })}
        </p>}
      </PopoverContent>
  </Popover>;
}
