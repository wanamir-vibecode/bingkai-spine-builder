import { NextResponse } from "next/server";
import { geminiConfigured } from "@/lib/ai/gemini";
import { isStale, jsonError, loadProject, type IdParams } from "@/lib/http";
import { runAnalysis } from "@/lib/jobs";
import { setJob, updateProject } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(_req: Request, { params }: IdParams) {
  const project = await loadProject(params);
  if (project instanceof NextResponse) return project;
  if (project.media.length === 0) return jsonError("Upload at least one speech, vow or interview file first");
  if (!geminiConfigured()) return jsonError("GEMINI_API_KEY is not set on the server. Add it to .env.local and restart.");
  if (project.analysis.state === "running" && !isStale(project.analysis.updatedAt)) {
    return jsonError("Story extraction is already running", 409);
  }
  const updated = await updateProject(project.id, (p) => setJob(p.analysis, "running", "Starting"));
  void runAnalysis(project.id);
  return NextResponse.json({ project: updated }, { status: 202 });
}
