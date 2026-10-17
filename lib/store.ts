import { promises as fs } from "node:fs";
import path from "node:path";
import { newId } from "./id";
import type { Job, Project } from "./types";

export const DATA_DIR = path.resolve(
  /*turbopackIgnore: true*/ process.env.BINGKAI_DATA_DIR ?? path.join(process.cwd(), "data"),
);

export { newId };
const now = () => new Date().toISOString();

export const projectDir = (id: string) => {
  if (!/^[a-f0-9]{12}$/.test(id)) throw new Error("Invalid project id");
  return path.join(DATA_DIR, "projects", id);
};
export const mediaDir = (id: string) => path.join(projectDir(id), "media");
export const proxyDir = (id: string) => path.join(projectDir(id), "proxies");
export const renderDir = (id: string) => path.join(projectDir(id), "render");
const projectFile = (id: string) => path.join(projectDir(id), "project.json");

export const idleJob = (): Job => ({ state: "idle", message: "", updatedAt: now() });

export async function createProject(name: string, coupleName: string): Promise<Project> {
  const project: Project = {
    id: newId(),
    name: name.trim() || "Untitled wedding",
    coupleName: coupleName.trim(),
    createdAt: now(),
    media: [],
    spine: null,
    warnings: [],
    analysis: idleJob(),
    render: { ...idleJob(), outputPath: null },
    settings: { mediaRoot: "" },
  };
  await fs.mkdir(mediaDir(project.id), { recursive: true });
  await writeProject(project);
  return project;
}

export async function readProject(id: string): Promise<Project | null> {
  try {
    return JSON.parse(await fs.readFile(projectFile(id), "utf8")) as Project;
  } catch {
    return null;
  }
}

export async function writeProject(project: Project): Promise<void> {
  const file = projectFile(project.id);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(project, null, 2));
  await fs.rename(tmp, file);
}

// Background jobs and request handlers both mutate project.json; serialise per project.
const locks = new Map<string, Promise<unknown>>();

export async function updateProject(
  id: string,
  mutate: (p: Project) => void | Promise<void>,
): Promise<Project> {
  const prev = locks.get(id) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    const project = await readProject(id);
    if (!project) throw new Error("Project not found");
    await mutate(project);
    await writeProject(project);
    return project;
  });
  locks.set(id, next);
  try {
    return await next;
  } finally {
    if (locks.get(id) === next) locks.delete(id);
  }
}

export async function listProjects(): Promise<Project[]> {
  const root = path.join(DATA_DIR, "projects");
  let ids: string[] = [];
  try {
    ids = await fs.readdir(root);
  } catch {
    return [];
  }
  const projects = await Promise.all(ids.filter((i) => /^[a-f0-9]{12}$/.test(i)).map(readProject));
  return projects
    .filter((p): p is Project => p !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteProject(id: string): Promise<void> {
  await fs.rm(projectDir(id), { recursive: true, force: true });
}

export const setJob = (job: Job, state: Job["state"], message: string) => {
  job.state = state;
  job.message = message;
  job.updatedAt = now();
};
