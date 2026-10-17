import { createReadStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { isStale, jsonError, loadProject, type IdParams } from "@/lib/http";
import { runRender } from "@/lib/jobs";
import { setJob, updateProject } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(_req: Request, { params }: IdParams) {
  const project = await loadProject(params);
  if (project instanceof NextResponse) return project;
  if (!project.spine?.spine_sequence.length) return jsonError("Build a spine first");
  if (project.render.state === "running" && !isStale(project.render.updatedAt)) {
    return jsonError("A render is already running", 409);
  }
  const updated = await updateProject(project.id, (p) => {
    setJob(p.render, "running", "Starting render");
    p.render.outputPath = null;
  });
  void runRender(project.id);
  return NextResponse.json({ project: updated }, { status: 202 });
}

export async function GET(_req: Request, { params }: IdParams) {
  const project = await loadProject(params);
  if (project instanceof NextResponse) return project;
  const file = project.render.outputPath;
  if (project.render.state !== "done" || !file) return jsonError("No rendered spine yet", 404);
  const stat = await fs.stat(file).catch(() => null);
  if (!stat) return jsonError("Rendered file is missing — render again", 404);
  const base = (project.coupleName || project.name).replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") || "spine";
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${base}_Spine_Preview.mp4"`,
    },
  });
}
