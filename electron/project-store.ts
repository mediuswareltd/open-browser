/**
 * OpenBrowser - Project storage
 * Saves/loads projects as JSON files in userData/projects/
 */

import * as fs from "fs";
import * as path from "path";

export interface SavedProject {
  id: string;
  name: string;
  goal: string;
  plan: Array<{ action: Record<string, unknown>; requiresApproval?: boolean }>;
  trace: Array<{ time: string; msg: string; kind: string }>;
  aiProvider: string;
  createdAt: number;
  updatedAt: number;
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
      const data = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
      projects.push(data);
    } catch (_) {}
  }
  projects.sort((a, b) => b.updatedAt - a.updatedAt);
  return projects;
}

export function saveProject(
  userDataPath: string,
  project: Omit<SavedProject, "createdAt" | "updatedAt"> & { id?: string }
): SavedProject {
  const dir = getProjectsDir(userDataPath);
  const now = Date.now();
  const id = (project.id && String(project.id).trim()) || `p-${now}-${Math.random().toString(36).slice(2, 9)}`;
  const existing = listProjects(userDataPath).find((p) => p.id === id);
  const full: SavedProject = {
    id,
    name: String(project.name || project.goal?.slice(0, 50) || "Untitled").trim() || "Untitled",
    goal: String(project.goal || "").trim(),
    plan: Array.isArray(project.plan) ? project.plan : [],
    trace: Array.isArray(project.trace) ? project.trace : [],
    aiProvider: String(project.aiProvider || "heuristic"),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const filePath = projectPath(dir, id);
  fs.writeFileSync(filePath, JSON.stringify(full, null, 2), "utf-8");
  return full;
}

export function loadProject(userDataPath: string, id: string): SavedProject | null {
  const dir = getProjectsDir(userDataPath);
  const file = projectPath(dir, id);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
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
