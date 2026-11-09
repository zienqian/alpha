import { createContext, useCallback, useContext, useLayoutEffect, useState, type PropsWithChildren } from "react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "./instance";
import { isLanguagePreference, resolveLocale, type LanguagePreference, type Locale } from "./locale";

export const languageStorageKey = "alphacode-language-v1";
const LanguageContext = createContext<({ preference: LanguagePreference; setPreference: (value: LanguagePreference) => void } & Locale) | null>(null);
function readPreference(): LanguagePreference {
  try { const saved = localStorage.getItem(languageStorageKey); return isLanguagePreference(saved) ? saved : "system"; }
  catch { return "system"; }
}
export function LanguageProvider({ children, initialPreference }: PropsWithChildren<{ initialPreference?: LanguagePreference }>) {
  const [preference, update] = useState<LanguagePreference>(() => initialPreference ?? readPreference());
  const [candidates, setCandidates] = useState(() => navigator.languages);
  const locale = resolveLocale(preference, candidates);
  const [instance] = useState(() => createI18n(locale.language));
  // Resources are bundled; changing language never suspends or remounts the session.
  useLayoutEffect(() => {
    if (instance.resolvedLanguage !== locale.language) void instance.changeLanguage(locale.language);
    document.documentElement.lang = locale.language;
    document.documentElement.dir = "ltr";
  }, [instance, locale.language]);
  useLayoutEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === languageStorageKey || event.key === null) update(isLanguagePreference(event.newValue) ? event.newValue : "system");
    };
    const system = () => setCandidates([...navigator.languages]);
    window.addEventListener("storage", sync);
    window.addEventListener("languagechange", system);
    return () => { window.removeEventListener("storage", sync); window.removeEventListener("languagechange", system); };
  }, []);
  const setPreference = useCallback((next: LanguagePreference) => {
    update(next);
    try { localStorage.setItem(languageStorageKey, next); } catch { /* In-memory switching remains available. */ }
  }, []);
  return <LanguageContext.Provider value={{ preference, setPreference, ...locale }}>
    <I18nextProvider i18n={instance}>{children}</I18nextProvider>
  </LanguageContext.Provider>;
}
export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("LanguageProvider is required");
  return value;
}
