import { createInstance } from "i18next";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseGlobalConfig } from "../global-config";
import { ConfigurationError } from "../errors";
import { resolveCliLocale } from "./preferences";
import type { Locale, LanguagePreference } from "./locale";
import en from "./locales/en/cli.json";
import zh from "./locales/zh-CN/cli.json";

// Help and startup errors must work without React, a server or valid model settings.
export function bootstrapTranslator(locale: Locale) {
  const instance = createInstance();
  void instance.init({ lng: locale.language, fallbackLng: "en", initAsync: false, defaultNS: "cli",
    resources: { en: { cli: en }, "zh-CN": { cli: zh } }, interpolation: { escapeValue: false } });
  return instance.getFixedT(locale.language, "cli");
}
export async function startupLocale(env: Record<string, string | undefined>, args: readonly string[]) {
  let preference: LanguagePreference | undefined;
  const directory = env.ALPHACODE_HOME?.trim() || join(homedir(), ".alphacode");
  const expanded = directory === "~" ? homedir() : /^~[/\\]/.test(directory) ? join(homedir(), directory.slice(2)) : directory;
  try {
    const file = resolve(expanded, "config.yaml");
    const handle = await open(file, "r");
    try {
      const stat = await handle.stat();
      if (stat.isFile() && stat.size <= 64 * 1024) {
        const buffer = Buffer.alloc(64 * 1024 + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead <= 64 * 1024) preference = parseGlobalConfig(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead)), file).language;
      }
    } finally { await handle.close(); }
  } catch { /* A broken config must not prevent help or error presentation. */ }
  return resolveCliLocale(env, args, preference);
}
export function configurationMessage(t: ReturnType<typeof bootstrapTranslator>, error: ConfigurationError) {
  const file = String(error.params?.file ?? ""), field = String(error.params?.field ?? "");
  switch (error.code) {
    case "CLI_USAGE": return t("usage");
    case "INVALID_LANGUAGE": return t("invalidLanguage", { source: error.params?.source ?? "language" });
    case "MODEL_REQUIRED": return t("modelRequired", { file });
    case "INVALID_AUTH": return t("auth");
    case "INVALID_PERMISSION": return t("permission");
    case "INVALID_CONFIG": return t("invalidConfig", { file, field });
    case "INVALID_YAML": return t("invalidYaml", { file });
    case "CONFIG_NOT_FILE": return t("notFile", { file });
    case "CONFIG_TOO_LARGE": return t("tooLarge", { file, limit: error.params?.limit ?? 0 });
    case "CONFIG_READ_FAILED": return t("readFailed", { file });
    case "CONFIG_INIT_FAILED": return t("initFailed", { file });
    case "SERVER_INCOMPATIBLE": return t("incompatible");
    case "SERVER_START_FAILED": return t("serverStart");
    case "SERVER_START_TIMEOUT": return t("serverTimeout", { file });
    default: return error.message;
  }
}
