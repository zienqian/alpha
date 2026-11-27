import { contextBridge, ipcRenderer } from "electron";

// Expose only specific native capabilities; filesystem access stays in the host.
contextBridge.exposeInMainWorld("alphacodeDesktop", {
  platform: process.platform,
  translucent: process.argv.includes("--alphacode-translucent"),
  selectDirectory: (): Promise<string | null> => ipcRenderer.invoke("project:select-directory"),
  notify: (notification: { sessionId: string; title: string; kind: "completed" | "approval" | "failed" }) => {
    ipcRenderer.send("session:notify", notification);
  },
  onNotificationClick: (listener: (sessionId: string) => void) => {
    const receive = (_event: Electron.IpcRendererEvent, sessionId: unknown) => {
      if (typeof sessionId === "string") listener(sessionId);
    };
    ipcRenderer.on("session:notification-click", receive);
    return () => ipcRenderer.removeListener("session:notification-click", receive);
  },
  setAppearance: (appearance: { color: string; symbolColor: string; theme?: "light" | "dark" | "system" }) => {
    ipcRenderer.send("window:appearance", appearance);
  },
});
