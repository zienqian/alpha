import { cp, lstat, mkdir, mkdtemp, readFile, readlink, rm, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packager } from "@electron/packager";
import { appDirectory, buildDesktop, repository, run } from "./desktop";

// A native Bun binary is included, so build on the target OS and architecture.
const platform = process.platform;
const arch = process.arch;
if (!["win32", "darwin", "linux"].includes(platform) || !["x64", "arm64"].includes(arch)) throw new Error("Unsupported desktop build target");
await run(["run", "build:web"]);
await buildDesktop();
const dist = join(appDirectory, "dist");
const staging = await mkdtemp(join(dist, "package-"));
try {
  const shell = join(staging, "shell");
  const runtime = join(staging, "runtime");
  await mkdir(shell, { recursive: true });
  await mkdir(join(runtime, "bin"), { recursive: true });
  await writeFile(join(shell, "package.json"), JSON.stringify({ name: "alphacode-app", productName: "AlphaCode", author: "Alpha", version: "0.1.0", main: "main.cjs" }));
  await cp(join(dist, "main.cjs"), join(shell, "main.cjs"));
  await writeFile(join(runtime, "package.json"), JSON.stringify({ name: "alphacode-app-runtime", private: true,
    workspaces: ["apps/alphacode-app-server", "packages/*"] }));
  for (const path of ["apps/alphacode-app-server", ...["adk", "adk-session", "adk-trace", "coding-agent", "provider"].map(name => `packages/${name}`)]) {
    const source = join(repository, path);
    const target = join(runtime, path);
    await mkdir(target, { recursive: true });
    await cp(join(source, "src"), join(target, "src"), { recursive: true });
    const { name, version, type, exports, dependencies, engines } = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
    await writeFile(join(target, "package.json"), JSON.stringify({ name, version, type, exports, dependencies, engines }));
  }
  await cp(join(repository, "bun.lock"), join(runtime, "bun.lock"));
  await cp(join(repository, "bunfig.toml"), join(runtime, "bunfig.toml"));
  await cp(join(repository, "apps/alphacode-web/dist"), join(runtime, "apps/alphacode-web/dist"), { recursive: true });
  await cp(join(repository, "packages/coding-agent/THIRD_PARTY_NOTICES.md"), join(runtime, "packages/coding-agent/THIRD_PARTY_NOTICES.md"));
  await cp(join(appDirectory, "third-party/runtime"), join(runtime, "third-party"), { recursive: true });
  // Keep the lock's resolved versions, removing only unrelated workspace entries.
  await run(["install", "--lockfile-only", "--ignore-scripts"], runtime);
  await run(["install", "--production", "--frozen-lockfile", "--ignore-scripts", "--linker=hoisted"], runtime);
  // Workspace links point into the staging directory. Materialize them before
  // moving the distribution so nothing depends on the build machine's paths.
  for (const name of ["adk", "adk-session", "adk-trace", "coding-agent", "provider", "alphacode-app-server"]) {
    const link = join(runtime, "node_modules/@alpha", name);
    if ((await lstat(link)).isSymbolicLink()) {
      const target = resolve(dirname(link), await readlink(link));
      if (relative(runtime, target).startsWith("..")) throw new Error("Unexpected workspace link");
      await unlink(link);
      await cp(target, link, { recursive: true, dereference: true });
    }
  }
  await cp(process.execPath, join(runtime, "bin", process.platform === "win32" ? "bun.exe" : "bun"));
  const ripgrep = process.env.ALPHACODE_APP_RG || Bun.which("rg");
  if (!ripgrep) throw new Error("Install ripgrep or set ALPHACODE_APP_RG before packaging.");
  await cp(ripgrep, join(runtime, "bin", process.platform === "win32" ? "rg.exe" : "rg"));
  const { version: electronVersion } = JSON.parse(await readFile(fileURLToPath(import.meta.resolve("electron/package.json")), "utf8"));
  const destinations = await packager({ dir: shell, out: dist, name: "AlphaCode", executableName: "AlphaCode",
    appBundleId: "com.alpha.alphacodeapp", appVersion: "0.1.0", electronVersion, platform: platform as "win32" | "darwin" | "linux",
    arch: arch as "x64" | "arm64", asar: true, prune: false, overwrite: true, extraResource: [runtime],
  });
  for (const destination of destinations) console.log(`Desktop package: ${destination}`);
} finally {
  if (resolve(staging).startsWith(`${resolve(dist)}${process.platform === "win32" ? "\\" : "/"}`) && basename(staging).startsWith("package-")) {
    await rm(staging, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
