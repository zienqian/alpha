#!/usr/bin/env bun
import { fileURLToPath } from "node:url";
import { bootstrapTranslator, configurationMessage, startupLocale } from "../src/i18n/bootstrap";
import { ConfigurationError } from "../src/errors";
import { resolveLocale } from "../src/i18n/locale";
import { version } from "../package.json";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  try {
    const locale = await startupLocale(process.env, args);
    console.log(bootstrapTranslator(locale)("help", { version }));
  } catch (error) {
    const locale = resolveLocale("system", [process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale]);
    console.error(`AlphaCode: ${error instanceof ConfigurationError ? configurationMessage(bootstrapTranslator(locale), error) : "UNEXPECTED_ERROR"}`);
    process.exitCode = 1;
  }
} else if (args.includes("--version") || args.includes("-v")) {
  console.log(`alphacode ${version} (local source)`);
} else {
  const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
  const watch = args.includes("--watch");
  // Absolute configuration paths; never change the caller's working directory.
  const child = Bun.spawn([
    process.execPath,
    "--no-env-file", `--env-file=${path("../../../.env.local")}`,
    `--config=${path("../../../bunfig.toml")}`,
    `--tsconfig-override=${path("../tsconfig.json")}`,
    "--conditions=alpha-source",
    ...(watch ? ["--watch"] : []),
    path("../src/index.tsx"), ...args.filter(arg => arg !== "--watch"),
  ], { cwd: process.cwd(), stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  // The terminal delivers Ctrl+C to both processes; the TUI owns that decision.
  const interrupt = () => { /* Let the TUI cancel/save before this launcher exits. */ };
  const terminate = () => { child.kill("SIGTERM"); };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try { process.exitCode = await child.exited; }
  finally { process.off("SIGINT", interrupt); process.off("SIGTERM", terminate); }
}
