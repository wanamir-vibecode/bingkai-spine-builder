import { NextResponse } from "next/server";
import { jsonError, loadProject, type IdParams } from "@/lib/http";
import { buildPremiereXml } from "@/lib/xml";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: IdParams) {
  const project = await loadProject(params);
  if (project instanceof NextResponse) return project;
  if (!project.spine?.spine_sequence.length) return jsonError("Build a spine first");
  const mediaRoot = new URL(req.url).searchParams.get("mediaRoot") ?? project.settings.mediaRoot;
  const xml = buildPremiereXml(project.spine, project.media, { mediaRoot });
  const base = (project.coupleName || project.name).replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") || "spine";
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${base}_Audio_Spine.xml"`,
    },
  });
}
