import { spawn } from "node:child_process";
import { join } from "node:path";

export async function enableWeb() {
  const app = join(import.meta.dir, "..", "..", "..", "alphacode-web");
  const directory = join(app, "dist");
  if (!await Bun.file(join(directory, "index.html")).exists()) {
    const build = Bun.spawn([process.execPath, "run", "build"], { cwd: app, stdout: "ignore", stderr: "ignore", windowsHide: true });
    if (await build.exited !== 0) throw Object.assign(new Error("Build the Web UI with bun run build:web before using /web."), { status: 503, code: "WEB_BUILD_FAILED" });
  }
  return directory;
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
