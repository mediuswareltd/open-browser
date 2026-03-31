/**
 * OpenBrowser - Project storage
 * Saves/loads projects as JSON files in userData/projects/
 */

import * as fs from "fs";
import * as path from "path";

export interface SavedTraceEntry {
  time: string;
  msg: string;
  kind: string;
}

export interface SavedStructuredStep {
  id: string;
  title: string;
  status: "pending" | "running" | "done" | "failed";
  startedAt?: number;
  completedAt?: number;
  error?: string;
  actionId?: string;
}

export interface SavedStructuredRun {
  id: string;
  prompt: string;
  createdAt: number;
  steps: SavedStructuredStep[];
  logs: SavedTraceEntry[];
  result: {
    status: string;
    message: string;
  };
}

export interface SavedTab {
  id: string;
  name: string;
  prompt: string;
  logs: SavedTraceEntry[];
  latestRun?: SavedStructuredRun | null;
}

export interface SavedProject {
  id: string;
  name: string;
  goal: string;
  plan: Array<{ action: Record<string, unknown>; requiresApproval?: boolean }>;
  trace: SavedTraceEntry[];
  tabs: SavedTab[];
  activeTabId: string;
  aiProvider: string;
  createdAt: number;
  updatedAt: number;
}

function makeTabId(): string {
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeTrace(trace: unknown): SavedTraceEntry[] {
  if (!Array.isArray(trace)) return [];
  return trace.map((entry) => ({
    time: String((entry as SavedTraceEntry)?.time || ""),
    msg: String((entry as SavedTraceEntry)?.msg || ""),
    kind: String((entry as SavedTraceEntry)?.kind || "info"),
  }));
}

function normalizeStepStatus(value: unknown): SavedStructuredStep["status"] {
  if (
    value === "pending" ||
    value === "running" ||
    value === "done" ||
    value === "failed"
  ) {
    return value;
  }
  return "pending";
}

function normalizeStructuredRun(run: unknown): SavedStructuredRun | null {
  if (!run || typeof run !== "object") return null;
  const raw = run as {
    id?: unknown;
    prompt?: unknown;
    createdAt?: unknown;
    steps?: unknown;
    logs?: unknown;
    result?: unknown;
  };
  const steps = Array.isArray(raw.steps)
    ? raw.steps.map((step, idx) => {
        const s = (step || {}) as {
          id?: unknown;
          title?: unknown;
          status?: unknown;
          startedAt?: unknown;
          completedAt?: unknown;
          error?: unknown;
          actionId?: unknown;
        };
        return {
          id: String(s.id || `s-${idx + 1}`),
          title: String(s.title || `Step ${idx + 1}`),
          status: normalizeStepStatus(s.status),
          startedAt:
            typeof s.startedAt === "number" ? Number(s.startedAt) : undefined,
          completedAt:
            typeof s.completedAt === "number"
              ? Number(s.completedAt)
              : undefined,
          error: s.error ? String(s.error) : undefined,
          actionId: s.actionId ? String(s.actionId) : undefined,
        } as SavedStructuredStep;
      })
    : [];
  const resultRaw =
    raw.result && typeof raw.result === "object"
      ? (raw.result as { status?: unknown; message?: unknown })
      : {};
  return {
    id: String(raw.id || `r-${Date.now()}`),
    prompt: String(raw.prompt || ""),
    createdAt:
      typeof raw.createdAt === "number" ? Number(raw.createdAt) : Date.now(),
    steps,
    logs: normalizeTrace(raw.logs),
    result: {
      status: String(resultRaw.status || "pending"),
      message: String(resultRaw.message || ""),
    },
  };
}

function defaultTabFromLegacy(
  goal: string,
  trace: SavedTraceEntry[],
  existingTabs: SavedTab[],
): SavedTab {
  const suffix = existingTabs.length > 0 ? ` ${existingTabs.length + 1}` : "";
  return {
    id: makeTabId(),
    name: `New Task${suffix}`,
    prompt: goal,
    logs: trace,
    latestRun: null,
  };
}

function normalizeTabs(
  tabs: unknown,
  legacyGoal: string,
  legacyTrace: SavedTraceEntry[],
): SavedTab[] {
  if (!Array.isArray(tabs) || tabs.length === 0) {
    return [defaultTabFromLegacy(legacyGoal, legacyTrace, [])];
  }
  const normalized = tabs.map((tab, idx) => {
    const t = (tab || {}) as {
      id?: unknown;
      name?: unknown;
      prompt?: unknown;
      logs?: unknown;
    };
    return {
      id: String(t.id || makeTabId()).trim() || makeTabId(),
      name:
        String(t.name || `New Task ${idx + 1}`).trim() || `New Task ${idx + 1}`,
      prompt: String(t.prompt || ""),
      logs: normalizeTrace(t.logs),
      latestRun: normalizeStructuredRun(
        (t as { latestRun?: unknown }).latestRun,
      ),
    };
  });
  return normalized.length
    ? normalized
    : [defaultTabFromLegacy(legacyGoal, legacyTrace, normalized)];
}

function normalizeProject(
  raw: Partial<SavedProject> & { id?: string },
  fallbackId: string,
  fallbackCreatedAt: number,
  fallbackUpdatedAt: number,
): SavedProject {
  const goal = String(raw.goal || "").trim();
  const trace = normalizeTrace(raw.trace);
  const tabs = normalizeTabs(raw.tabs, goal, trace);
  let activeTabId = String(raw.activeTabId || "").trim();
  if (!activeTabId || !tabs.some((t) => t.id === activeTabId)) {
    activeTabId = tabs[0].id;
  }
  const activeIndex = tabs.findIndex((t) => t.id === activeTabId);
  if (
    activeIndex >= 0 &&
    (typeof raw.goal !== "undefined" || Array.isArray(raw.trace))
  ) {
    tabs[activeIndex] = {
      ...tabs[activeIndex],
      prompt: goal,
      logs: trace,
    };
  }
  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];
  return {
    id: String(raw.id || fallbackId).trim() || fallbackId,
    name:
      String(raw.name || activeTab.prompt?.slice(0, 50) || "Untitled").trim() ||
      "Untitled",
    goal: String(activeTab.prompt || "").trim(),
    plan: Array.isArray(raw.plan) ? raw.plan : [],
    trace: normalizeTrace(activeTab.logs),
    tabs,
    activeTabId,
    aiProvider: String(raw.aiProvider || "heuristic"),
    createdAt:
      typeof raw.createdAt === "number" ? raw.createdAt : fallbackCreatedAt,
    updatedAt:
      typeof raw.updatedAt === "number" ? raw.updatedAt : fallbackUpdatedAt,
  };
}

function getProjectsDir(userDataPath: string): string {
  const dir = path.join(userDataPath, "projects");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function projectPath(dir: string, id: string): string {
  return path.join(dir, `${id}.json`);
}

export function listProjects(userDataPath: string): SavedProject[] {
  const dir = getProjectsDir(userDataPath);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const projects: SavedProject[] = [];
  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as
        | Partial<SavedProject>
        | undefined;
      const fileId = path.basename(f, ".json");
      const normalized = normalizeProject(
        data || {},
        fileId,
        Date.now(),
        Date.now(),
      );
      projects.push(normalized);
    } catch (_) {}
  }
  projects.sort((a, b) => b.updatedAt - a.updatedAt);
  return projects;
}

export function saveProject(
  userDataPath: string,
  project: Omit<SavedProject, "createdAt" | "updatedAt"> & { id?: string },
): SavedProject {
  const dir = getProjectsDir(userDataPath);
  const now = Date.now();
  const id =
    (project.id && String(project.id).trim()) ||
    `p-${now}-${Math.random().toString(36).slice(2, 9)}`;
  const existing = listProjects(userDataPath).find((p) => p.id === id);
  const full = normalizeProject(project, id, existing?.createdAt ?? now, now);
  full.updatedAt = now;
  const filePath = projectPath(dir, id);
  fs.writeFileSync(filePath, JSON.stringify(full, null, 2), "utf-8");
  return full;
}

export function loadProject(
  userDataPath: string,
  id: string,
): SavedProject | null {
  const dir = getProjectsDir(userDataPath);
  const file = projectPath(dir, id);
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf-8")) as
      | Partial<SavedProject>
      | undefined;
    return normalizeProject(data || {}, id, Date.now(), Date.now());
  } catch {
    return null;
  }
}

export function deleteProject(userDataPath: string, id: string): boolean {
  const dir = getProjectsDir(userDataPath);
  const file = projectPath(dir, id);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    return true;
  }
  return false;
}
