import { createInstance, type TFunction, type i18n } from "i18next";
import en_chat from "./locales/en/chat.json";
import en_common from "./locales/en/common.json";
import en_errors from "./locales/en/errors.json";
import en_sessions from "./locales/en/sessions.json";
import en_settings from "./locales/en/settings.json";
import en_skills from "./locales/en/skills.json";
import en_tools from "./locales/en/tools.json";
import en_traces from "./locales/en/traces.json";
import en_workspace from "./locales/en/workspace.json";
import zh_chat from "./locales/zh-CN/chat.json";
import zh_common from "./locales/zh-CN/common.json";
import zh_errors from "./locales/zh-CN/errors.json";
import zh_sessions from "./locales/zh-CN/sessions.json";
import zh_settings from "./locales/zh-CN/settings.json";
import zh_skills from "./locales/zh-CN/skills.json";
import zh_tools from "./locales/zh-CN/tools.json";
import zh_traces from "./locales/zh-CN/traces.json";
import zh_workspace from "./locales/zh-CN/workspace.json";

export const namespaces = ["chat", "common", "errors", "sessions", "settings", "skills", "tools", "traces", "workspace"] as const;
export type Translate = TFunction<typeof namespaces>;

export function createI18n(language: "en" | "zh-CN"): i18n {
  const instance = createInstance();
  void instance.init({
    lng: language, supportedLngs: ["en", "zh-CN"], fallbackLng: "en", load: "currentOnly",
    defaultNS: "common", ns: [...namespaces],
    resources: { en: { chat: en_chat, common: en_common, errors: en_errors, sessions: en_sessions, settings: en_settings, skills: en_skills, tools: en_tools, traces: en_traces, workspace: en_workspace }, "zh-CN": { chat: zh_chat, common: zh_common, errors: zh_errors, sessions: zh_sessions, settings: zh_settings, skills: zh_skills, tools: zh_tools, traces: zh_traces, workspace: zh_workspace } },
    initAsync: false, returnEmptyString: false, returnNull: false,
    interpolation: { escapeValue: false }, react: { useSuspense: false },
  });
  return instance;
}
