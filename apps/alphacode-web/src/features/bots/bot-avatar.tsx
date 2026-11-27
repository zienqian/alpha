import { useTranslation } from "@/i18n/react";
import { cn } from "@/lib/utils";
import type { BotAppearance, BotColorId, BotShapeId, BotStatusKind } from "./api";

const colorTokens: Record<BotColorId, { bg: string; fg: string; border: string }> = {
  blue: { bg: "bg-blue-500/12 dark:bg-blue-400/16", fg: "text-blue-600 dark:text-blue-400", border: "border-blue-500/20" },
  emerald: { bg: "bg-emerald-500/12 dark:bg-emerald-400/16", fg: "text-emerald-600 dark:text-emerald-400", border: "border-emerald-500/20" },
  violet: { bg: "bg-violet-500/12 dark:bg-violet-400/16", fg: "text-violet-600 dark:text-violet-400", border: "border-violet-500/20" },
  amber: { bg: "bg-amber-500/14 dark:bg-amber-400/16", fg: "text-amber-600 dark:text-amber-400", border: "border-amber-500/22" },
  rose: { bg: "bg-rose-500/12 dark:bg-rose-400/16", fg: "text-rose-600 dark:text-rose-400", border: "border-rose-500/20" },
  cyan: { bg: "bg-cyan-500/12 dark:bg-cyan-400/16", fg: "text-cyan-600 dark:text-cyan-400", border: "border-cyan-500/20" },
  indigo: { bg: "bg-indigo-500/12 dark:bg-indigo-400/16", fg: "text-indigo-600 dark:text-indigo-400", border: "border-indigo-500/20" },
  teal: { bg: "bg-teal-500/12 dark:bg-teal-400/16", fg: "text-teal-600 dark:text-teal-400", border: "border-teal-500/20" },
  orange: { bg: "bg-orange-500/12 dark:bg-orange-400/16", fg: "text-orange-600 dark:text-orange-400", border: "border-orange-500/20" },
  pink: { bg: "bg-pink-500/12 dark:bg-pink-400/16", fg: "text-pink-600 dark:text-pink-400", border: "border-pink-500/20" },
  slate: { bg: "bg-slate-500/12 dark:bg-slate-400/16", fg: "text-slate-600 dark:text-slate-300", border: "border-slate-500/20" },
  neutral: { bg: "bg-foreground/8 dark:bg-foreground/12", fg: "text-foreground", border: "border-border" },
};

export const botSwatchClasses: Record<BotColorId, string> = {
  blue: "bg-blue-500",
  emerald: "bg-emerald-500",
  violet: "bg-violet-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  cyan: "bg-cyan-500",
  indigo: "bg-indigo-500",
  teal: "bg-teal-500",
  orange: "bg-orange-500",
  pink: "bg-pink-500",
  slate: "bg-slate-500",
  neutral: "bg-neutral-500",
};

export function BotShapeGlyph({ shape, className }: { shape: BotShapeId; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.85} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      {shape === "orbit" && <>
        <circle cx="12" cy="12" r="3.2" />
        <ellipse cx="12" cy="12" rx="9" ry="4.2" transform="rotate(-28 12 12)" />
      </>}
      {shape === "hex" && <polygon points="12 3 19.5 7.5 19.5 16.5 12 21 4.5 16.5 4.5 7.5" />}
      {shape === "diamond" && <polygon points="12 3.2 20.8 12 12 20.8 3.2 12" />}
      {shape === "cube" && <>
        <path d="M12 3.5 19.5 7.75v8.5L12 20.5l-7.5-4.25v-8.5L12 3.5Z" />
        <path d="M12 12v8.5M12 12 19.5 7.75M12 12 4.5 7.75" />
      </>}
      {shape === "rings" && <>
        <circle cx="9.5" cy="12" r="5" />
        <circle cx="14.5" cy="12" r="5" />
      </>}
      {shape === "spark" && <path d="M12 3.2 14.3 9.7 20.8 12 14.3 14.3 12 20.8 9.7 14.3 3.2 12 9.7 9.7 12 3.2Z" />}
      {shape === "capsule" && <>
        <rect x="4" y="7.5" width="16" height="9" rx="4.5" />
        <line x1="12" y1="7.5" x2="12" y2="16.5" />
      </>}
      {shape === "prism" && <>
        <polygon points="12 3.5 20.5 18.5 3.5 18.5" />
        <line x1="12" y1="3.5" x2="12" y2="18.5" />
      </>}
    </svg>
  );
}

const statusDotClass: Record<BotStatusKind, string | null> = {
  approval: "bg-amber-500 ring-2 ring-background motion-safe:animate-pulse",
  working: "bg-blue-500 ring-2 ring-background motion-safe:animate-pulse",
  waiting: "bg-amber-400 ring-2 ring-background",
  attention_error: "bg-status-danger ring-2 ring-background",
  done: "bg-status-success ring-2 ring-background",
  idle: null,
};

export function BotAvatar({
  appearance,
  status,
  size = "sm",
  className,
}: {
  appearance: BotAppearance;
  status?: BotStatusKind;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  const palette = colorTokens[appearance.color] ?? colorTokens.neutral;
  const dot = status ? statusDotClass[status] : null;
  const boxSize = size === "xs" ? "size-5 rounded-md" : size === "sm" ? "size-6 rounded-lg" : size === "md" ? "size-8 rounded-xl" : "size-11 rounded-2xl";
  const iconSize = size === "xs" ? "size-3" : size === "sm" ? "size-3.5" : size === "md" ? "size-4.5" : "size-6";
  const dotSize = size === "xs" ? "size-1.5 -end-0.5 -bottom-0.5" : size === "sm" ? "size-2 -end-0.5 -bottom-0.5" : "size-2.5 -end-0.5 -bottom-0.5";

  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center border", boxSize, palette.bg, palette.fg, palette.border, className)}>
      <BotShapeGlyph shape={appearance.shape} className={iconSize} />
      {dot && <span aria-hidden="true" className={cn("absolute rounded-full", dotSize, dot)} />}
    </span>
  );
}

export function BotStatusLabel({ status, className }: { status: BotStatusKind; className?: string }) {
  const { t } = useTranslation();
  const dot = statusDotClass[status] ?? "bg-muted-foreground/40";
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full ring-0!", dot)} />
      <span>{t(`bots:status.${status}`)}</span>
    </span>
  );
}
