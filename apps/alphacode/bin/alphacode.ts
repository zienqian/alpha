#!/usr/bin/env bun
import { fileURLToPath } from "node:url";
import { version } from "../package.json";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`AlphaCode ${version} (local source)

用法：alphacode [--watch] [项目目录]

  alphacode              在当前目录启动最新源码
  alphacode C:/project   指定要操作的项目目录
  alphacode --watch      源码修改后自动重启
  alphacode --version    显示版本

模型配置默认读取 Alpha 仓库的 .env.local；终端环境变量优先。`);
} else if (args.includes("--version") || args.includes("-v")) {
  console.log(`alphacode ${version} (local source)`);
} else {
  const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
  const watch = args.includes("--watch");
  // Absolute configuration paths; never change the caller's working directory.
  const child = Bun.spawn([
    process.execPath,
    "--no-env-file", `--env-file=${path("../../../.env.local")}`,
    // The app config's package preload resolves against cwd; load Solid by absolute path below instead.
    `--config=${path("../../../bunfig.toml")}`,
    `--tsconfig-override=${path("../tsconfig.json")}`,
    "--conditions=alpha-source",
    "--preload", path("../scripts/preload.ts"),
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
