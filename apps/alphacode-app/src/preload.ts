import { contextBridge, ipcRenderer } from "electron";

// Expose only specific native capabilities; filesystem access stays in the host.
contextBridge.exposeInMainWorld("alphacodeDesktop", {
  platform: process.platform,
  selectDirectory: (): Promise<string | null> => ipcRenderer.invoke("project:select-directory"),
  setAppearance: (appearance: { color: string; symbolColor: string }) => {
    ipcRenderer.send("window:appearance", appearance);
  },
});
