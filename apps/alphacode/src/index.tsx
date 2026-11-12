import { ConfigurationError, loadConfig } from "./config";
import { errorCode } from "@alpha/alphacode-app-server/errors";
import { bootstrapTranslator, configurationMessage, startupLocale } from "./i18n/bootstrap";
import { resolveLocale } from "./i18n/locale";
import { resolveCliLocale } from "./i18n/preferences";
import { version } from "../package.json";

let locale = resolveLocale("system", [process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale]);
try {
  locale = await startupLocale(process.env, process.argv.slice(2));
  if (process.argv.slice(2).some(arg => arg === "--help" || arg === "-h")) {
    console.log(bootstrapTranslator(locale)("help", { version }));
  } else if (process.argv.slice(2).some(arg => arg === "--version" || arg === "-v")) {
    console.log(`alphacode ${version}`);
  } else {
    const config = await loadConfig();
    locale = resolveCliLocale(process.env, process.argv.slice(2), config.language);
    const [{ connectApplication }, { runTerminal }] = await Promise.all([import("@alpha/alphacode-app-server/client"), import("./ui/terminal")]);
    const chat = await connectApplication(config);
    try {
      await runTerminal(chat, locale);
    } finally {
      await chat.close();
    }
  }
} catch (error) {
  console.error(`AlphaCode: ${error instanceof ConfigurationError ? configurationMessage(bootstrapTranslator(locale), error) : errorCode(error)}`);
  process.exitCode = 1;
}
