/**
 * OpenBrowser - Electron Main Process
 * Persistent profile, extension loading, IPC bridge, WebSocket server for extension
 */

import "dotenv/config";
import { app, BrowserWindow, BrowserView, session, ipcMain } from "electron";
import * as fs from "fs";
import * as https from "node:https";
import * as path from "path";
import { pathToFileURL } from "node:url";
import { createServer } from "./bridge-server";
import { getAiConfig, type AiProvider } from "./config";
import { planWithGemini } from "./gemini-planner";
import { generateFriendlyStepTitles } from "./gemini-step-titles";
import { planWithOllama } from "./ollama-planner";
import { executeInPage } from "./browser-executor";
import { Executor } from "../runtime/executor";
import type { BrowserAction } from "../shared/schemas";
import type { TraceEntry } from "../shared/types";
import {
  listProjects,
  saveProject,
  loadProject,
  deleteProject,
} from "./project-store";

const isDev = process.env.NODE_ENV === "development";
const userDataPath = path.join(app.getPath("userData"), "open-browser");
const projectRoot = path.join(__dirname, "..", "..");
const extensionPath = path.join(projectRoot, "extension");
const configFilePath = path.join(userDataPath, "config.json");
const SIDEBAR_EXPANDED = 320;
const SIDEBAR_COLLAPSED = 52;
const BROWSER_PARTITION_PREFIX = "persist:openbrowser:";
const DEFAULT_PROFILE_ID = "default";
const DEFAULT_PROFILE_NAME = "Default";
/* Match address bar visual height: 12px padding-top + 38px bar + 20px margin-bottom = 70 */
const URL_BAR_HEIGHT = 72;

let mainWindow: BrowserWindow | null = null;
let sidebarWidth = SIDEBAR_EXPANDED;
let browserView: BrowserView | null = null;
let bridgeServer: ReturnType<typeof createServer> | null = null;
const extensionLoadedPartitions = new Set<string>();
let runtimeAiConfig = getAiConfig();
let ipcInitialized = false;
let profiles: StoredProfile[] = [
  { id: DEFAULT_PROFILE_ID, name: DEFAULT_PROFILE_NAME },
];
let activeProfileId = DEFAULT_PROFILE_ID;
const pendingApprovals = new Map<
  string,
  {
    senderId: number;
    resolve: (approved: boolean) => void;
    timeout: NodeJS.Timeout;
  }
>();

interface StoredAiConfig {
  aiProvider: AiProvider;
  geminiApiKey: string;
  model?: string;
}

interface StoredProfile {
  id: string;
  name: string;
}

interface StoredAppConfig {
  aiProvider?: AiProvider;
  geminiApiKey?: string;
  model?: string;
  profiles?: StoredProfile[];
  activeProfileId?: string;
}

function toAiProvider(value: unknown): AiProvider | null {
  if (value === "gemini" || value === "ollama" || value === "heuristic")
    return value;
  return null;
}

function normalizeProfileId(value: unknown): string {
  const raw = String(value || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "");
  return raw || DEFAULT_PROFILE_ID;
}

function profilePartition(profileId = activeProfileId): string {
  return `${BROWSER_PARTITION_PREFIX}${normalizeProfileId(profileId)}`;
}

function readStoredAppConfig(): StoredAppConfig | null {
  if (!fs.existsSync(configFilePath)) return null;
  try {
    return JSON.parse(
      fs.readFileSync(configFilePath, "utf-8"),
    ) as StoredAppConfig;
  } catch {
    return null;
  }
}

function writeStoredAppConfig(config: StoredAppConfig) {
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2), "utf-8");
}

function readStoredAiConfig(): StoredAiConfig | null {
  const raw = readStoredAppConfig();
  if (!raw) return null;
  const aiProvider = toAiProvider(raw.aiProvider);
  if (!aiProvider) return null;
  return {
    aiProvider,
    geminiApiKey: String(raw.geminiApiKey || "").trim(),
    model: raw.model ? String(raw.model).trim() : undefined,
  };
}

function normalizeProfilesState(
  rawProfiles: unknown,
  rawActiveProfileId: unknown,
): { profiles: StoredProfile[]; activeProfileId: string } {
  const list = Array.isArray(rawProfiles) ? rawProfiles : [];
  const map = new Map<string, StoredProfile>();
  list.forEach((profile, idx) => {
    const p = (profile || {}) as { id?: unknown; name?: unknown };
    const id = normalizeProfileId(p.id || `profile-${idx + 1}`);
    const name =
      String(p.name || `Profile ${idx + 1}`).trim() || `Profile ${idx + 1}`;
    if (!map.has(id)) map.set(id, { id, name });
  });
  if (!map.has(DEFAULT_PROFILE_ID)) {
    map.set(DEFAULT_PROFILE_ID, {
      id: DEFAULT_PROFILE_ID,
      name: DEFAULT_PROFILE_NAME,
    });
  }
  const normalizedProfiles = Array.from(map.values());
  const activeId = normalizeProfileId(rawActiveProfileId);
  const nextActive = normalizedProfiles.some((p) => p.id === activeId)
    ? activeId
    : DEFAULT_PROFILE_ID;
  return { profiles: normalizedProfiles, activeProfileId: nextActive };
}

function readStoredProfilesState(): {
  profiles: StoredProfile[];
  activeProfileId: string;
} {
  const raw = readStoredAppConfig();
  return normalizeProfilesState(raw?.profiles, raw?.activeProfileId);
}

function writeStoredAiConfig(config: StoredAiConfig) {
  const current = readStoredAppConfig() || {};
  writeStoredAppConfig({
    ...current,
    aiProvider: config.aiProvider,
    geminiApiKey: config.geminiApiKey,
    model: config.model,
  });
}

function writeStoredProfilesState(
  nextProfiles: StoredProfile[],
  activeId: string,
) {
  const current = readStoredAppConfig() || {};
  const normalized = normalizeProfilesState(nextProfiles, activeId);
  profiles = normalized.profiles;
  activeProfileId = normalized.activeProfileId;
  writeStoredAppConfig({
    ...current,
    profiles: profiles,
    activeProfileId,
  });
}

function clearStoredAiConfig() {
  const current = readStoredAppConfig();
  if (!current) return;
  delete current.aiProvider;
  delete current.geminiApiKey;
  delete current.model;
  if (!Object.keys(current).length) {
    if (fs.existsSync(configFilePath)) fs.unlinkSync(configFilePath);
    return;
  }
  writeStoredAppConfig(current);
}

function applyStoredAiConfig(config: StoredAiConfig) {
  runtimeAiConfig = {
    ...runtimeAiConfig,
    provider: config.aiProvider,
    geminiApiKey: config.geminiApiKey.trim(),
    model: config.model?.trim() || runtimeAiConfig.model,
  };
}

function applyStoredProfilesState(state: {
  profiles: StoredProfile[];
  activeProfileId: string;
}) {
  profiles = state.profiles;
  activeProfileId = state.activeProfileId;
}

function requestJson(url: string): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let body = "";
        res.on("data", (chunk: Buffer | string) => {
          body += chunk.toString();
        });
        res.on("end", () => {
          const status = res.statusCode || 0;
          try {
            resolve({ status, data: body ? JSON.parse(body) : {} });
          } catch {
            resolve({ status, data: {} });
          }
        });
      })
      .on("error", reject);
  });
}

async function verifyGeminiApiKey(apiKey: string): Promise<boolean> {
  const key = apiKey.trim();
  if (!key) return false;
  try {
    const endpoint = new URL(
      "https://generativelanguage.googleapis.com/v1/models",
    );
    endpoint.searchParams.set("key", key);
    const response = await requestJson(endpoint.toString());
    const payload = response.data as { error?: unknown };
    return response.status >= 200 && response.status < 300 && !payload?.error;
  } catch (err) {
    console.error("[OpenBrowser] Gemini key verification failed:", err);
    return false;
  }
}

async function fetchGeminiModels(apiKey: string): Promise<string[]> {
  const key = apiKey.trim();
  if (!key) return [];
  try {
    const endpoint = new URL(
      "https://generativelanguage.googleapis.com/v1/models",
    );
    endpoint.searchParams.set("key", key);
    const response = await requestJson(endpoint.toString());
    if (response.status < 200 || response.status >= 300) return [];
    const payload = response.data as {
      error?: unknown;
      models?: Array<{ name?: unknown }>;
    };
    if (payload?.error || !Array.isArray(payload?.models)) return [];
    const names = payload.models
      .map((m) =>
        typeof m?.name === "string" ? m.name.replace(/^models\//, "") : "",
      )
      .filter((name) => name.startsWith("gemini-"));
    return Array.from(new Set(names));
  } catch (err) {
    console.error("[OpenBrowser] Fetch Gemini models failed:", err);
    return [];
  }
}

async function verifyAndSaveAiConfig(data: {
  aiProvider?: unknown;
  geminiApiKey?: unknown;
  model?: unknown;
}) {
  const aiProvider = toAiProvider(data.aiProvider) || "gemini";
  const geminiApiKey = String(data.geminiApiKey || "").trim();
  const model = String(
    data.model || runtimeAiConfig.model || "gemini-2.5-flash",
  ).trim();

  if (aiProvider === "gemini") {
    const valid = await verifyGeminiApiKey(geminiApiKey);
    if (!valid) return { ok: false, error: "Invalid Gemini API key" };
  }

  const config: StoredAiConfig = { aiProvider, geminiApiKey, model };
  writeStoredAiConfig(config);
  applyStoredAiConfig(config);
  return { ok: true, config };
}

async function getSavedAiConfig() {
  const config = readStoredAiConfig();
  if (!config) return { hasConfig: false };
  if (config.aiProvider !== "gemini" || !config.geminiApiKey)
    return { hasConfig: false };
  const valid = await verifyGeminiApiKey(config.geminiApiKey);
  if (!valid) return { hasConfig: false };
  applyStoredAiConfig(config);
  return { hasConfig: true, config };
}

async function createBrowserView(win: BrowserWindow, initialUrl = "") {
  const partition = profilePartition();
  await loadExtensionForPartition(partition);
  browserView = new BrowserView({
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setBrowserView(browserView);
  updateBrowserViewBounds(win);
  browserView.webContents.loadURL(initialUrl || "https://www.google.com");

  browserView.webContents.on("did-navigate-in-page", (_e, url) => {
    win.webContents.send("browser-url-changed", url);
  });
  browserView.webContents.on("did-navigate", (_e, url) => {
    win.webContents.send("browser-url-changed", url);
  });
}

function updateBrowserViewBounds(win: BrowserWindow) {
  if (!browserView) return;
  const [w, h] = win.getContentSize();
  browserView.setBounds({
    x: sidebarWidth,
    y: URL_BAR_HEIGHT,
    width: Math.max(0, w - sidebarWidth),
    height: Math.max(0, h - URL_BAR_HEIGHT),
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    title: "OpenBrowser",
  });

  mainWindow.loadFile(path.join(projectRoot, "sidebar", "index.html"));

  mainWindow.on("resize", () => {
    if (mainWindow && browserView) updateBrowserViewBounds(mainWindow);
  });

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.on("closed", () => {
    browserView = null;
    mainWindow = null;
  });
}

async function loadExtensionForPartition(partition: string) {
  if (extensionLoadedPartitions.has(partition)) return true;
  await app.whenReady();
  const ses = session.fromPartition(partition);

  try {
    const ext = await ses.loadExtension(extensionPath, {
      allowFileAccess: true,
    });
    extensionLoadedPartitions.add(partition);
    // console.log("[OpenBrowser] Extension loaded:", ext.id, ext.name);
    console.log("[OpenBrowser] Extension loaded:", ext.name);
    return true;
  } catch (err) {
    const msg = String((err as Error)?.message || err || "");
    if (msg.toLowerCase().includes("already loaded")) {
      extensionLoadedPartitions.add(partition);
      return true;
    }
    console.error("[OpenBrowser] Failed to load extension:", err);
    return false;
  }
}

async function recreateBrowserViewForActiveProfile() {
  if (!mainWindow || !browserView) return;
  const currentUrl =
    browserView?.webContents?.getURL() || "https://www.google.com";
  try {
    mainWindow.removeBrowserView(browserView);
  } catch (_) {}
  browserView = null;
  await createBrowserView(mainWindow, currentUrl);
}

function getProfilesPayload() {
  return { profiles, activeProfileId };
}

function resolveExistingProfileId(profileId: string): string | null {
  const raw = String(profileId || "").trim();
  if (!raw) return null;
  const exact = profiles.find((p) => p.id === raw);
  if (exact) return exact.id;
  const normalized = normalizeProfileId(raw);
  const match = profiles.find((p) => normalizeProfileId(p.id) === normalized);
  return match?.id || null;
}

function getNextProfileName() {
  let n = 1;
  const used = new Set(profiles.map((p) => p.name.toLowerCase()));
  let candidate = `Profile ${n}`;
  while (used.has(candidate.toLowerCase())) {
    n += 1;
    candidate = `Profile ${n}`;
  }
  return candidate;
}

async function createProfile(name?: string) {
  const nextIdBase = normalizeProfileId(name || getNextProfileName());
  let id = nextIdBase;
  let i = 2;
  while (profiles.some((p) => p.id === id)) {
    id = `${nextIdBase}-${i}`;
    i += 1;
  }
  const profile: StoredProfile = {
    id,
    name: String(name || getNextProfileName()).trim() || getNextProfileName(),
  };
  profiles = [...profiles, profile];
  writeStoredProfilesState(profiles, activeProfileId);
  return { ...getProfilesPayload(), createdProfileId: profile.id };
}

async function renameProfile(profileId: string, name: string) {
  const id = resolveExistingProfileId(profileId);
  if (!id) return getProfilesPayload();
  const nextName = String(name || "").trim();
  if (!nextName) return getProfilesPayload();
  profiles = profiles.map((p) => (p.id === id ? { ...p, name: nextName } : p));
  writeStoredProfilesState(profiles, activeProfileId);
  return getProfilesPayload();
}

async function deleteProfile(profileId: string) {
  const id = resolveExistingProfileId(profileId);
  if (!id) return getProfilesPayload();
  if (id === DEFAULT_PROFILE_ID) return getProfilesPayload();
  const exists = profiles.some((p) => p.id === id);
  if (!exists) return getProfilesPayload();
  profiles = profiles.filter((p) => p.id !== id);
  if (!profiles.length) {
    profiles = [{ id: DEFAULT_PROFILE_ID, name: DEFAULT_PROFILE_NAME }];
  }
  if (!profiles.some((p) => p.id === activeProfileId)) {
    activeProfileId = profiles.some((p) => p.id === DEFAULT_PROFILE_ID)
      ? DEFAULT_PROFILE_ID
      : profiles[0].id;
    await recreateBrowserViewForActiveProfile();
  }
  writeStoredProfilesState(profiles, activeProfileId);
  return getProfilesPayload();
}

async function setActiveProfile(profileId: string) {
  const id = resolveExistingProfileId(profileId);
  if (!id || !profiles.some((p) => p.id === id)) return getProfilesPayload();
  if (id === activeProfileId) return getProfilesPayload();
  activeProfileId = id;
  writeStoredProfilesState(profiles, activeProfileId);
  await recreateBrowserViewForActiveProfile();
  return getProfilesPayload();
}

async function startMainInterface() {
  if (!mainWindow) return { started: false };
  await loadExtensionForPartition(profilePartition());
  if (!browserView) {
    await createBrowserView(mainWindow);
  }
  return { started: true };
}

function clearAiConfigAndReset() {
  clearStoredAiConfig();
  runtimeAiConfig = getAiConfig();
  if (mainWindow && browserView) {
    try {
      mainWindow.removeBrowserView(browserView);
    } catch (_) {}
    browserView = null;
  }
  return { ok: true };
}

function sendExecutorState(sender: Electron.WebContents, state: string) {
  sender.send("executor-state", state);
}

function sendExecutorTrace(sender: Electron.WebContents, entry: TraceEntry) {
  sender.send("executor-trace", entry);
}

async function requestExecutorApproval(
  sender: Electron.WebContents,
  action: BrowserAction,
) {
  const requestId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  sender.send("executor-approval-required", { requestId, action });

  return await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      pendingApprovals.delete(requestId);
      resolve(false);
    }, 120000);

    pendingApprovals.set(requestId, {
      senderId: sender.id,
      timeout,
      resolve: (approved: boolean) => {
        clearTimeout(timeout);
        resolve(approved);
      },
    });
  });
}

type ExecutionPlanStep = {
  action: BrowserAction;
  requiresApproval?: boolean;
};

async function runExecutionPlan(
  sender: Electron.WebContents,
  goal: string,
  plan: ExecutionPlanStep[],
) {
  if (!browserView?.webContents) {
    return { ok: false, error: "No browser view", state: "failed", trace: [] };
  }

  const executor = new Executor({
    onStateChange: (state) => sendExecutorState(sender, state),
    onTrace: (entry) => sendExecutorTrace(sender, entry),
    onApprovalRequired: async (action, resolve) => {
      const approved = await requestExecutorApproval(sender, action);
      resolve(approved);
    },
    executeAction: async (action) => {
      if (!browserView?.webContents) {
        return {
          actionId: action.id,
          success: false,
          error: "No browser view",
        };
      }
      if (action.type === "navigate") {
        try {
          await browserView.webContents.loadURL(action.url);
          return { actionId: action.id, success: true };
        } catch (err) {
          return {
            actionId: action.id,
            success: false,
            error: String((err as Error)?.message || err),
          };
        }
      }
      const result = await executeInPage(browserView.webContents, action);
      return {
        actionId: action.id,
        success: Boolean(result.success),
        error: result.error,
      };
    },
  });

  try {
    await executor.run(goal, plan);
    return {
      ok: true,
      state: executor.getState(),
      trace: executor.getTrace(),
    };
  } catch (err) {
    sendExecutorState(sender, "failed");
    sendExecutorTrace(sender, {
      timestamp: Date.now(),
      state: "failed",
      message: `Execution failed: ${String((err as Error)?.message || err)}`,
    });
    return {
      ok: false,
      error: String((err as Error)?.message || err),
      state: "failed",
      trace: executor.getTrace(),
    };
  }
}

function setupIPC() {
  if (ipcInitialized) return;
  ipcInitialized = true;
  ipcMain.handle("get-bridge-port", () => bridgeServer?.port ?? 0);
  ipcMain.handle(
    "get-logo-url",
    () => pathToFileURL(path.join(projectRoot, "arts", "logo.png")).href,
  );
  ipcMain.handle("set-sidebar-width", (_e, width: number) => {
    sidebarWidth = width;
    if (mainWindow && browserView) updateBrowserViewBounds(mainWindow);
  });
  ipcMain.handle("get-sidebar-width", () => sidebarWidth);
  ipcMain.handle("get-user-data-path", () => userDataPath);
  ipcMain.handle("get-webview-partition", () => profilePartition());
  ipcMain.handle("get-saved-ai-config", async () => getSavedAiConfig());
  ipcMain.handle("verify-and-save-ai-config", async (_e, data: unknown) =>
    verifyAndSaveAiConfig(
      (data || {}) as {
        aiProvider?: unknown;
        geminiApiKey?: unknown;
        model?: unknown;
      },
    ),
  );
  ipcMain.handle("list-gemini-models", async (_e, apiKeyOverride?: string) => {
    const key = (apiKeyOverride || runtimeAiConfig.geminiApiKey || "").trim();
    return fetchGeminiModels(key);
  });
  ipcMain.handle("clear-ai-config-and-reset", () => clearAiConfigAndReset());
  ipcMain.handle("start-main-interface", async () => startMainInterface());
  ipcMain.handle("profiles-get", () => getProfilesPayload());
  ipcMain.handle("profiles-create", (_e, name?: string) => createProfile(name));
  ipcMain.handle("profiles-rename", (_e, id: string, name: string) =>
    renameProfile(id, name),
  );
  ipcMain.handle("profiles-delete", (_e, id: string) => deleteProfile(id));
  ipcMain.handle("profiles-set-active", (_e, id: string) =>
    setActiveProfile(id),
  );
  ipcMain.handle("browser-navigate", (_e, url: string) => {
    browserView?.webContents.loadURL(url);
  });
  ipcMain.handle("browser-get-url", () => {
    return browserView?.webContents.getURL() ?? "";
  });
  ipcMain.handle("browser-execute-action", async (_e, action: unknown) => {
    if (!browserView?.webContents)
      return { success: false, error: "No browser view" };
    return executeInPage(
      browserView.webContents,
      action as {
        id: string;
        type: string;
        selector?: string;
        text?: string;
        submit?: boolean;
        direction?: string;
        amount?: number;
        value?: string;
      },
    );
  });
  ipcMain.handle(
    "executor-approval-response",
    (e, requestId: string, approved: boolean) => {
      const key = String(requestId || "").trim();
      if (!key) return { ok: false, error: "Missing request id" };
      const pending = pendingApprovals.get(key);
      if (!pending) return { ok: false, error: "Approval request not found" };
      if (pending.senderId !== e.sender.id) {
        return { ok: false, error: "Approval sender mismatch" };
      }
      pendingApprovals.delete(key);
      clearTimeout(pending.timeout);
      pending.resolve(Boolean(approved));
      return { ok: true };
    },
  );
  ipcMain.handle(
    "executor-run",
    async (_e, goal: string, plan: ExecutionPlanStep[] = []) => {
      return runExecutionPlan(_e.sender, String(goal || ""), plan || []);
    },
  );
  ipcMain.handle("get-ai-config", () => runtimeAiConfig);
  ipcMain.handle(
    "step-titles",
    async (
      _e,
      goal: string,
      plan: ExecutionPlanStep[] = [],
      apiKeyOverride?: string,
    ) => {
      const key = (apiKeyOverride || runtimeAiConfig.geminiApiKey || "").trim();
      if (!key) return null;
      try {
        return await generateFriendlyStepTitles(
          String(goal || ""),
          Array.isArray(plan) ? plan : [],
          key,
          runtimeAiConfig.model,
        );
      } catch (err) {
        console.error("[OpenBrowser] Step title generation failed:", err);
        return null;
      }
    },
  );
  ipcMain.handle("projects-list", () => listProjects(userDataPath));
  ipcMain.handle("projects-save", (_e, data: unknown) => {
    try {
      return saveProject(
        userDataPath,
        data as Parameters<typeof saveProject>[1],
      );
    } catch (err) {
      console.error("[OpenBrowser] Save project failed:", err);
      throw err;
    }
  });
  ipcMain.handle("projects-load", (_e, id: string) =>
    loadProject(userDataPath, id),
  );
  ipcMain.handle("projects-delete", (_e, id: string) =>
    deleteProject(userDataPath, id),
  );
  ipcMain.handle(
    "plan",
    async (
      _e,
      goal: string,
      providerOverride?: string,
      apiKeyOverride?: string,
    ) => {
      const cfg = runtimeAiConfig;
      const provider = (providerOverride || cfg.provider) as AiProvider;
      if (provider === "heuristic") return null;

      try {
        if (provider === "gemini") {
          const key = (apiKeyOverride || cfg.geminiApiKey)?.trim();
          if (!key) throw new Error("Gemini API key required");
          return await planWithGemini(goal, key, cfg.model);
        }
        if (provider === "ollama") {
          return await planWithOllama(goal, cfg.ollamaBaseUrl, cfg.model);
        }
      } catch (err) {
        console.error("[OpenBrowser] Plan failed:", err);
        throw err;
      }
      return null;
    },
  );
}

app.whenReady().then(async () => {
  // Use persistent user data for profile
  app.setPath("userData", userDataPath);
  const storedProfilesState = readStoredProfilesState();
  applyStoredProfilesState(storedProfilesState);
  writeStoredProfilesState(
    storedProfilesState.profiles,
    storedProfilesState.activeProfileId,
  );
  const storedAiConfig = readStoredAiConfig();
  if (storedAiConfig) applyStoredAiConfig(storedAiConfig);

  setupIPC();

  // Start bridge server for extension <-> runtime communication
  bridgeServer = createServer();
  await bridgeServer.start();

  createWindow();
});

app.on("window-all-closed", () => {
  bridgeServer?.stop();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  setupIPC();
  if (mainWindow === null) createWindow();
});
