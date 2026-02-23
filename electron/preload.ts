/**
 * OpenBrowser - Preload script, exposes safe APIs to renderer
 */

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("openBrowser", {
  getBridgePort: () => ipcRenderer.invoke("get-bridge-port"),
  setSidebarWidth: (width: number) => ipcRenderer.invoke("set-sidebar-width", width),
  getSidebarWidth: () => ipcRenderer.invoke("get-sidebar-width"),
  getUserDataPath: () => ipcRenderer.invoke("get-user-data-path"),
  getWebviewPartition: () => ipcRenderer.invoke("get-webview-partition"),
  browserNavigate: (url: string) => ipcRenderer.invoke("browser-navigate", url),
  browserGetUrl: () => ipcRenderer.invoke("browser-get-url"),
  onBrowserUrlChanged: (cb: (url: string) => void) => {
    ipcRenderer.on("browser-url-changed", (_e, url: string) => cb(url));
  },
  getAiConfig: () => ipcRenderer.invoke("get-ai-config"),
  plan: (goal: string, provider?: string, apiKeyOverride?: string) =>
    ipcRenderer.invoke("plan", goal, provider, apiKeyOverride),
  executeActionInBrowser: (action: Record<string, unknown>) =>
    ipcRenderer.invoke("browser-execute-action", action),
  projectsList: () => ipcRenderer.invoke("projects-list"),
  projectsSave: (data: unknown) => ipcRenderer.invoke("projects-save", data),
  projectsLoad: (id: string) => ipcRenderer.invoke("projects-load", id),
  projectsDelete: (id: string) => ipcRenderer.invoke("projects-delete", id),
});
