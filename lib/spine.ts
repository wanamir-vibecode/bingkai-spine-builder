import { newId } from "./id";
import { secondsToTimecode, timecodeToSeconds } from "./timecode";
import {
  ACTS,
  GAP_MAX,
  GAP_MIN,
  SPOKEN_MAX,
  SPOKEN_MIN,
  type ClipItem,
  type GapItem,
  type MediaFile,
  type SilenceSpan,
  type Spine,
  type SpineItem,
} from "./types";

const SNAP_WINDOW = 0.6;
const IN_HANDLE = 0.12;
const OUT_HANDLE = 0.2;
const MIN_CLIP = 0.5;

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function findMedia(media: MediaFile[], name: string | undefined): MediaFile | undefined {
  if (!name) return media.length === 1 ? media[0] : undefined;
  const lower = name.trim().toLowerCase();
  const stem = (s: string) => s.toLowerCase().replace(/\.[^.]+$/, "");
  return (
    media.find((m) => m.filename === name) ??
    media.find((m) => m.filename.toLowerCase() === lower) ??
    media.find((m) => stem(m.filename) === stem(lower)) ??
    media.find((m) => lower.includes(stem(m.filename)))
  );
}

/** Move a cut onto the nearest natural pause so it lands on a breath, not mid-word. */
export function snapToPause(seconds: number, silences: SilenceSpan[] | null, edge: "in" | "out"): number {
  if (!silences?.length) return seconds;
  let best: number | null = null;
  let bestDist = SNAP_WINDOW;
  for (const s of silences) {
    const anchor = edge === "in" ? s.end : s.start;
    const dist = Math.abs(anchor - seconds);
    if (dist <= bestDist) {
      bestDist = dist;
      best = edge === "in" ? Math.max(s.start, s.end - IN_HANDLE) : Math.min(s.end, s.start + OUT_HANDLE);
    }
  }
  return best ?? seconds;
}

type RawItem = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);

function isGap(raw: RawItem): boolean {
  const t = str(raw.item_type).toLowerCase();
  return t.includes("gap") || t.includes("slug") || (!raw.source_filename && raw.gap_duration_seconds != null);
}

/**
 * Turn model output (or JSON pasted by the editor) into a validated spine.
 * Seconds are canonical; HH:MM:SS:FF is re-derived from them at each source's frame rate.
 */
export function normalizeSpine(
  raw: unknown,
  media: MediaFile[],
  opts: { snap?: boolean; coupleName?: string } = {},
): { spine: Spine; warnings: string[] } {
  const warnings: string[] = [];
  const obj = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown>;
  const rawItems = Array.isArray(obj?.spine_sequence) ? (obj.spine_sequence as RawItem[]) : Array.isArray(obj) ? (obj as RawItem[]) : null;
  if (!rawItems) throw new Error("JSON must contain a spine_sequence array");

  const sorted = [...rawItems].sort((a, b) => (num(a.sequence_order) || 0) - (num(b.sequence_order) || 0));
  const items: SpineItem[] = [];
  let lastAct: string = ACTS[0];

  sorted.forEach((r, idx) => {
    const label = `Item ${num(r.sequence_order) || idx + 1}`;
    const act = str(r.act) || lastAct;
    lastAct = act;

    if (isGap(r)) {
      let d = num(r.gap_duration_seconds);
      if (!Number.isFinite(d)) d = 6;
      if (d < GAP_MIN || d > GAP_MAX) warnings.push(`${label}: gap of ${d}s clamped to ${GAP_MIN}–${GAP_MAX}s.`);
      items.push({
        id: newId(),
        sequence_order: 0,
        act,
        item_type: "timeline_gap",
        gap_duration_seconds: clamp(d, GAP_MIN, GAP_MAX),
        premiere_marker_note: str(r.premiere_marker_note) || "DROP KILLER SHOT HERE",
      });
      return;
    }

    const m = findMedia(media, str(r.source_filename));
    if (!m) {
      warnings.push(`${label}: source "${str(r.source_filename)}" is not an uploaded file — dropped.`);
      return;
    }

    const resolve = (secKey: string, tcKey: string): number => {
      const s = num(r[secKey]);
      if (Number.isFinite(s)) return s;
      const tc = str(r[tcKey]);
      const parsed = tc ? timecodeToSeconds(tc, m.rate) : null;
      if (parsed?.clamped) warnings.push(`${label}: ${tcKey} "${tc}" has a frame count above ${m.rate.timebase - 1}; clamped.`);
      return parsed ? parsed.seconds : NaN;
    };
    let inS = resolve("in_seconds", "in_point");
    let outS = resolve("out_seconds", "out_point");
    if (!Number.isFinite(inS) || !Number.isFinite(outS)) {
      warnings.push(`${label}: missing or unreadable in/out point — dropped.`);
      return;
    }
    if (outS < inS) [inS, outS] = [outS, inS];
    if (opts.snap !== false) {
      inS = snapToPause(inS, m.silences, "in");
      outS = snapToPause(outS, m.silences, "out");
    }
    const maxT = m.durationSec || Infinity;
    inS = clamp(inS, 0, maxT);
    outS = clamp(outS, 0, maxT);
    if (outS - inS < MIN_CLIP) {
      warnings.push(`${label}: clip shorter than ${MIN_CLIP}s or outside the source duration — dropped.`);
      return;
    }

    items.push({
      id: newId(),
      sequence_order: 0,
      act,
      item_type: "a_roll_clip",
      speaker: str(r.speaker) || "Speaker",
      source_filename: m.filename,
      media_id: m.id,
      in_point: "",
      out_point: "",
      in_seconds: round3(inS),
      out_seconds: round3(outS),
      verbatim_quote: str(r.verbatim_quote),
      delivery_note: str(r.delivery_note),
    });
  });

  const spine = recompute(
    {
      couple_name: str(obj.couple_name) || opts.coupleName || "Bride & Groom",
      spoken_duration_seconds: 0,
      total_timeline_duration_seconds: 0,
      spine_sequence: items,
    },
    media,
  );
  return { spine, warnings: [...warnings, ...validateSpine(spine)] };
}

/** Re-number, re-derive timecodes and totals. Call after every edit. */
export function recompute(spine: Spine, media: MediaFile[]): Spine {
  let spoken = 0;
  let total = 0;
  const seq = spine.spine_sequence.map((item, i): SpineItem => {
    if (item.item_type === "timeline_gap") {
      const d = clamp(Number(item.gap_duration_seconds) || GAP_MIN, GAP_MIN, GAP_MAX);
      total += d;
      return { ...item, sequence_order: i + 1, gap_duration_seconds: d };
    }
    const m = media.find((x) => x.id === item.media_id);
    const dur = Math.max(0, item.out_seconds - item.in_seconds);
    spoken += dur;
    total += dur;
    return {
      ...item,
      sequence_order: i + 1,
      in_point: m ? secondsToTimecode(item.in_seconds, m.rate) : item.in_point,
      out_point: m ? secondsToTimecode(item.out_seconds, m.rate) : item.out_point,
    };
  });
  return {
    ...spine,
    spine_sequence: seq,
    spoken_duration_seconds: round3(spoken),
    total_timeline_duration_seconds: round3(total),
  };
}

export function validateSpine(spine: Spine): string[] {
  const w: string[] = [];
  const s = spine.spoken_duration_seconds;
  if (s < SPOKEN_MIN || s > SPOKEN_MAX)
    w.push(`Spoken audio totals ${s.toFixed(1)}s — target is ${SPOKEN_MIN}–${SPOKEN_MAX}s.`);
  const seq = spine.spine_sequence;
  for (let i = 1; i < seq.length; i++) {
    if (seq[i].item_type === "timeline_gap" && seq[i - 1].item_type === "timeline_gap")
      w.push(`Items ${i} and ${i + 1} are back-to-back gaps.`);
  }
  const acts = new Set(seq.filter((x) => x.item_type === "a_roll_clip").map((x) => x.act.slice(0, 5).toLowerCase()));
  for (const act of ACTS) if (!acts.has(act.slice(0, 5).toLowerCase())) w.push(`No clips in "${act}".`);
  return w;
}

export const isClip = (i: SpineItem): i is ClipItem => i.item_type === "a_roll_clip";
export const isGapItem = (i: SpineItem): i is GapItem => i.item_type === "timeline_gap";
