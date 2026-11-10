import { spawn } from "node:child_process";
import { cp, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { serverLayout } from "./revision";

export async function enableWeb() {
  const app = join((await serverLayout()).app, "..", "alphacode-web");
  const directory = join(app, "dist");
  if (!await Bun.file(join(directory, "index.html")).exists()) {
    const build = Bun.spawn([process.execPath, "run", "build"], { cwd: app, stdout: "ignore", stderr: "ignore", windowsHide: true });
    if (await build.exited !== 0) throw Object.assign(new Error("Build the Web UI with bun run build:web before using /web."), { status: 503, code: "WEB_BUILD_FAILED" });
  }
  return directory;
}

export async function snapshotWeb(directory: string, revision: string) {
  const destination = join(directory, "web", revision);
  const assets = join(directory, "web", "assets");
  let snapshot: Promise<string> | undefined;
  const prepare = () => snapshot ??= (async () => {
    if (await Bun.file(join(destination, "index.html")).exists()) return destination;
    const source = await enableWeb();
    const index = await readFile(join(source, "index.html"));
    await mkdir(destination, { recursive: true, mode: 0o700 });
    await cp(source, destination, { recursive: true, filter: path => path !== join(source, "assets") && path !== join(source, "index.html") });
    // Content-hashed assets remain valid for pages opened before the update.
    await mkdir(assets, { recursive: true, mode: 0o700 });
    await cp(join(source, "assets"), assets, { recursive: true, force: false, errorOnExist: false });
    if (!index.equals(await readFile(join(source, "index.html")))) throw new Error("WEB_BUILD_CHANGED");
    const temporary = join(destination, `index.${randomUUID()}.tmp`);
    await writeFile(temporary, index, { mode: 0o600 });
    await rename(temporary, join(destination, "index.html"));
    return destination;
  })().catch(error => { snapshot = undefined; throw error; });
  // Capture an existing build before accepting clients, even if /web is lazy.
  if (await Bun.file(join((await serverLayout()).web, "index.html")).exists()) await prepare();
  return { enableWeb: prepare, assetDirectory: assets };
}

export function openBrowser(url: string): Promise<void> {
  if (url.trim() !== url || !/^http:\/\/127\.0\.0\.1:\d+\/\?session=(?:[a-zA-Z0-9_.~-]|%[0-9a-fA-F]{2})+$/.test(url)) return Promise.reject(new Error("INVALID_WEB_URL"));
  const command = process.platform === "win32" ? "powershell.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["-NoProfile", "-NonInteractive", "-Command", `Start-Process '${url}'`] : [url];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore", windowsHide: true });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error("BROWSER_OPEN_FAILED")));
  });
}
