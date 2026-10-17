import { NextResponse } from "next/server";
import { geminiConfigured, geminiModel } from "@/lib/ai/gemini";
import { jsonError, loadProject, type IdParams } from "@/lib/http";
import { recompute, validateSpine } from "@/lib/spine";
import { deleteProject, updateProject } from "@/lib/store";
import { GAP_MAX, GAP_MIN, type SpineItem } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: IdParams) {
  const project = await loadProject(params);
  if (project instanceof NextResponse) return project;
  return NextResponse.json({ project, engine: { configured: geminiConfigured(), model: geminiModel() } });
}

type PatchBody = {
  name?: string;
  coupleName?: string;
  settings?: { mediaRoot?: string };
  spine_sequence?: SpineItem[];
};

export async function PATCH(req: Request, { params }: IdParams) {
  const existing = await loadProject(params);
  if (existing instanceof NextResponse) return existing;
  const body = (await req.json().catch(() => null)) as PatchBody | null;
  if (!body) return jsonError("Invalid JSON body");

  const project = await updateProject(existing.id, (p) => {
    if (typeof body.name === "string") p.name = body.name.trim() || p.name;
    if (typeof body.coupleName === "string") {
      p.coupleName = body.coupleName.trim();
      if (p.spine) p.spine.couple_name = p.coupleName || p.spine.couple_name;
    }
    if (typeof body.settings?.mediaRoot === "string") p.settings.mediaRoot = body.settings.mediaRoot.trim();
    if (Array.isArray(body.spine_sequence) && p.spine) {
      const items: SpineItem[] = [];
      for (const raw of body.spine_sequence) {
        if (raw.item_type === "timeline_gap") {
          items.push({
            id: String(raw.id),
            sequence_order: 0,
            act: String(raw.act ?? ""),
            item_type: "timeline_gap",
            gap_duration_seconds: Math.min(GAP_MAX, Math.max(GAP_MIN, Number(raw.gap_duration_seconds) || GAP_MIN)),
            premiere_marker_note: String(raw.premiere_marker_note ?? ""),
          });
        } else if (raw.item_type === "a_roll_clip") {
          const m = p.media.find((x) => x.id === raw.media_id);
          if (!m) continue;
          const inS = Math.max(0, Number(raw.in_seconds));
          const outS = Math.min(m.durationSec || Infinity, Number(raw.out_seconds));
          if (!(outS - inS >= 0.2)) continue;
          items.push({
            id: String(raw.id),
            sequence_order: 0,
            act: String(raw.act ?? ""),
            item_type: "a_roll_clip",
            speaker: String(raw.speaker ?? ""),
            source_filename: m.filename,
            media_id: m.id,
            in_point: "",
            out_point: "",
            in_seconds: Math.round(inS * 1000) / 1000,
            out_seconds: Math.round(outS * 1000) / 1000,
            verbatim_quote: String(raw.verbatim_quote ?? ""),
            delivery_note: String(raw.delivery_note ?? ""),
          });
        }
      }
      p.spine = recompute({ ...p.spine, spine_sequence: items }, p.media);
      p.warnings = validateSpine(p.spine);
    }
  });
  return NextResponse.json({ project });
}

export async function DELETE(_req: Request, { params }: IdParams) {
  const project = await loadProject(params);
  if (project instanceof NextResponse) return project;
  await deleteProject(project.id);
  return NextResponse.json({ ok: true });
}
