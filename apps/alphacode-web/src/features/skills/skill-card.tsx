import { ChevronRight, CircleAlert, Layers, ShieldAlert } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "@/i18n/react";
import { cn } from "@/lib/utils";
import type { InstalledSkill } from "./api";
import { SkillIcon } from "./skill-icon";

export function SkillCard({
  skill,
  selected,
  toggling,
  onSelect,
  onToggle,
}: {
  skill: InstalledSkill;
  selected: boolean;
  toggling: boolean;
  onSelect: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  const canToggle = skill.status === "available"
    || skill.status === "shadowed"
    || (skill.status === "disabled" && Boolean(skill.disabledByName));
  const checked = skill.status !== "disabled";
  const dimmed = skill.status === "disabled" || skill.status === "untrusted" || skill.status === "reserved";

  const statusTone = skill.status === "untrusted"
    ? "text-amber-600 dark:text-amber-400"
    : skill.status === "reserved"
      ? "text-destructive"
      : "text-muted-foreground";

  const StatusIcon = skill.status === "untrusted"
    ? ShieldAlert
    : skill.status === "shadowed"
      ? Layers
      : CircleAlert;

  return (
    <li className="min-w-0">
      <div
        className={cn(
          "group relative flex min-h-[82px] items-center gap-3 rounded-2xl border bg-card p-3 transition-[background-color,border-color,box-shadow] motion-reduce:transition-none dark:bg-card/70",
          selected
            ? "border-primary/50 bg-primary/[0.04] ring-1 ring-primary/15 dark:bg-primary/[0.08]"
            : "border-border/75 shadow-xs hover:border-border hover:bg-muted/35 dark:shadow-none dark:hover:bg-muted/30",
        )}
      >
        <button
          type="button"
          onClick={onSelect}
          aria-label={t("skills:market.openDetails", { name: skill.name })}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <SkillIcon name={skill.name} className={cn(dimmed && "opacity-65")} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className={cn("truncate text-[13px] leading-5 font-medium", dimmed && "text-muted-foreground")} title={skill.name}>
                {skill.name}
              </span>
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-3 font-medium text-muted-foreground">
                {t(`skills:market.scope.${skill.source}`)}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs leading-5 text-muted-foreground">{skill.description}</p>
            {skill.status !== "available" && (
              <p className={cn("mt-1 flex items-center gap-1 text-[11px] leading-4", statusTone)}>
                <StatusIcon className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{t(`skills:market.status.${skill.status}`)}</span>
              </p>
            )}
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-1.5 pl-1">
          {canToggle && (
            <Switch
              size="sm"
              checked={checked}
              disabled={toggling}
              aria-label={t("skills:market.toggleSkill", { name: skill.name })}
              onCheckedChange={onToggle}
            />
          )}
          <ChevronRight
            className="pointer-events-none size-4 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground motion-reduce:transition-none"
            aria-hidden="true"
          />
        </div>
      </div>
    </li>
  );
}
