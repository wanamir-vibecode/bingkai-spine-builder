import { NextResponse } from "next/server";
import { createProject, listProjects } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  const projects = await listProjects();
  return NextResponse.json(
    projects.map((p) => ({
      id: p.id,
      name: p.name,
      coupleName: p.coupleName,
      createdAt: p.createdAt,
      mediaCount: p.media.length,
      hasSpine: Boolean(p.spine),
    })),
  );
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { name?: string; coupleName?: string };
  const project = await createProject(body.name ?? "", body.coupleName ?? "");
  return NextResponse.json(project, { status: 201 });
}
