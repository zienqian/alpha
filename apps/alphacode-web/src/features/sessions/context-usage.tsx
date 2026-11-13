import { useEffect, useId, useRef, useState } from "react";
import { Popover } from "radix-ui";
import { InputGroupButton } from "@/components/ui/input-group";
import type { ContextUsage } from "./api";
import { useTranslation } from "@/i18n/react";
import { cn } from "@/lib/utils";

const categories = [
  { key: "system", color: "bg-muted-foreground/60" },
  { key: "tools", color: "bg-violet-400 dark:bg-violet-400" },
  { key: "summary", color: "bg-amber-500" },
  { key: "messages", color: "bg-primary" },
] as const;

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(2))}M`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`;
  return String(value);
}

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
  return <Popover.Root open={open} onOpenChange={changeOpen}>
    <Popover.Trigger asChild>
      <InputGroupButton ref={trigger} size="sm" className={cn("shrink-0 gap-1.5 rounded-full px-2 font-normal text-muted-foreground tabular-nums",
        open && "bg-muted text-foreground", ratio !== undefined && ratio >= .9 && "text-destructive")}
        aria-label={t("sessions:context.open", { percent })} aria-haspopup="dialog" aria-expanded={open}
        onPointerEnter={event => { if (event.pointerType === "mouse") enter(); }} onPointerLeave={leave}
        onClick={event => { event.preventDefault(); if (open && pinned.current) changeOpen(false); else changeOpen(true); }}>
        <svg viewBox="0 0 20 20" className="size-4" fill="none" aria-hidden="true">
          <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="2" className="opacity-20" />
          <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="2" pathLength="100"
            strokeDasharray={`${progress * 100} 100`} strokeLinecap="round" transform="rotate(-90 10 10)" />
        </svg>
        {percent}
      </InputGroupButton>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content side="top" align="start" sideOffset={10} collisionPadding={12}
        aria-labelledby={headingId}
        onPointerEnter={enter} onPointerLeave={leave}
        onOpenAutoFocus={event => event.preventDefault()}
        onCloseAutoFocus={event => { event.preventDefault(); if (pinned.current) trigger.current?.focus(); }}
        onEscapeKeyDown={() => { pinned.current = false; trigger.current?.focus(); }}
        className="workspace-popover z-50 w-80 max-w-[calc(100vw-24px)] rounded-xl bg-popover p-4 text-popover-foreground outline-none">
        <div className="flex items-baseline justify-between gap-3 text-[13px]">
          <h2 id={headingId} className="font-normal text-muted-foreground">{t("sessions:context.used")} <span className="ml-1 text-foreground tabular-nums">{percent}</span></h2>
          <span className="shrink-0 tabular-nums">{tokens ? `~${formatTokens(tokens.total)}` : "—"} / {limit ? formatTokens(limit) : "—"}</span>
        </div>
        <div className="my-4 flex h-1.5 overflow-hidden rounded-full bg-muted" role={ratio === undefined ? undefined : "progressbar"}
          aria-label={t("sessions:context.used")} aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={ratio === undefined ? undefined : Math.round(progress * 100)} aria-valuetext={percent}>
          {tokens && limit && categories.map(({ key, color }) => <span key={key} className={cn("h-full shrink-0", color)}
            style={{ width: `${(tokens[key] ?? 0) / Math.max(limit, tokens.total) * 100}%` }} />)}
        </div>
        <dl className="space-y-2.5 text-[13px]">
          {categories.map(({ key, color }) => <div key={key} className="flex items-center justify-between gap-4">
            <dt className="flex items-center gap-2.5 text-muted-foreground"><span className={cn("size-2.5 shrink-0 rounded-[2px]", color)} aria-hidden="true" />{t(`sessions:context.${key}`)}</dt>
            <dd className="tabular-nums">{tokens ? `~${formatTokens(tokens[key] ?? 0)}` : "—"}</dd>
          </div>)}
        </dl>
        <p className="mt-4 text-xs text-muted-foreground" role="status">
          {usage?.compaction?.status === 'start' ? t('sessions:context.compacting')
            : usage?.compaction?.status === 'failed' ? t('sessions:context.failed')
            : usage?.automatic === false ? t('sessions:context.manual') : t('sessions:context.estimated')}
        </p>
        {usage?.inputBudget !== undefined && <p className="mt-2 text-xs text-muted-foreground">
          {t('sessions:context.budget', { input: formatTokens(usage.inputBudget), output: formatTokens(usage.maxOutputTokens ?? 0) })}
        </p>}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
