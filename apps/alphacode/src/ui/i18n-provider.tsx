import { createContext, createElement, useContext, useState, type PropsWithChildren } from "react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "../i18n/instance";
import type { Locale } from "../i18n/locale";
const LocaleContext = createContext<Locale>({ language: "en", formatLocale: "en-US" });
export function TerminalLanguageProvider({ children, locale }: PropsWithChildren<{ locale: Locale }>) {
  const [instance] = useState(() => createI18n(locale.language));
  return <LocaleContext.Provider value={locale}>{createElement(I18nextProvider, { i18n: instance }, children)}</LocaleContext.Provider>;
}
export const useLocale = () => useContext(LocaleContext);
