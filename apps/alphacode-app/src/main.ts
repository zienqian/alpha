import { app, BrowserWindow, dialog, Menu, nativeTheme, net, Notification, protocol, screen, session, shell, type MenuItemConstructorOptions } from "electron";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { registerNotificationIdentity } from "./notification-identity";
import { readFile } from "node:fs/promises";
import { homedir, release } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createBackend } from "./backend";
import { withBundledCommands } from "./cli-command";
import { installCliCommand } from "./install-cli";
import { applicationContentSecurityPolicy, applicationURL, assetPath, databaseArgument, developmentURL, documentPath, externalURL, isApplicationURL, isRendererURL, supportsNativeGlass } from "./policy";

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
let backend: ReturnType<typeof createBackend> | undefined;
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
  const translucent = supportsNativeGlass(process.platform, release());
  const backgroundColor = translucent ? "#00000000" : nativeTheme.shouldUseDarkColors ? "#141414" : "#ffffff";
  const created = new BrowserWindow({ ...position, width, height, minWidth: 680, minHeight: 520,
    title: applicationName, icon: applicationIcon, show: false, autoHideMenuBar: true,
    backgroundColor, titleBarStyle: "hidden",
    ...(process.platform === "darwin" ? {
      vibrancy: "sidebar" as const,
      visualEffectState: "followWindow" as const,
      trafficLightPosition: { x: 14, y: 15 },
      titleBarOverlay: true,
    } : {
      ...(translucent ? { backgroundMaterial: "acrylic" as const } : {}),
      titleBarOverlay: {
        // Let the renderer's titlebar and modal backdrops show through the controls.
        color: "#00000000", symbolColor: nativeTheme.shouldUseDarkColors ? "#f5f5f5" : "#171717", height: 44,
      },
    }),
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      additionalArguments: translucent ? ["--alphacode-translucent"] : [],
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, spellcheck: true,
    },
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
    const { color, symbolColor, theme } = appearance as { color: unknown; symbolColor: unknown; theme?: unknown };
    if (typeof color !== "string" || typeof symbolColor !== "string" || !/^#[\da-f]{6}$/i.test(color) || !/^#[\da-f]{6}$/i.test(symbolColor)) return;
    if (theme === "light" || theme === "dark" || theme === "system") nativeTheme.themeSource = theme;
    if (!translucent) created.setBackgroundColor(color);
    if (process.platform !== "darwin") created.setTitleBarOverlay({ color: "#00000000", symbolColor });
  });
  const notifications = new Set<Notification>();
  created.webContents.ipc.on("session:notify", (event, value: unknown) => {
    if (event.senderFrame !== created.webContents.mainFrame || !trustedRenderer(event.senderFrame.url)) return;
    if (!value || typeof value !== "object") return;
    const { sessionId, title, kind } = value as { sessionId?: unknown; title?: unknown; kind?: unknown };
    if (typeof sessionId !== "string" || !sessionId || sessionId.length > 256 || typeof title !== "string" || title.length > 1000) return;
    if (kind !== "completed" && kind !== "approval" && kind !== "failed") return;
    if (!Notification.isSupported()) return;
    try {
      const notification = new Notification({
        title: kind === "approval" ? label("需要你确认操作", "Your approval is needed")
          : kind === "failed" ? label("对话需要你处理", "Your conversation needs attention")
          : label("对话已完成", "Conversation completed"),
        body: title.trim().slice(0, 200) || applicationName,
        icon: applicationIcon,
      });
      notifications.add(notification);
      notification.on("click", () => {
        if (created.isDestroyed()) return;
        focus();
        created.webContents.send("session:notification-click", sessionId);
      });
      notification.on("close", () => notifications.delete(notification));
      notification.on("failed", () => notifications.delete(notification));
      notification.show();
    } catch { /* Notification availability must not interrupt a conversation. */ }
  });
  created.once("closed", () => { notifications.forEach(notification => notification.close()); notifications.clear(); });
  created.once("ready-to-show", () => { if (saved.maximized) created.maximize(); created.show(); });
  created.on("page-title-updated", event => { event.preventDefault(); created.setTitle(applicationName); });
  created.on("close", () => {
    const state = { ...created.getNormalBounds(), maximized: created.isMaximized() };
    try { mkdirSync(app.getPath("userData"), { recursive: true }); writeFileSync(stateFile, JSON.stringify(state)); } catch { /* Closing must not depend on preference storage. */ }
  });
  created.on("closed", () => { if (window === created) window = undefined; });
  const openExternal = (value: string) => {
    const path = documentPath(value, rendererURL);
    if (path && backend) {
      void backend.connect().then(descriptor => shell.openExternal(new URL(path, descriptor.origin).href)).catch(() => {
        void dialog.showMessageBox(created, { type: 'error', title: applicationName,
          message: label('无法在浏览器中打开文档，请重试。', 'Could not open the document in your browser. Please try again.') });
      });
      return;
    }
    const safe = externalURL(value); if (safe) void shell.openExternal(safe).catch(() => undefined);
  };
  created.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: "deny" }; });
  created.webContents.on("will-navigate", (event, url) => {
    if (documentPath(url, rendererURL) || !trustedRenderer(url)) { event.preventDefault(); openExternal(url); }
  });
  created.webContents.on("will-redirect", (event, url) => { if (!trustedRenderer(url)) event.preventDefault(); });
  created.webContents.on("will-attach-webview", event => event.preventDefault());
  created.webContents.on("context-menu", (_event, params) => {
    const items: MenuItemConstructorOptions[] = params.isEditable
      ? [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }]
      : params.selectionText ? [{ role: "copy" }, { role: "selectAll" }] : [];
    if (params.linkURL && (documentPath(params.linkURL, rendererURL) || externalURL(params.linkURL))) items.push({ label: label("在浏览器中打开链接", "Open link in browser"), click: () => openExternal(params.linkURL) });
    if (items.length) Menu.buildFromTemplate(items).popup({ window: created });
  });
  await created.loadURL(rendererURL ?? applicationURL);
}

async function start() {
  if (process.platform === "win32") {
    try {
      // The Windows shell cannot read icons inside app.asar.
      const icon = join(userData, "notification.ico");
      copyFileSync(applicationIcon, icon);
      registerNotificationIdentity({ id: "com.alpha.alphacodeapp", name: applicationName, icon });
    } catch (error) { console.warn("Could not register the Windows notification identity", error); }
  }
  const root = app.isPackaged ? join(process.resourcesPath, "runtime") : resolve(process.env.ALPHACODE_APP_REPOSITORY || join(app.getAppPath(), "../.."));
  const binary = process.platform === "win32" ? "bun.exe" : "bun";
  const bun = app.isPackaged ? join(root, "bin", binary) : process.env.ALPHACODE_APP_BUN || (existsSync(join(homedir(), ".bun/bin", binary)) ? join(homedir(), ".bun/bin", binary) : binary);
  if (app.isPackaged) Object.assign(process.env, withBundledCommands(root, process.env));
  const connection = createBackend({ root, bun, database: databaseArgument(process.argv) });
  backend = connection;
  const web = join(root, "apps/alphacode-web/dist");
  protocol.handle("alphacode-app", async request => {
    if (!isApplicationURL(request.url)) return new Response("Forbidden", { status: 403 });
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return connection.forward(request);
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
    try {
      const response = await net.fetch(pathToFileURL(assetPath(web, url.pathname)).toString());
      const headers = new Headers(response.headers);
      headers.set("Content-Security-Policy", applicationContentSecurityPolicy);
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
    try { if (!rendererURL) await connection.connect(); await createWindow(); break; }
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
