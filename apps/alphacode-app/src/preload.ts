import { contextBridge, ipcRenderer } from "electron";

// Expose only specific native capabilities; filesystem access stays in the host.
contextBridge.exposeInMainWorld("alphacodeDesktop", {
  platform: process.platform,
  translucent: process.argv.includes("--alphacode-translucent"),
  selectDirectory: (): Promise<string | null> => ipcRenderer.invoke("project:select-directory"),
  setAppearance: (appearance: { color: string; symbolColor: string; theme?: "light" | "dark" | "system" }) => {
    ipcRenderer.send("window:appearance", appearance);
  },
});
