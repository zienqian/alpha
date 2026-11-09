import { createInstance, type TFunction, type i18n } from "i18next";
import en_chat from "./locales/en/chat.json";
import en_cli from "./locales/en/cli.json";
import en_common from "./locales/en/common.json";
import en_errors from "./locales/en/errors.json";
import en_permissions from "./locales/en/permissions.json";
import en_skills from "./locales/en/skills.json";
import en_tools from "./locales/en/tools.json";
import zh_chat from "./locales/zh-CN/chat.json";
import zh_cli from "./locales/zh-CN/cli.json";
import zh_common from "./locales/zh-CN/common.json";
import zh_errors from "./locales/zh-CN/errors.json";
import zh_permissions from "./locales/zh-CN/permissions.json";
import zh_skills from "./locales/zh-CN/skills.json";
import zh_tools from "./locales/zh-CN/tools.json";

export const namespaces = ["chat", "cli", "common", "errors", "permissions", "skills", "tools"] as const;
export type Translate = TFunction<typeof namespaces>;

export function createI18n(language: "en" | "zh-CN"): i18n {
  const instance = createInstance();
  void instance.init({
    lng: language, supportedLngs: ["en", "zh-CN"], fallbackLng: "en", load: "currentOnly",
    defaultNS: "common", ns: ["chat","cli","common","errors","permissions","skills","tools"],
    resources: { en: { chat: en_chat, cli: en_cli, common: en_common, errors: en_errors, permissions: en_permissions, skills: en_skills, tools: en_tools }, "zh-CN": { chat: zh_chat, cli: zh_cli, common: zh_common, errors: zh_errors, permissions: zh_permissions, skills: zh_skills, tools: zh_tools } },
    initAsync: false, returnEmptyString: false, returnNull: false,
    interpolation: { escapeValue: false }, react: { useSuspense: false },
  });
  return instance;
}
