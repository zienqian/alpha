export type LanguagePreference = "system" | "en" | "zh-CN";
export interface Locale { language: "en" | "zh-CN"; formatLocale: string }
export const isLanguagePreference = (value: unknown): value is LanguagePreference =>
  value === "system" || value === "en" || value === "zh-CN";

export function resolveLocale(preference: LanguagePreference, candidates: readonly string[] = []): Locale {
  if (preference !== "system") return { language: preference, formatLocale: preference === "en" ? "en-US" : "zh-CN" };
  for (const raw of candidates) {
    const value = raw.trim().replace(/\..*$/, "").replace(/@.*$/, "").replaceAll("_", "-");
    if (/^(C|POSIX)$/i.test(value)) return { language: "en", formatLocale: "en-US" };
    try {
      const locale = new Intl.Locale(value);
      if (locale.language === "en") return { language: "en", formatLocale: locale.toString() };
      if (locale.language !== "zh" || locale.script === "Hant" ||
        (!locale.script && ["TW", "HK", "MO"].includes(locale.region ?? ""))) continue;
      if (locale.script === "Hans" || !locale.region || ["CN", "SG"].includes(locale.region))
        return { language: "zh-CN", formatLocale: locale.region ? locale.toString() : "zh-CN" };
    } catch { /* Invalid OS/browser hints do not prevent startup. */ }
  }
  return { language: "en", formatLocale: "en-US" };
}
