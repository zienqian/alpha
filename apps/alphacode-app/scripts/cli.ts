import spawn from "cross-spawn";
import { join, resolve } from "node:path";
import { findInstalledCli, withBundledCommands } from "../src/cli-command";

// Built into runtime/cli/launcher.js; all bundled paths stay relative to the App.
const root = resolve(import.meta.dir, "..");
const installed = await findInstalledCli();
const args = process.argv.slice(2);
const child = installed
  ? spawn(installed, args, { stdio: "inherit", env: process.env })
  : spawn(process.execPath, ["--no-env-file", `--config=${join(root, "bunfig.toml")}`,
    "--conditions=alpha-source", join(root, "apps/alphacode/dist/index.js"), ...args],
  { stdio: "inherit", env: withBundledCommands(root, process.env) });

// Ctrl+C reaches the terminal child too; let it cancel/save before exiting.
const interrupt = () => { /* The CLI owns terminal interruption. */ };
const terminate = () => { child.kill("SIGTERM"); };
process.on("SIGINT", interrupt);
process.on("SIGTERM", terminate);
try {
  process.exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(code ?? (signal === "SIGINT" ? 130 : 1)));
  });
} finally {
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", terminate);
}
