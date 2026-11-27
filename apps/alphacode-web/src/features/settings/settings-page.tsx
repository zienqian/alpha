import { useEffect, useRef, useState } from "react";
import { Check, Globe, LayoutGrid, Monitor, Moon, Search, Sun, SunMoon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { isThemeMode, useTheme, type ThemeMode } from "@/components/theme-provider";
import { useLanguage } from "@/i18n/provider";
import { isLanguagePreference } from "@/i18n/locale";
import { useTranslation } from "@/i18n/react";
import { cn } from "@/lib/utils";
import { useExperimentalFeatures } from "./experimental-features";

const selectClass = "h-8 w-full shrink-0 rounded-lg text-base font-medium text-foreground sm:w-40 md:text-xs";

// Mirrors the calibrated shadcn/ui Neutral AI Elements light and dark workbench palettes.
const previewPalette = {
  light: {
    shell: "#f8f8f8",
    canvas: "#ffffff",
    border: "#e5e5e5",
    primary: "#171717",
    bubble: "#f2f2f2",
    lineStrong: "#a3a3a3",
    lineMuted: "#e5e5e5",
    navActive: "#ebebeb",
  },
  dark: {
    shell: "#0a0a0a",
    canvas: "#101010",
    border: "#262626",
    primary: "#e5e5e5",
    bubble: "#1f1f1f",
    lineStrong: "#525252",
    lineMuted: "#262626",
    navActive: "#222222",
  },
} as const;

function WorkbenchPreview({ variant }: { variant: "light" | "dark" }) {
  const palette = previewPalette[variant];
  return <div aria-hidden="true" className="flex h-full w-full gap-1.5 p-1.5" style={{ backgroundColor: palette.shell }}>
    <div className="flex w-[30%] shrink-0 flex-col gap-1.5 p-1">
      <div className="flex items-center gap-1">
        <span className="size-1.5 rounded-full" style={{ backgroundColor: palette.primary }} />
        <span className="h-1 flex-1 rounded-full" style={{ backgroundColor: palette.lineStrong }} />
      </div>
      <div className="mt-0.5 space-y-1">
        <div className="h-2 rounded-[3px]" style={{ backgroundColor: palette.navActive }} />
        <div className="h-1.5 w-4/5 rounded-[3px]" style={{ backgroundColor: palette.lineMuted }} />
        <div className="h-1.5 w-3/5 rounded-[3px]" style={{ backgroundColor: palette.lineMuted }} />
      </div>
    </div>
    <div className="flex min-w-0 flex-1 flex-col justify-between rounded-[4px] border p-1.5" style={{ backgroundColor: palette.canvas, borderColor: palette.border }}>
      <div className="space-y-1.5">
        <div className="ms-auto h-2 w-3/5 rounded-[3px]" style={{ backgroundColor: palette.bubble }} />
        <div className="space-y-1">
          <div className="h-1.5 w-4/5 rounded-full" style={{ backgroundColor: palette.lineStrong }} />
          <div className="h-1.5 w-3/5 rounded-full" style={{ backgroundColor: palette.lineMuted }} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-1.5 rounded-[4px] border px-1.5 py-1" style={{ borderColor: palette.border }}>
        <span className="h-1 w-1/2 rounded-full" style={{ backgroundColor: palette.lineMuted }} />
        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: palette.primary }} />
      </div>
    </div>
  </div>;
}

function AppearancePreview({ mode }: { mode: ThemeMode }) {
  return <div aria-hidden="true" className="relative h-[76px] w-full overflow-hidden rounded-[8px] border border-border">
    {mode === "system" ? <div className="relative h-full w-full">
      <div className="absolute inset-0" style={{ clipPath: "inset(0 50% 0 0)" }}>
        <WorkbenchPreview variant="light" />
      </div>
      <div className="absolute inset-0" style={{ clipPath: "inset(0 0 0 50%)" }}>
        <WorkbenchPreview variant="dark" />
      </div>
      <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />
    </div> : <WorkbenchPreview variant={mode} />}
  </div>;
}

const themeChoices = [
  { value: "light" as const, Icon: Sun, labelKey: "settings:light" as const },
  { value: "dark" as const, Icon: Moon, labelKey: "settings:dark" as const },
  { value: "system" as const, Icon: Monitor, labelKey: "settings:system" as const },
];

export function SettingsPage() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { preference, setPreference } = useLanguage();
  const experiments = useExperimentalFeatures();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { searchRef.current?.focus({ preventScroll: true }); }, []);
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = (field: "theme" | "language") => {
    // Search both supported languages so switching language keeps the result and focus.
    const text = ["zh-CN", "en"].flatMap(lng => [
      t("settings:general", { lng }), t("settings:preferences", { lng }), t("settings:system", { lng }),
      ...(field === "theme" ? [t("settings:colorTheme", { lng }), t("settings:appearance", { lng }), t("settings:light", { lng }), t("settings:dark", { lng })] :
        [t("settings:language", { lng }), t("settings:chinese", { lng }), t("settings:english", { lng })]),
    ]).join(" ").toLocaleLowerCase();
    return terms.every(term => text.includes(term));
  };
  const showTheme = matches("theme");
  const showLanguage = matches("language");
  const canvasTerms = ["zh-CN", "en"].flatMap(lng => [t("settings:experiments", { lng }), t("settings:sessionCanvas", { lng }), t("settings:sessionCanvasDescription", { lng })]).join(" ").toLocaleLowerCase();
  const showCanvas = terms.every(term => canvasTerms.includes(term));
  const resultCount = Number(showTheme) + Number(showLanguage) + Number(showCanvas);

  function clearSearch() {
    setQuery("");
    searchRef.current?.focus();
  }

  return <section id="settings-content" tabIndex={-1} aria-labelledby="settings-title" className="min-h-0 flex-1 scroll-pt-6 overflow-y-auto outline-none">
    <div className="mx-auto w-full max-w-[740px] px-5 py-7 sm:px-8 sm:py-10">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <h1 id="settings-title" tabIndex={-1} className="text-[1.375rem] leading-[1.28] font-semibold tracking-[-0.022em] text-balance outline-none">{t("settings:general")}</h1>
        </div>
        <div role="search" aria-label={t("settings:search")} className="relative w-full shrink-0 sm:w-56">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 start-2.5 size-icon -translate-y-1/2 text-muted-foreground" />
          <Input ref={searchRef} type="search" aria-label={t("settings:search")} placeholder={t("settings:search")} value={query}
            className="h-9 rounded-lg pe-8 ps-8 sm:h-8 md:text-xs [&::-webkit-search-cancel-button]:appearance-none"
            onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); clearSearch(); } }} />
          {query && <Button variant="ghost" size="icon-xs" className="absolute top-1/2 end-1 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label={t("settings:clearSearch")} title={t("settings:clearSearch")} onClick={clearSearch}><X aria-hidden="true" /></Button>}
        </div>
      </div>

      <p role="status" className="sr-only">{terms.length > 0 ? t("settings:searchResults", { count: resultCount }) : ""}</p>

      {(showTheme || showLanguage) && <section aria-labelledby="settings-preferences" className="mt-8">
        <h2 id="settings-preferences" className="mb-2.5 px-0.5 text-[0.6875rem] font-medium tracking-[0.04em] text-muted-foreground uppercase">{t("settings:preferences")}</h2>
        <div className="divide-y divide-separator overflow-hidden rounded-2xl border border-border bg-card">
          {showTheme && <div className="p-4 sm:p-5">
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <SunMoon />
              </span>
              <span id="settings-theme-label" className="min-w-0 text-[0.8125rem] leading-[1.4] font-medium text-foreground">{t("settings:colorTheme")}</span>
            </div>
            <RadioGroup value={theme} onValueChange={value => { if (isThemeMode(value)) setTheme(value); }}
              aria-labelledby="settings-theme-label"
              className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {themeChoices.map(({ value, Icon, labelKey }) => {
                const selected = theme === value;
                const label = t(labelKey);
                return <label key={value} htmlFor={`settings-theme-${value}`}
                  className={cn(
                    "group relative flex cursor-pointer flex-col rounded-[14px] border p-2 transition-[background-color,border-color,box-shadow] duration-150 ease-out has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring motion-reduce:transition-none",
                    selected
                      ? "border-foreground bg-muted/50 ring-1 ring-foreground/12"
                      : "border-border bg-card hover:border-input hover:bg-muted/40",
                  )}>
                  <RadioGroupItem id={`settings-theme-${value}`} value={value} aria-label={label} className="sr-only" />
                  <AppearancePreview mode={value} />
                  <span className="mt-2 flex items-center justify-between gap-2 px-1 pb-0.5">
                    <span className={cn("flex min-w-0 items-center gap-1.5 text-xs leading-[1.35]", selected ? "font-medium text-foreground" : "text-muted-foreground group-hover:text-foreground")}>
                      <Icon aria-hidden="true" className="size-3.5!" />
                      <span className="truncate">{label}</span>
                    </span>
                    <span aria-hidden="true" className={cn("flex size-4 shrink-0 items-center justify-center rounded-full transition-colors duration-150 ease-out",
                      selected ? "bg-primary text-primary-foreground" : "border border-input bg-background")}>
                      {selected && <Check className="size-2.5!" strokeWidth={2.5} />}
                    </span>
                  </span>
                </label>;
              })}
            </RadioGroup>
          </div>}

          {showLanguage && <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div className="flex min-w-0 items-center gap-3">
              <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Globe />
              </span>
              <label htmlFor="settings-language" className="min-w-0 text-[0.8125rem] leading-[1.4] font-medium text-foreground">{t("settings:language")}</label>
            </div>
            <Select value={preference} onValueChange={value => { if (isLanguagePreference(value)) setPreference(value); }}>
              <SelectTrigger id="settings-language" className={selectClass} size="sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="system">{t("settings:system")}</SelectItem>
                <SelectItem value="zh-CN" lang="zh-CN">{t("settings:chinese")}</SelectItem>
                <SelectItem value="en" lang="en">{t("settings:english")}</SelectItem>
              </SelectContent>
            </Select>
          </div>}
        </div>
      </section>}

      {showCanvas && <section aria-labelledby="settings-experiments" className="mt-8">
        <h2 id="settings-experiments" className="mb-2.5 px-0.5 text-[0.6875rem] font-medium tracking-[0.04em] text-muted-foreground uppercase">{t("settings:experiments")}</h2>
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex items-start justify-between gap-4 p-4 sm:items-center sm:p-5">
            <div className="flex min-w-0 items-start gap-3">
              <span aria-hidden="true" className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-150 ease-out",
                experiments.sessionCanvas ? "bg-foreground text-background" : "bg-muted text-muted-foreground")}>
                <LayoutGrid />
              </span>
              <div className="min-w-0">
                <label htmlFor="settings-session-canvas" className="block text-[0.8125rem] leading-[1.4] font-medium text-foreground">{t("settings:sessionCanvas")}</label>
                <p id="settings-session-canvas-description" className="mt-0.5 max-w-lg text-xs leading-[1.5] text-muted-foreground">{t("settings:sessionCanvasDescription")}</p>
              </div>
            </div>
            <Switch id="settings-session-canvas" className="mt-1 sm:mt-0" checked={experiments.sessionCanvas} onCheckedChange={experiments.setSessionCanvas}
              aria-label={t("settings:sessionCanvas")} aria-describedby="settings-session-canvas-description" />
          </div>
        </div>
      </section>}

      {resultCount === 0 && <Empty className="mt-8 rounded-2xl border border-dashed border-border bg-muted/30 py-12">
        <EmptyHeader>
          <EmptyMedia variant="icon" className="size-10 rounded-xl"><Search aria-hidden="true" /></EmptyMedia>
          <EmptyTitle>{t("settings:noResults")}</EmptyTitle>
        </EmptyHeader>
      </Empty>}
    </div>
  </section>;
}
