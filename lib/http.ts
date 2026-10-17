import { NextResponse } from "next/server";
import { readProject } from "./store";
import type { Project } from "./types";

export type IdParams = { params: Promise<{ id: string }> };

export const jsonError = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export async function loadProject(params: Promise<{ id: string }>): Promise<Project | NextResponse> {
  const { id } = await params;
  if (!/^[a-f0-9]{12}$/.test(id)) return jsonError("Invalid project id", 400);
  const project = await readProject(id);
  return project ?? jsonError("Project not found", 404);
}

/** A job is considered abandoned if the server restarted mid-run. */
export const isStale = (updatedAt: string) => Date.now() - Date.parse(updatedAt) > 15 * 60_000;

export const safeFilename = (name: string) =>
  name.replace(/[\\/]/g, "_").replace(/[\u0000-\u001f]/g, "").replace(/^\.+/, "").slice(0, 200) || "file";
