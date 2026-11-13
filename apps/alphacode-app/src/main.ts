import { app, BrowserWindow, dialog, Menu, nativeTheme, net, protocol, screen, session, shell, type MenuItemConstructorOptions } from "electron";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createBackend } from "./backend";
import { withBundledCommands } from "./cli-command";
import { installCliCommand } from "./install-cli";
import { applicationURL, assetPath, databaseArgument, developmentURL, externalURL, isApplicationURL, isRendererURL } from "./policy";

const applicationName = "AlphaCode";
const applicationIcon = join(app.getAppPath(), "assets", process.platform === "win32" ? "icon.ico" : "icon.png");
const rendererURL = developmentURL(process.env.VITE_DEV_SERVER_URL, app.isPackaged);
const trustedRenderer = (url: string) => isRendererURL(url, rendererURL);
app.setName(applicationName);
const userData = join(app.getPath("appData"), rendererURL ? "alphacode-app-dev" : "alphacode-app");
mkdirSync(userData, { recursive: true });
app.setPath("userData", userData);
if (process.platform === "win32") app.setAppUserModelId("com.alpha.alphacodeapp");
protocol.registerSchemesAsPrivileged([{ scheme: "alphacode-app", privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true,
} }]);

let window: BrowserWindow | undefined;
let opening: Promise<void> | undefined;
const chinese = () => app.getLocale().startsWith("zh");
const label = (zh: string, en: string) => chinese() ? zh : en;
const focus = () => { if (window?.isMinimized()) window.restore(); window?.show(); window?.focus(); };

function installMenu() {
  const menu: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
    { label: label("编辑", "Edit"), submenu: [
      { role: "undo" }, { role: "redo" }, { type: "separator" },
      { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
    ] },
    { label: label("视图", "View"), submenu: [
      { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" },
      { role: "togglefullscreen" }, ...(!app.isPackaged ? [{ role: "toggleDevTools" as const }] : []),
    ] },
    { label: label("窗口", "Window"), submenu: [{ role: "minimize" }, { role: "close" }] },
    ...(app.isPackaged ? [{ label: label("工具", "Tools"), submenu: [{
      label: label("安装 alphacode 终端命令…", "Install alphacode Terminal Command…"),
      click: async () => {
        try {
          const result = await installCliCommand({ root: join(process.resourcesPath, "runtime"), home: app.getPath("home") });
          await dialog.showMessageBox({ type: "info", title: applicationName,
            message: result.kind === "existing"
              ? label("保留已安装的 CLI", "Using your existing CLI")
              : label("终端命令已安装", "Terminal command installed"),
            detail: result.kind === "existing"
              ? label(`已有命令未被修改：\n${result.command}`, `Your existing command was left unchanged:\n${result.command}`)
              : label(`重新打开终端后运行 alphacode。\n${result.command}`, `Open a new terminal and run alphacode.\n${result.command}`),
          });
        } catch (error) {
          await dialog.showMessageBox({ type: "error", title: applicationName,
            message: label("无法安装终端命令", "Could not install the terminal command"),
            detail: error instanceof Error && error.message === "UNSUPPORTED_SHELL"
              ? label("当前 Shell 尚不支持自动配置。可手动将 ~/.alphacode/bin 加入 PATH。", "This shell does not support automatic setup. Add ~/.alphacode/bin to PATH manually.")
              : label("请检查用户目录和 Shell 配置文件的写入权限，然后重试。", "Check write access to your home directory and shell configuration, then retry."),
          });
        }
      },
    }] }] : []),
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
}

async function createWindow() {
  if (window && !window.isDestroyed()) { focus(); return; }
  const stateFile = join(app.getPath("userData"), "window.json");
  let saved: { x?: number; y?: number; width?: number; height?: number; maximized?: boolean } = {};
  try { saved = JSON.parse(await readFile(stateFile, "utf8")) ?? {}; } catch { /* First launch uses centered defaults. */ }
  const { x, y } = saved;
  const width = typeof saved.width === "number" && Number.isFinite(saved.width) ? Math.max(680, Math.min(saved.width, 2560)) : 1200;
  const height = typeof saved.height === "number" && Number.isFinite(saved.height) ? Math.max(520, Math.min(saved.height, 1600)) : 820;
  const position = typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y) && screen.getAllDisplays().some(({ workArea }) =>
    x + width > workArea.x + 100 && x < workArea.x + workArea.width - 100
    && y >= workArea.y && y < workArea.y + workArea.height - 100) ? { x, y } : {};
  const backgroundColor = nativeTheme.shouldUseDarkColors ? "#171b22" : "#f1f4f9";
  const created = new BrowserWindow({ ...position, width, height, minWidth: 680, minHeight: 520,
    title: applicationName, icon: applicationIcon, show: false, autoHideMenuBar: true,
    backgroundColor, titleBarStyle: "hidden",
    titleBarOverlay: process.platform === "darwin" ? true : {
      color: backgroundColor, symbolColor: nativeTheme.shouldUseDarkColors ? "#e7ebf1" : "#252a34", height: 36,
    },
    ...(process.platform === "darwin" ? { trafficLightPosition: { x: 14, y: 11 } } : {}),
    webPreferences: { preload: join(__dirname, "preload.cjs"), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, spellcheck: true },
  });
  window = created;
  created.webContents.ipc.handle("project:select-directory", async event => {
    if (event.senderFrame !== created.webContents.mainFrame || !trustedRenderer(event.senderFrame.url)) throw new Error("UNTRUSTED_RENDERER");
    const result = await dialog.showOpenDialog(created, {
      title: label("选择项目目录", "Select project directory"), properties: ["openDirectory"],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  created.webContents.ipc.on("window:appearance", (event, appearance: unknown) => {
    if (event.senderFrame !== created.webContents.mainFrame || !trustedRenderer(event.senderFrame.url)) return;
    if (!appearance || typeof appearance !== "object" || !("color" in appearance) || !("symbolColor" in appearance)) return;
    const { color, symbolColor } = appearance;
    if (typeof color !== "string" || typeof symbolColor !== "string" || !/^#[\da-f]{6}$/i.test(color) || !/^#[\da-f]{6}$/i.test(symbolColor)) return;
    created.setBackgroundColor(color);
    if (process.platform !== "darwin") created.setTitleBarOverlay({ color, symbolColor });
  });
  created.once("ready-to-show", () => { if (saved.maximized) created.maximize(); created.show(); });
  created.on("page-title-updated", event => { event.preventDefault(); created.setTitle(applicationName); });
  created.on("close", () => {
    const state = { ...created.getNormalBounds(), maximized: created.isMaximized() };
    try { mkdirSync(app.getPath("userData"), { recursive: true }); writeFileSync(stateFile, JSON.stringify(state)); } catch { /* Closing must not depend on preference storage. */ }
  });
  created.on("closed", () => { if (window === created) window = undefined; });
  const openExternal = (value: string) => { const safe = externalURL(value); if (safe) void shell.openExternal(safe).catch(() => undefined); };
  created.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: "deny" }; });
  created.webContents.on("will-navigate", (event, url) => {
    if (!trustedRenderer(url)) { event.preventDefault(); openExternal(url); }
  });
  created.webContents.on("will-redirect", (event, url) => { if (!trustedRenderer(url)) event.preventDefault(); });
  created.webContents.on("will-attach-webview", event => event.preventDefault());
  created.webContents.on("context-menu", (_event, params) => {
    const items: MenuItemConstructorOptions[] = params.isEditable
      ? [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }]
      : params.selectionText ? [{ role: "copy" }, { role: "selectAll" }] : [];
    if (params.linkURL && externalURL(params.linkURL)) items.push({ label: label("在浏览器中打开链接", "Open link in browser"), click: () => openExternal(params.linkURL) });
    if (items.length) Menu.buildFromTemplate(items).popup({ window: created });
  });
  await created.loadURL(rendererURL ?? applicationURL);
}

async function start() {
  const root = app.isPackaged ? join(process.resourcesPath, "runtime") : resolve(process.env.ALPHACODE_APP_REPOSITORY || join(app.getAppPath(), "../.."));
  const binary = process.platform === "win32" ? "bun.exe" : "bun";
  const bun = app.isPackaged ? join(root, "bin", binary) : process.env.ALPHACODE_APP_BUN || (existsSync(join(homedir(), ".bun/bin", binary)) ? join(homedir(), ".bun/bin", binary) : binary);
  if (app.isPackaged) Object.assign(process.env, withBundledCommands(root, process.env));
  const backend = createBackend({ root, bun, database: databaseArgument(process.argv) });
  const web = join(root, "apps/alphacode-web/dist");
  const csp = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
  protocol.handle("alphacode-app", async request => {
    if (!isApplicationURL(request.url)) return new Response("Forbidden", { status: 403 });
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return backend.forward(request);
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
    try {
      const response = await net.fetch(pathToFileURL(assetPath(web, url.pathname)).toString());
      const headers = new Headers(response.headers);
      headers.set("Content-Security-Policy", csp);
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Referrer-Policy", "no-referrer");
      return new Response(response.body, { status: response.status, headers });
    } catch { return new Response("Not found", { status: 404 }); }
  });
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(trustedRenderer(contents.getURL()) && permission === "clipboard-sanitized-write");
  });
  session.defaultSession.setPermissionCheckHandler((contents, permission) =>
    Boolean(contents && trustedRenderer(contents.getURL()) && permission === "clipboard-sanitized-write"));
  installMenu();
  if (process.platform === "darwin") app.dock?.setIcon(applicationIcon);
  for (;;) {
    try { if (!rendererURL) await backend.connect(); await createWindow(); break; }
    catch {
      const choice = await dialog.showMessageBox({ type: "error", title: applicationName,
        message: label("无法启动本地工作区", "Could not start the local workspace"),
        detail: label("请确认 Bun 和应用资源可用，然后重试。现有会话数据保留在原位置。", "Check that Bun and the application resources are available, then retry. Existing sessions remain in their original location."),
        buttons: [label("重试", "Retry"), label("退出", "Quit")], defaultId: 0, cancelId: 1,
      });
      if (choice.response === 1) { app.quit(); break; }
    }
  }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", focus);
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
  app.on("activate", () => {
    if (window) focus();
    else if (!opening) opening = createWindow().finally(() => { opening = undefined; });
  });
  app.whenReady().then(() => { opening = start().finally(() => { opening = undefined; }); return opening; }).catch(() => {
    dialog.showErrorBox(applicationName, label("应用启动失败，请重新启动。", "The application could not start. Please relaunch.")); app.quit();
  });
}
