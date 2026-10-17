import { NextResponse } from "next/server";
import { jsonError, loadProject, type IdParams } from "@/lib/http";
import { prepareMedia } from "@/lib/jobs";
import { normalizeSpine } from "@/lib/spine";
import { readProject, updateProject } from "@/lib/store";

export const runtime = "nodejs";

/** Import spine JSON in the PRD schema (pasted by the editor, or produced elsewhere). */
export async function POST(req: Request, { params }: IdParams) {
  const project = await loadProject(params);
  if (project instanceof NextResponse) return project;
  const text = await req.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return jsonError("That is not valid JSON");
  }
  // Pause detection is needed to snap cuts onto breaths.
  for (const m of project.media) if (!m.silences) await prepareMedia(project.id, m.id).catch(() => {});
  const fresh = (await readProject(project.id))!;
  const snap = new URL(req.url).searchParams.get("snap") !== "0";
  let result;
  try {
    result = normalizeSpine(raw, fresh.media, { snap, coupleName: fresh.coupleName });
  } catch (err) {
    return jsonError((err as Error).message);
  }
  if (result.spine.spine_sequence.length === 0) {
    return jsonError(`No usable items. ${result.warnings.join(" ")}`, 422);
  }
  const updated = await updateProject(project.id, (p) => {
    p.spine = result.spine;
    p.warnings = result.warnings;
  });
  return NextResponse.json({ project: updated });
}
