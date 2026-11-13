import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTheme } from "@/components/theme-provider";
import { useLanguage } from "@/i18n/provider";
import { isLanguagePreference } from "@/i18n/locale";
import { useTranslation } from "@/i18n/react";

const selectClass = "h-8 w-32 shrink-0 rounded-md border border-transparent bg-transparent px-2 text-base text-foreground outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 sm:h-7 sm:text-xs";

export function SettingsPage() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { preference, setPreference } = useLanguage();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { searchRef.current?.focus({ preventScroll: true }); }, []);
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = (field: "theme" | "language") => {
    // Search both supported languages so switching language keeps the result and focus.
    const text = ["zh-CN", "en"].flatMap(lng => [
      t("settings:general", { lng }), t("settings:preferences", { lng }), t("settings:system", { lng }),
      ...(field === "theme" ? [t("settings:colorTheme", { lng }), t("settings:appearance", { lng }), t("settings:themeDescription", { lng }), t("settings:light", { lng }), t("settings:dark", { lng })] :
        [t("settings:language", { lng }), t("settings:languageDescription", { lng }), t("settings:chinese", { lng }), t("settings:english", { lng })]),
    ]).join(" ").toLocaleLowerCase();
    return terms.every(term => text.includes(term));
  };
  const showTheme = matches("theme");
  const showLanguage = matches("language");
  const resultCount = Number(showTheme) + Number(showLanguage);

  function clearSearch() {
    setQuery("");
    searchRef.current?.focus();
  }

  return <section id="settings-content" tabIndex={-1} aria-labelledby="settings-title" className="min-h-0 flex-1 overflow-y-auto outline-none">
    <div className="mx-auto w-full max-w-[688px] px-5 py-6 sm:px-6">
      <div role="search" aria-label={t("settings:search")} className="relative mb-6">
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input ref={searchRef} type="search" aria-label={t("settings:search")} placeholder={t("settings:search")} value={query}
          className="h-9 pr-10 pl-8 shadow-none sm:h-8 sm:text-xs [&::-webkit-search-cancel-button]:appearance-none"
          onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); clearSearch(); } }} />
        {query && <Button variant="ghost" size="icon-sm" className="absolute top-1/2 right-0.5 -translate-y-1/2 text-muted-foreground"
          aria-label={t("settings:clearSearch")} title={t("settings:clearSearch")} onClick={clearSearch}><X aria-hidden="true" /></Button>}
      </div>
      <h1 id="settings-title" tabIndex={-1} className="text-lg leading-7 font-semibold tracking-tight outline-none">{t("settings:general")}</h1>
      <p role="status" className="sr-only">{terms.length > 0 ? t("settings:searchResults", { count: resultCount }) : ""}</p>
      {resultCount > 0 ? <section aria-labelledby="settings-preferences" className="mt-5">
        <h2 id="settings-preferences" className="mb-1 text-xs font-medium">{t("settings:preferences")}</h2>
        {showTheme && <div className="flex min-h-14 items-center justify-between gap-3 border-b border-border/60 py-2.5">
          <div className="min-w-0">
            <label htmlFor="settings-theme" className="block text-xs leading-4 font-medium">{t("settings:colorTheme")}</label>
            <p id="settings-theme-description" className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{t("settings:themeDescription")}</p>
          </div>
          <select id="settings-theme" aria-describedby="settings-theme-description" className={selectClass} value={theme}
            onChange={event => { const value = event.target.value; if (value === "light" || value === "dark" || value === "system") setTheme(value); }}>
            <option value="light">{t("settings:light")}</option>
            <option value="dark">{t("settings:dark")}</option>
            <option value="system">{t("settings:system")}</option>
          </select>
        </div>}
        {showLanguage && <div className="flex min-h-14 items-center justify-between gap-3 border-b border-border/60 py-2.5">
          <div className="min-w-0">
            <label htmlFor="settings-language" className="block text-xs leading-4 font-medium">{t("settings:language")}</label>
            <p id="settings-language-description" className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{t("settings:languageDescription")}</p>
          </div>
          <select id="settings-language" aria-describedby="settings-language-description" className={selectClass} value={preference}
            onChange={event => { if (isLanguagePreference(event.target.value)) setPreference(event.target.value); }}>
            <option value="system">{t("settings:system")}</option>
            <option value="zh-CN" lang="zh-CN">{t("settings:chinese")}</option>
            <option value="en" lang="en">{t("settings:english")}</option>
          </select>
        </div>}
      </section> : <div className="mt-5 py-6 text-center">
        <p className="text-xs font-medium">{t("settings:noResults")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("settings:noResultsHint")}</p>
      </div>}
    </div>
  </section>;
}
