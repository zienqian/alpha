import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

export const appDirectory = resolve(import.meta.dir, "..");
export const repository = resolve(appDirectory, "../..");

export async function run(args: string[], cwd = repository) {
  const child = Bun.spawn([process.execPath, "--no-env-file", ...args], { cwd, stdin: "inherit", stdout: "inherit", stderr: "inherit", windowsHide: true });
  if (await child.exited) throw new Error(`Command failed: ${args.join(" ")}`);
}

export async function buildDesktop() {
  await mkdir(resolve(appDirectory, "dist"), { recursive: true });
  const result = await Bun.build({ entrypoints: [resolve(appDirectory, "src/main.ts"), resolve(appDirectory, "src/preload.ts")], outdir: resolve(appDirectory, "dist"),
    target: "node", format: "cjs", external: ["electron"], naming: "[name].cjs" });
  if (!result.success) throw new AggregateError(result.logs, "Electron build failed");
}

if (import.meta.main) {
  if (process.argv[2] === "dev") {
    await (await import("./dev")).startDevelopment(process.argv.slice(3));
  } else {
    await run(["run", "build:web"]);
    await buildDesktop();
  }
}
