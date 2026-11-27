import { Check, Hand, LoaderCircle, ShieldAlert, ShieldCheck } from "lucide-react";
import { DropdownMenu as MenuPrimitive } from "radix-ui";
import { InputGroupButton } from "@/components/ui/input-group";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel,
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
  const label = mode ? t(`settings:permissions.${mode}.short`) : t("settings:permissions.label");
  const Icon = options.find(option => option.value === mode)?.Icon ?? ShieldCheck;
  const title = saving ? t("settings:permissions.saving") : busy ? t("settings:permissions.busy")
    : disabled ? t("settings:permissions.unavailable") : t("settings:permissions.change", { mode: label });

  return <DropdownMenu>
    <DropdownMenuTrigger asChild disabled={disabled}>
      <InputGroupButton size="sm" disabled={disabled} aria-label={title} title={title} aria-busy={saving}
        className={cn(
          "h-7.5 min-w-0 max-w-full shrink gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground hover:text-foreground",
          mode === "full" && "border border-border bg-muted/75 font-medium text-foreground hover:bg-muted",
        )}>
        {saving ? <LoaderCircle className="size-icon motion-safe:animate-spin" aria-hidden="true" /> : <Icon className={cn("size-icon", mode === "full" && "text-status-warning")} aria-hidden="true" />}
        <span className="truncate">{saving ? t("settings:permissions.saving") : label}</span>
      </InputGroupButton>
    </DropdownMenuTrigger>
    <DropdownMenuContent side="top" align="start" sideOffset={8} collisionPadding={12}
      className="w-88 max-w-[calc(100vw-24px)] p-1.5" aria-label={t("settings:permissions.label")}>
      <DropdownMenuLabel className="px-2.5 pb-1 font-medium">{t("settings:permissions.title")}</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={mode} onValueChange={value => {
        if (!disabled && (value === "ask" || value === "auto" || value === "full")) onChange(value);
      }}>
        {options.map(({ value, Icon: OptionIcon }) => <MenuPrimitive.RadioItem key={value} value={value}
          disabled={disabled} textValue={t(`settings:permissions.${value}.name`)}
          className={cn(
            "group relative flex cursor-default items-start gap-2.5 rounded-md py-2 pe-8 ps-2.5 outline-none transition-colors duration-100 ease-out select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-45",
            value === "full" && "text-status-warning focus:bg-status-warning-bg focus:text-status-warning",
          )}>
          <OptionIcon className="mt-0.5 size-icon shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-[0.8125rem] leading-[1.4] font-medium">{t(`settings:permissions.${value}.name`)}</span>
            <span className={cn("mt-0.5 block text-xs leading-[1.4] text-muted-foreground group-focus:text-accent-foreground/85", value === "full" && "text-current/85 group-focus:text-current")}>{t(`settings:permissions.${value}.description`)}</span>
          </span>
          <MenuPrimitive.ItemIndicator className="absolute top-2.5 end-2.5 flex items-center">
            <Check className="size-icon" aria-hidden="true" />
          </MenuPrimitive.ItemIndicator>
        </MenuPrimitive.RadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}
