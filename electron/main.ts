/**
 * OpenBrowser - Electron Main Process
 * Persistent profile, extension loading, IPC bridge, WebSocket server for extension
 */

import "dotenv/config";
import { app, BrowserWindow, BrowserView, session, ipcMain } from "electron";
import * as path from "path";
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
const SIDEBAR_WIDTH = 320;
const URL_BAR_HEIGHT = 50;

let mainWindow: BrowserWindow | null = null;
let browserView: BrowserView | null = null;
let bridgeServer: ReturnType<typeof createServer> | null = null;

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
    x: SIDEBAR_WIDTH,
    y: URL_BAR_HEIGHT,
    width: Math.max(0, w - SIDEBAR_WIDTH),
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

  mainWindow.webContents.on("did-finish-load", () => {
    createBrowserView(mainWindow!);
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
  } catch (err) {
    console.error("[OpenBrowser] Failed to load extension:", err);
  }
}

function setupIPC() {
  ipcMain.handle("get-bridge-port", () => bridgeServer?.port ?? 0);
  ipcMain.handle("get-user-data-path", () => userDataPath);
  ipcMain.handle("get-webview-partition", () => PERSISTENT_PARTITION);
  ipcMain.handle("browser-navigate", (_e, url: string) => {
    browserView?.webContents.loadURL(url);
  });
  ipcMain.handle("browser-get-url", () => {
    return browserView?.webContents.getURL() ?? "";
  });
  ipcMain.handle("browser-execute-action", async (_e, action: unknown) => {
    if (!browserView?.webContents) return { success: false, error: "No browser view" };
    return executeInPage(browserView.webContents, action as { id: string; type: string; selector?: string; text?: string; submit?: boolean; direction?: string; amount?: number; value?: string });
  });
  ipcMain.handle("get-ai-config", () => getAiConfig());
  ipcMain.handle("projects-list", () => listProjects(userDataPath));
  ipcMain.handle("projects-save", (_e, data: unknown) => {
    try {
      return saveProject(userDataPath, data as Parameters<typeof saveProject>[1]);
    } catch (err) {
      console.error("[OpenBrowser] Save project failed:", err);
      throw err;
    }
  });
  ipcMain.handle("projects-load", (_e, id: string) =>
    loadProject(userDataPath, id)
  );
  ipcMain.handle("projects-delete", (_e, id: string) =>
    deleteProject(userDataPath, id)
  );
  ipcMain.handle(
    "plan",
    async (_e, goal: string, providerOverride?: string, apiKeyOverride?: string) => {
      const cfg = getAiConfig();
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
    }
  );
}

app.whenReady().then(async () => {
  // Use persistent user data for profile
  app.setPath("userData", userDataPath);

  // Start bridge server for extension <-> runtime communication
  bridgeServer = createServer();
  await bridgeServer.start();

  setupIPC();
  await loadExtension();
  createWindow();
});

app.on("window-all-closed", () => {
  bridgeServer?.stop();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (mainWindow === null) createWindow();
});
