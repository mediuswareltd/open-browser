/**
 * OpenBrowser - Project storage
 * Saves/loads projects as JSON files in userData/projects/
 */

import * as fs from "fs";
import * as path from "path";

const DEFAULT_PROJECT_NAME = "New Project";
const DEFAULT_TASK_TITLE = "New Task";
const TASK_TITLE_MAX = 100;

export interface PromptEntry {
  id: string;
  prompt: string;
  createdAt: number;
}

export interface ProjectTask {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  promptHistory: PromptEntry[];
  children: string[];
}

export interface StoredProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  tasks: ProjectTask[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  taskCount: number;
}

function getProjectsDir(userDataPath: string): string {
  const dir = path.join(userDataPath, "projects");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function projectPath(dir: string, id: string): string {
  return path.join(dir, `${id}.json`);
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function titleFromPrompt(prompt: string): string {
  const firstLine = String(prompt || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return DEFAULT_TASK_TITLE;
  if (firstLine.length <= TASK_TITLE_MAX) return firstLine;
  return `${firstLine.slice(0, TASK_TITLE_MAX - 3).trim()}...`;
}

function normalizeTask(
  value: unknown,
  now: number,
  fallbackTitle: string = DEFAULT_TASK_TITLE,
): ProjectTask {
  const raw = (value || {}) as Record<string, unknown>;
  const createdAt = typeof raw.createdAt === "number" ? raw.createdAt : now;
  const updatedAt =
    typeof raw.updatedAt === "number" ? raw.updatedAt : createdAt;
  const promptHistoryRaw = Array.isArray(raw.promptHistory)
    ? raw.promptHistory
    : [];
  const promptHistory: PromptEntry[] = promptHistoryRaw
    .map((entry) => {
      const e = (entry || {}) as Record<string, unknown>;
      const prompt = String(e.prompt || "").trim();
      if (!prompt) return null;
      return {
        id:
          typeof e.id === "string" && e.id.trim()
            ? e.id.trim()
            : makeId("prompt"),
        prompt,
        createdAt: typeof e.createdAt === "number" ? e.createdAt : now,
      };
    })
    .filter((entry): entry is PromptEntry => Boolean(entry));
  const childrenRaw = Array.isArray(raw.children) ? raw.children : [];
  const children = childrenRaw
    .map((id) => String(id || "").trim())
    .filter(Boolean);
  const taskTitle = String(raw.title || "").trim();
  const fallbackFromPrompt = promptHistory[0]
    ? titleFromPrompt(promptHistory[0].prompt)
    : fallbackTitle;
  return {
    id:
      typeof raw.id === "string" && raw.id.trim()
        ? raw.id.trim()
        : makeId("task"),
    title: taskTitle || fallbackFromPrompt || DEFAULT_TASK_TITLE,
    createdAt,
    updatedAt,
    promptHistory,
    children,
  };
}

function createDefaultTask(now: number): ProjectTask {
  return {
    id: makeId("task"),
    title: DEFAULT_TASK_TITLE,
    createdAt: now,
    updatedAt: now,
    promptHistory: [],
    children: [],
  };
}

function normalizeProject(value: unknown, fileId = ""): StoredProject | null {
  const raw = (value || {}) as Record<string, unknown>;
  const now = Date.now();
  const id =
    (typeof raw.id === "string" && raw.id.trim()) ||
    fileId ||
    makeId("project");
  const createdAt = typeof raw.createdAt === "number" ? raw.createdAt : now;
  const updatedAt =
    typeof raw.updatedAt === "number" ? raw.updatedAt : createdAt;
  const oldGoal = String(raw.goal || "").trim();

  const tasksRaw = Array.isArray(raw.tasks) ? raw.tasks : [];
  const tasks = tasksRaw.map((task) =>
    normalizeTask(
      task,
      now,
      oldGoal ? titleFromPrompt(oldGoal) : DEFAULT_TASK_TITLE,
    ),
  );

  if (!tasks.length && oldGoal) {
    const task = createDefaultTask(now);
    task.title = titleFromPrompt(oldGoal);
    task.promptHistory = [
      {
        id: makeId("prompt"),
        prompt: oldGoal,
        createdAt: now,
      },
    ];
    tasks.push(task);
  }

  return {
    id,
    name:
      String(raw.name || "").trim() ||
      (oldGoal ? titleFromPrompt(oldGoal) : DEFAULT_PROJECT_NAME),
    createdAt,
    updatedAt,
    tasks,
  };
}

function readProject(filePath: string): StoredProject | null {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const fileId = path.basename(filePath, ".json");
    return normalizeProject(raw, fileId);
  } catch {
    return null;
  }
}

function writeProject(
  userDataPath: string,
  project: StoredProject,
): StoredProject {
  const dir = getProjectsDir(userDataPath);
  const filePath = projectPath(dir, project.id);
  fs.writeFileSync(filePath, JSON.stringify(project, null, 2), "utf-8");
  return project;
}

export function listProjects(userDataPath: string): ProjectSummary[] {
  const dir = getProjectsDir(userDataPath);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const projects: ProjectSummary[] = [];
  for (const f of files) {
    const project = readProject(path.join(dir, f));
    if (!project) continue;
    projects.push({
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      taskCount: project.tasks.length,
    });
  }
  projects.sort((a, b) => b.updatedAt - a.updatedAt);
  return projects;
}

export function createProject(
  userDataPath: string,
  name: string = DEFAULT_PROJECT_NAME,
): StoredProject {
  const now = Date.now();
  const project: StoredProject = {
    id: makeId("project"),
    name: String(name || "").trim() || DEFAULT_PROJECT_NAME,
    createdAt: now,
    updatedAt: now,
    tasks: [createDefaultTask(now)],
  };
  return writeProject(userDataPath, project);
}

export function loadProject(
  userDataPath: string,
  id: string,
): StoredProject | null {
  const dir = getProjectsDir(userDataPath);
  const file = projectPath(dir, id);
  if (!fs.existsSync(file)) return null;
  return readProject(file);
}

export function renameProject(
  userDataPath: string,
  id: string,
  name: string,
): StoredProject | null {
  const project = loadProject(userDataPath, id);
  if (!project) return null;
  const nextName = String(name || "").trim();
  if (!nextName) return project;
  project.name = nextName;
  project.updatedAt = Date.now();
  return writeProject(userDataPath, project);
}

export function createTask(
  userDataPath: string,
  projectId: string,
): StoredProject | null {
  const project = loadProject(userDataPath, projectId);
  if (!project) return null;
  const now = Date.now();
  project.tasks.push(createDefaultTask(now));
  project.updatedAt = now;
  return writeProject(userDataPath, project);
}

export function renameTask(
  userDataPath: string,
  projectId: string,
  taskId: string,
  title: string,
): StoredProject | null {
  const project = loadProject(userDataPath, projectId);
  if (!project) return null;
  const task = project.tasks.find((item) => item.id === taskId);
  if (!task) return project;
  const nextTitle = String(title || "").trim();
  if (!nextTitle) return project;
  const now = Date.now();
  task.title = nextTitle;
  task.updatedAt = now;
  project.updatedAt = now;
  return writeProject(userDataPath, project);
}

export function deleteTask(
  userDataPath: string,
  projectId: string,
  taskId: string,
): StoredProject | null {
  const project = loadProject(userDataPath, projectId);
  if (!project) return null;
  const before = project.tasks.length;
  project.tasks = project.tasks.filter((item) => item.id !== taskId);
  if (project.tasks.length === before) return project;
  project.updatedAt = Date.now();
  return writeProject(userDataPath, project);
}

export function addTaskPrompt(
  userDataPath: string,
  projectId: string,
  taskId: string,
  prompt: string,
): StoredProject | null {
  const project = loadProject(userDataPath, projectId);
  if (!project) return null;
  const task = project.tasks.find((item) => item.id === taskId);
  if (!task) return project;

  const cleaned = String(prompt || "").trim();
  if (!cleaned) return project;

  const now = Date.now();
  task.promptHistory.push({
    id: makeId("prompt"),
    prompt: cleaned,
    createdAt: now,
  });
  if (!task.title || task.title === DEFAULT_TASK_TITLE) {
    task.title = titleFromPrompt(cleaned);
  }
  task.updatedAt = now;
  project.updatedAt = now;
  return writeProject(userDataPath, project);
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
