import { Languages } from "lucide-react";
import { useTranslation } from "@/i18n/react";
import { useLanguage } from "@/i18n/provider";
import { isLanguagePreference } from "@/i18n/locale";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
export function LanguageToggle() {
  const { t } = useTranslation();
  const { preference, setPreference } = useLanguage();
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={t("settings:language")} title={t("settings:language")}><Languages aria-hidden="true" /></Button></DropdownMenuTrigger>
    <DropdownMenuContent side="top" align="end">
      <DropdownMenuLabel>{t("settings:language")}</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={preference} onValueChange={value => { if (isLanguagePreference(value)) setPreference(value); }}>
        <DropdownMenuRadioItem value="system">{t("settings:system")}</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="zh-CN" lang="zh-CN">{t("settings:chinese")}</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="en" lang="en">{t("settings:english")}</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}
