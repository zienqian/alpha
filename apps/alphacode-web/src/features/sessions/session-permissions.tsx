import { useId, useState } from "react";
import { Check, Hand, LoaderCircle, ShieldAlert, ShieldCheck } from "lucide-react";
import { DropdownMenu as MenuPrimitive } from "radix-ui";
import { InputGroupButton } from "@/components/ui/input-group";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuRadioGroup, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PermissionMode } from "@/features/sessions/api";
import { useTranslation } from "@/i18n/react";
import { cn } from "@/lib/utils";

const options = [
  { value: "ask", Icon: Hand },
  { value: "auto", Icon: ShieldCheck },
  { value: "full", Icon: ShieldAlert },
] as const;

export function SessionPermissions({ mode, onChange, disabled, saving, busy }: {
  mode?: PermissionMode;
  onChange: (mode: PermissionMode) => void;
  disabled: boolean;
  saving: boolean;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const [showHelp, setShowHelp] = useState(false);
  const helpId = useId();
  const label = mode ? t(`settings:permissions.${mode}.short`) : t("settings:permissions.label");
  const Icon = options.find(option => option.value === mode)?.Icon ?? ShieldCheck;
  const title = saving ? t("settings:permissions.saving") : busy ? t("settings:permissions.busy")
    : disabled ? t("settings:permissions.unavailable") : t("settings:permissions.change", { mode: label });

  return <DropdownMenu onOpenChange={open => { if (!open) setShowHelp(false); }}>
    <DropdownMenuTrigger asChild disabled={disabled}>
      <InputGroupButton size="sm" disabled={disabled} aria-label={title} title={title} aria-busy={saving}
        className={cn("shrink-0 gap-1.5 rounded-full px-2 text-muted-foreground", mode === "full" && "bg-muted/60 text-orange-700 hover:text-orange-800 dark:text-orange-400 dark:hover:text-orange-300")}>
        {saving ? <LoaderCircle className="size-icon motion-safe:animate-spin" aria-hidden="true" /> : <Icon className="size-icon" aria-hidden="true" />}
        <span className="truncate">{saving ? t("settings:permissions.saving") : label}</span>
      </InputGroupButton>
    </DropdownMenuTrigger>
    <DropdownMenuContent side="top" align="start" sideOffset={8} collisionPadding={12}
      className="w-88 max-w-[calc(100vw-24px)] p-1.5" aria-label={t("settings:permissions.label")}>
      <div className="flex items-center justify-between gap-2 px-1 pb-1">
        <DropdownMenuLabel className="px-1 font-normal">{t("settings:permissions.title")}</DropdownMenuLabel>
        <DropdownMenuItem asChild className="shrink-0 px-1 text-xs text-muted-foreground underline underline-offset-4"
          onSelect={event => { event.preventDefault(); setShowHelp(value => !value); }}>
          <button type="button" aria-expanded={showHelp} aria-controls={helpId}>
            {t(showHelp ? "settings:permissions.less" : "settings:permissions.more")}
          </button>
        </DropdownMenuItem>
      </div>
      <DropdownMenuRadioGroup value={mode} onValueChange={value => {
        if (!disabled && (value === "ask" || value === "auto" || value === "full")) onChange(value);
      }}>
        {options.map(({ value, Icon: OptionIcon }) => <MenuPrimitive.RadioItem key={value} value={value}
          disabled={disabled} textValue={t(`settings:permissions.${value}.name`)}
          className={cn("group relative flex cursor-default items-center gap-2.5 rounded-md px-2 py-2 pr-8 outline-none select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
            value === "full" && "text-orange-700 focus:text-orange-800 dark:text-orange-400 dark:focus:text-orange-300")}>
          <OptionIcon className="size-icon shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-[13px] leading-5">{t(`settings:permissions.${value}.name`)}</span>
            <span className={cn("block text-xs leading-4 text-muted-foreground group-focus:text-accent-foreground", value === "full" && "text-current group-focus:text-current")}>{t(`settings:permissions.${value}.description`)}</span>
          </span>
          <MenuPrimitive.ItemIndicator className="absolute right-2 flex items-center">
            <Check className="size-icon" aria-hidden="true" />
          </MenuPrimitive.ItemIndicator>
        </MenuPrimitive.RadioItem>)}
      </DropdownMenuRadioGroup>
      {showHelp && <p id={helpId} className="px-2 pt-2 pb-1 text-xs leading-5 text-muted-foreground">{t("settings:permissions.help")}</p>}
    </DropdownMenuContent>
  </DropdownMenu>;
}
