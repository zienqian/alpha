#!/usr/bin/env bun
import { fileURLToPath } from "node:url";
import { version } from "../package.json";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`AlphaCode ${version} (local source)

Usage: alphacode [--watch] [workspace path]

  alphacode              Run the latest source in the current directory
  alphacode C:/project   Use the specified workspace
  alphacode --watch      Restart when source files change
  alphacode --version    Show the version

The local server starts automatically and is shared by clients using the same database.
Type /web inside the terminal to open the current session in your browser.

Global configuration: ~/.alphacode/config.yaml
Global instructions: ~/.alphacode/AGENTS.md
Set ALPHACODE_HOME to use a different configuration directory.
Environment variables override global configuration; the development launcher also loads the repository's .env.local.`);
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
