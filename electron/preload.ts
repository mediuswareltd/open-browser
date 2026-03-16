/**
 * OpenBrowser - Preload script, exposes safe APIs to renderer
 */

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("openBrowser", {
  getBridgePort: () => ipcRenderer.invoke("get-bridge-port"),
  getLogoUrl: () => ipcRenderer.invoke("get-logo-url"),
  setSidebarWidth: (width: number) =>
    ipcRenderer.invoke("set-sidebar-width", width),
  getSidebarWidth: () => ipcRenderer.invoke("get-sidebar-width"),
  getUserDataPath: () => ipcRenderer.invoke("get-user-data-path"),
  getWebviewPartition: () => ipcRenderer.invoke("get-webview-partition"),
  getSavedAiConfig: () => ipcRenderer.invoke("get-saved-ai-config"),
  verifyAndSaveAiConfig: (data: {
    aiProvider?: string;
    geminiApiKey?: string;
    model?: string;
  }) => ipcRenderer.invoke("verify-and-save-ai-config", data),
  listGeminiModels: (apiKeyOverride?: string) =>
    ipcRenderer.invoke("list-gemini-models", apiKeyOverride),
  clearAiConfigAndReset: () => ipcRenderer.invoke("clear-ai-config-and-reset"),
  startMainInterface: () => ipcRenderer.invoke("start-main-interface"),
  setBrowserViewVisible: (visible: boolean) =>
    ipcRenderer.invoke("set-browser-view-visible", visible),
  setBrowserViewLayout: (topInset: number, bottomInset: number) =>
    ipcRenderer.invoke("set-browser-view-layout", topInset, bottomInset),
  browserNavigate: (url: string) => ipcRenderer.invoke("browser-navigate", url),
  browserGetUrl: () => ipcRenderer.invoke("browser-get-url"),
  browserGetTitle: () => ipcRenderer.invoke("browser-get-title"),
  onBrowserUrlChanged: (cb: (url: string) => void) => {
    ipcRenderer.on("browser-url-changed", (_e, url: string) => cb(url));
  },
  getAiConfig: () => ipcRenderer.invoke("get-ai-config"),
  plan: (goal: string, provider?: string, apiKeyOverride?: string) =>
    ipcRenderer.invoke("plan", goal, provider, apiKeyOverride),
  executeActionInBrowser: (action: Record<string, unknown>) =>
    ipcRenderer.invoke("browser-execute-action", action),
  projectsList: () => ipcRenderer.invoke("projects-list"),
  projectCreate: (name?: string) => ipcRenderer.invoke("project-create", name),
  projectRename: (id: string, name: string) =>
    ipcRenderer.invoke("project-rename", id, name),
  projectLoad: (id: string) => ipcRenderer.invoke("project-load", id),
  projectDelete: (id: string) => ipcRenderer.invoke("project-delete", id),
  taskCreate: (projectId: string) =>
    ipcRenderer.invoke("task-create", projectId),
  taskRename: (projectId: string, taskId: string, title: string) =>
    ipcRenderer.invoke("task-rename", projectId, taskId, title),
  taskDelete: (projectId: string, taskId: string) =>
    ipcRenderer.invoke("task-delete", projectId, taskId),
  taskAddPrompt: (projectId: string, taskId: string, prompt: string) =>
    ipcRenderer.invoke("task-add-prompt", projectId, taskId, prompt),
});
