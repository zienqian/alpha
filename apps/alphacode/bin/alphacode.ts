#!/usr/bin/env bun
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const informational = args.some(arg => ["--help", "-h", "--version", "-v"].includes(arg));
const watch = args.includes("--watch") && !informational;
// Set source resolution before importing shared packages, including help.
// Linked development commands must also work before any dist files exist.
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
