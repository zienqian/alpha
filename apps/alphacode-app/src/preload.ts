import { contextBridge, ipcRenderer } from "electron";

// Keep the bridge limited to appearance; native window controls stay native.
contextBridge.exposeInMainWorld("alphacodeDesktop", {
  platform: process.platform,
  setAppearance: (appearance: { color: string; symbolColor: string }) => {
    ipcRenderer.send("window:appearance", appearance);
  },
});
