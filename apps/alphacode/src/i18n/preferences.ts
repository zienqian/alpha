import { ConfigurationError } from "../errors";
import { isLanguagePreference, resolveLocale, type LanguagePreference } from "./locale";

export function parseLanguageArgs(args: readonly string[]) {
  const positional: string[] = [];
  let language: LanguagePreference | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (arg !== "--lang" && !arg.startsWith("--lang=")) { positional.push(arg); continue; }
    const value = arg === "--lang" ? args[++index] : arg.slice(7);
    if (language !== undefined || !isLanguagePreference(value)) throw new ConfigurationError("--lang must be system, en, or zh-CN.", {
      code: "INVALID_LANGUAGE", params: { source: "--lang" },
    });
    language = value;
  }
  return { language, positional };
}

export function resolveCliLocale(env: Record<string, string | undefined>, args: readonly string[], configured?: LanguagePreference) {
  const { language } = parseLanguageArgs(args);
  const preference = language ?? env.ALPHACODE_LANG ?? configured ?? "system";
  if (!isLanguagePreference(preference)) throw new ConfigurationError("ALPHACODE_LANG must be system, en, or zh-CN.", {
    code: "INVALID_LANGUAGE", params: { source: "ALPHACODE_LANG" },
  });
  const system = [env.LC_ALL, env.LC_MESSAGES, env.LANG].find(value => value?.trim());
  return { preference, ...resolveLocale(preference, system ? [system] : [Intl.DateTimeFormat().resolvedOptions().locale]) };
}
