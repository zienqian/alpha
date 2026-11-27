import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Check, Globe, Monitor, Moon, Search, Sun, SunMoon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { isThemeMode, useTheme, type ThemeMode } from "@/components/theme-provider";
import { BotsDefaultsSection } from "@/features/bots/bots-defaults-section";
import { useLanguage } from "@/i18n/provider";
import { isLanguagePreference } from "@/i18n/locale";
import { useTranslation } from "@/i18n/react";
import { cn } from "@/lib/utils";
import { getMemorySettings, memorySettingsQueryKey, updateMemorySettings } from "./memory-api";

const selectClass = "h-8 w-full shrink-0 rounded-lg text-base font-medium text-foreground sm:w-40 md:text-xs";

// Mirrors the frosted glass sidebar + crisp white canvas workbench palettes.
const previewPalette = {
  light: {
    sidebar: "linear-gradient(160deg, #f8f5f0 0%, #f3efe9 55%, #f6f4f0 100%)",
    canvas: "#ffffff",
    border: "#ececec",
    primary: "#171717",
    bubble: "#f6f6f6",
    lineStrong: "#a3a3a3",
    lineMuted: "#e5e5e5",
    navActive: "rgba(0, 0, 0, 0.065)",
  },
  dark: {
    sidebar: "linear-gradient(160deg, #1d1c1b 0%, #141414 100%)",
    canvas: "#171717",
    border: "#262626",
    primary: "#e5e5e5",
    bubble: "#222222",
    lineStrong: "#525252",
    lineMuted: "#262626",
    navActive: "rgba(255, 255, 255, 0.11)",
  },
} as const;

function WorkbenchPreview({ variant }: { variant: "light" | "dark" }) {
  const palette = previewPalette[variant];
  return <div aria-hidden="true" className="flex h-full w-full flex-col" style={{ background: palette.sidebar }}>
    <div className="flex h-2.5 shrink-0 items-center gap-1 px-2">
      <span className="size-1 rounded-full" style={{ backgroundColor: palette.primary }} />
      <span className="h-0.5 w-6 rounded-full" style={{ backgroundColor: palette.lineStrong }} />
    </div>
    <div className="flex min-h-0 flex-1">
      <div className="flex w-[32%] shrink-0 flex-col gap-1 px-2 pb-1.5">
        <div className="h-2 rounded-[3px]" style={{ backgroundColor: palette.navActive }} />
        <div className="h-1.5 w-4/5 rounded-[3px]" style={{ backgroundColor: palette.lineMuted }} />
        <div className="h-1.5 w-3/5 rounded-[3px]" style={{ backgroundColor: palette.lineMuted }} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-between rounded-tl-[5px] border-s border-t p-1.5" style={{ backgroundColor: palette.canvas, borderColor: palette.border }}>
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
  const client = useQueryClient();
  const { theme, setTheme } = useTheme();
  const { preference, setPreference } = useLanguage();
  const [query, setQuery] = useState("");
  const [memorySaving, setMemorySaving] = useState(false);
  const [memoryError, setMemoryError] = useState(false);
  const memoryQuery = useQuery({
    queryKey: memorySettingsQueryKey,
    queryFn: ({ signal }) => getMemorySettings(signal),
    retry: false,
  });
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { searchRef.current?.focus({ preventScroll: true }); }, []);
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = (field: "theme" | "language" | "memory" | "bots") => {
    // Search both supported languages so switching language keeps the result and focus.
    const text = ["zh-CN", "en"].flatMap(lng => [
      t("settings:general", { lng }),
      ...(field === "bots" ? [
        t("bots:defaults.sectionTitle", { lng }), t("bots:defaults.cardTitle", { lng }),
        t("bots:defaults.maxConcurrentWorkers", { lng }), t("bots:defaults.perBotMaxWorkers", { lng }),
        t("bots:defaults.routerModelId", { lng }), t("bots:defaults.workerModelId", { lng }),
      ] : field === "memory" ? [
        t("settings:preferences", { lng }), t("settings:memory.label", { lng }), t("settings:memory.description", { lng }),
      ] : [
        t("settings:preferences", { lng }), t("settings:system", { lng }),
        ...(field === "theme" ? [t("settings:colorTheme", { lng }), t("settings:appearance", { lng }), t("settings:light", { lng }), t("settings:dark", { lng })] :
          [t("settings:language", { lng }), t("settings:chinese", { lng }), t("settings:english", { lng })]),
      ]),
    ]).join(" ").toLocaleLowerCase();
    return terms.every(term => text.includes(term));
  };
  const showTheme = matches("theme");
  const showLanguage = matches("language");
  const showMemory = matches("memory");
  const showBots = matches("bots");
  const resultCount = Number(showTheme) + Number(showLanguage) + Number(showMemory) + Number(showBots);

  async function handleMemoryToggle(enabled: boolean) {
    if (memorySaving) return;
    setMemorySaving(true);
    setMemoryError(false);
    try {
      const updated = await updateMemorySettings({ enabled });
      client.setQueryData(memorySettingsQueryKey, updated);
    } catch {
      setMemoryError(true);
    } finally {
      setMemorySaving(false);
    }
  }

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

      {(showTheme || showLanguage || showMemory) && <section aria-labelledby="settings-preferences" className="mt-8">
        <h2 id="settings-preferences" className="mb-2.5 px-0.5 text-[0.6875rem] font-medium tracking-[0.04em] text-muted-foreground uppercase">{t("settings:preferences")}</h2>
        <div className="divide-y divide-separator overflow-hidden rounded-2xl border border-border bg-card">
          {showTheme && <div className="p-4 sm:p-5">
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-background text-muted-foreground shadow-[0_1px_2px_oklch(0_0_0/0.03)] dark:bg-card">
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
                      ? "border-foreground bg-background ring-1 ring-foreground/10 shadow-xs dark:bg-card"
                      : "border-border bg-background hover:border-input hover:bg-surface-sunken dark:bg-card dark:hover:bg-muted/40",
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
              <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-background text-muted-foreground shadow-[0_1px_2px_oklch(0_0_0/0.03)] dark:bg-card">
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

          {showMemory && <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div className="flex min-w-0 items-start gap-3">
              <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-background text-muted-foreground shadow-[0_1px_2px_oklch(0_0_0/0.03)] dark:bg-card">
                <Brain className="size-4" />
              </span>
              <div className="min-w-0 space-y-0.5">
                <label htmlFor="settings-memory-enabled" className="block text-[0.8125rem] leading-[1.4] font-medium text-foreground">
                  {t("settings:memory.label")}
                </label>
                <p className="text-xs leading-[1.5] text-muted-foreground">
                  {t("settings:memory.description")}
                </p>
                {memoryError && (
                  <p role="alert" className="text-xs text-status-danger">{t("settings:memory.saveFailed")}</p>
                )}
              </div>
            </div>
            <Switch
              id="settings-memory-enabled"
              checked={Boolean(memoryQuery.data?.enabled)}
              disabled={memoryQuery.isPending || memorySaving}
              onCheckedChange={checked => { void handleMemoryToggle(checked); }}
            />
          </div>}
        </div>
      </section>}

      {showBots && <BotsDefaultsSection />}

      {resultCount === 0 && <Empty className="mt-8 rounded-2xl border border-dashed border-border bg-background py-12 dark:bg-card/40">
        <EmptyHeader>
          <EmptyMedia variant="icon" className="size-10 rounded-xl"><Search aria-hidden="true" /></EmptyMedia>
          <EmptyTitle>{t("settings:noResults")}</EmptyTitle>
        </EmptyHeader>
      </Empty>}
    </div>
  </section>;
}
