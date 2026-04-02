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
  browserNavigate: (url: string) => ipcRenderer.invoke("browser-navigate", url),
  browserGetUrl: () => ipcRenderer.invoke("browser-get-url"),
  onBrowserUrlChanged: (cb: (url: string) => void) => {
    ipcRenderer.on("browser-url-changed", (_e, url: string) => cb(url));
  },
  getAiConfig: () => ipcRenderer.invoke("get-ai-config"),
  plan: (goal: string, provider?: string, apiKeyOverride?: string) =>
    ipcRenderer.invoke("plan", goal, provider, apiKeyOverride),
  generateStepTitles: (
    goal: string,
    plan: Array<{
      action: Record<string, unknown>;
      requiresApproval?: boolean;
    }>,
    apiKeyOverride?: string,
  ) => ipcRenderer.invoke("step-titles", goal, plan, apiKeyOverride),
  executeActionInBrowser: (action: Record<string, unknown>) =>
    ipcRenderer.invoke("browser-execute-action", action),
  runExecutionPlan: (
    goal: string,
    plan: Array<{
      action: Record<string, unknown>;
      requiresApproval?: boolean;
    }>,
  ) => ipcRenderer.invoke("executor-run", goal, plan),
  respondToExecutorApproval: (requestId: string, approved: boolean) =>
    ipcRenderer.invoke("executor-approval-response", requestId, approved),
  onExecutorState: (cb: (state: string) => void) => {
    ipcRenderer.on("executor-state", (_e, state: string) => cb(state));
  },
  onExecutorTrace: (cb: (entry: Record<string, unknown>) => void) => {
    ipcRenderer.on("executor-trace", (_e, entry: Record<string, unknown>) =>
      cb(entry),
    );
  },
  onExecutorApprovalRequired: (
    cb: (payload: {
      requestId: string;
      action: Record<string, unknown>;
    }) => void,
  ) => {
    ipcRenderer.on(
      "executor-approval-required",
      (_e, payload: { requestId: string; action: Record<string, unknown> }) =>
        cb(payload),
    );
  },
  getProfiles: () => ipcRenderer.invoke("profiles-get"),
  createProfile: (name?: string) => ipcRenderer.invoke("profiles-create", name),
  renameProfile: (id: string, name: string) =>
    ipcRenderer.invoke("profiles-rename", id, name),
  deleteProfile: (id: string) => ipcRenderer.invoke("profiles-delete", id),
  setActiveProfile: (id: string) =>
    ipcRenderer.invoke("profiles-set-active", id),
  projectsList: () => ipcRenderer.invoke("projects-list"),
  projectsSave: (data: unknown) => ipcRenderer.invoke("projects-save", data),
  projectsLoad: (id: string) => ipcRenderer.invoke("projects-load", id),
  projectsDelete: (id: string) => ipcRenderer.invoke("projects-delete", id),
});
