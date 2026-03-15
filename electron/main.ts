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
import { planWithOllama } from "./ollama-planner";
import { executeInPage } from "./browser-executor";
import {
  listProjects,
  saveProject,
  loadProject,
  deleteProject,
  type SavedProject,
} from "./project-store";

const isDev = process.env.NODE_ENV === "development";
const userDataPath = path.join(app.getPath("userData"), "open-browser");
const projectRoot = path.join(__dirname, "..", "..");
const extensionPath = path.join(projectRoot, "extension");
const configFilePath = path.join(userDataPath, "config.json");
const SIDEBAR_EXPANDED = 320;
const SIDEBAR_COLLAPSED = 52;
/* Match address bar visual height: 12px padding-top + 38px bar + 20px margin-bottom = 70 */
const URL_BAR_HEIGHT = 72;

let mainWindow: BrowserWindow | null = null;
let sidebarWidth = SIDEBAR_EXPANDED;
let browserView: BrowserView | null = null;
let bridgeServer: ReturnType<typeof createServer> | null = null;
let extensionLoaded = false;
let runtimeAiConfig = getAiConfig();

interface StoredAiConfig {
  aiProvider: AiProvider;
  geminiApiKey: string;
  model?: string;
}

function toAiProvider(value: unknown): AiProvider | null {
  if (value === "gemini" || value === "ollama" || value === "heuristic")
    return value;
  return null;
}

function readStoredAiConfig(): StoredAiConfig | null {
  if (!fs.existsSync(configFilePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(configFilePath, "utf-8")) as {
      aiProvider?: unknown;
      geminiApiKey?: unknown;
      model?: unknown;
    };
    const aiProvider = toAiProvider(raw.aiProvider);
    if (!aiProvider) return null;
    return {
      aiProvider,
      geminiApiKey: String(raw.geminiApiKey || "").trim(),
      model: raw.model ? String(raw.model).trim() : undefined,
    };
  } catch {
    return null;
  }
}

function writeStoredAiConfig(config: StoredAiConfig) {
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2), "utf-8");
}

function applyStoredAiConfig(config: StoredAiConfig) {
  runtimeAiConfig = {
    ...runtimeAiConfig,
    provider: config.aiProvider,
    geminiApiKey: config.geminiApiKey.trim(),
    model: config.model?.trim() || runtimeAiConfig.model,
  };
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

function createBrowserView(win: BrowserWindow) {
  const ses = session.fromPartition(PERSISTENT_PARTITION);
  browserView = new BrowserView({
    webPreferences: {
      partition: PERSISTENT_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setBrowserView(browserView);
  updateBrowserViewBounds(win);
  browserView.webContents.loadURL("https://www.google.com");

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

const PERSISTENT_PARTITION = "persist:openbrowser";

async function loadExtension() {
  await app.whenReady();
  const ses = session.fromPartition(PERSISTENT_PARTITION);

  try {
    const ext = await ses.loadExtension(extensionPath, {
      allowFileAccess: true,
    });
    console.log("[OpenBrowser] Extension loaded:", ext.id, ext.name);
    return true;
  } catch (err) {
    console.error("[OpenBrowser] Failed to load extension:", err);
    return false;
  }
}

async function startMainInterface() {
  if (!mainWindow) return { started: false };
  if (!extensionLoaded) {
    extensionLoaded = await loadExtension();
  }
  if (!browserView) {
    createBrowserView(mainWindow);
  }
  return { started: true };
}

function setupIPC() {
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
  ipcMain.handle("get-webview-partition", () => PERSISTENT_PARTITION);
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
  ipcMain.handle("start-main-interface", async () => startMainInterface());
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
  ipcMain.handle("get-ai-config", () => runtimeAiConfig);
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
  const storedAiConfig = readStoredAiConfig();
  if (storedAiConfig) applyStoredAiConfig(storedAiConfig);

  // Start bridge server for extension <-> runtime communication
  bridgeServer = createServer();
  await bridgeServer.start();

  setupIPC();
  createWindow();
});

app.on("window-all-closed", () => {
  bridgeServer?.stop();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (mainWindow === null) createWindow();
});
