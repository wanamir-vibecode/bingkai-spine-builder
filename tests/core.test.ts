import { describe, expect, it } from "vitest";
import {
  framesToTimecode,
  parseTimecode,
  rateFromFps,
  secondsToFrames,
  secondsToTimecode,
  timecodeToSeconds,
} from "@/lib/timecode";
import { normalizeSpine, recompute, snapToPause } from "@/lib/spine";
import { buildPremiereXml, toPathUrl } from "@/lib/xml";
import type { MediaFile } from "@/lib/types";

const media = (over: Partial<MediaFile> = {}): MediaFile => ({
  id: "aaaaaaaaaaaa",
  filename: "A7IV_Speech_01.MP4",
  storedPath: "/data/media/aaaaaaaaaaaa.MP4",
  sizeBytes: 1,
  durationSec: 600,
  hasVideo: true,
  width: 3840,
  height: 2160,
  fps: 25,
  rate: { timebase: 25, ntsc: false },
  audioChannels: 2,
  sampleRate: 48000,
  startTimecode: null,
  proxyPath: null,
  previewPath: null,
  silences: null,
  uploadedAt: "",
  ...over,
});

describe("timecode", () => {
  it("maps measured rates to FCP7 timebases", () => {
    expect(rateFromFps(25)).toEqual({ timebase: 25, ntsc: false });
    expect(rateFromFps(30000 / 1001)).toEqual({ timebase: 30, ntsc: true });
    expect(rateFromFps(24000 / 1001)).toEqual({ timebase: 24, ntsc: true });
    expect(rateFromFps(60000 / 1001)).toEqual({ timebase: 60, ntsc: true });
    expect(rateFromFps(50)).toEqual({ timebase: 50, ntsc: false });
  });

  it("round-trips frames and timecode", () => {
    const r = { timebase: 25, ntsc: false };
    expect(framesToTimecode(4063, r)).toBe("00:02:42:13");
    expect(parseTimecode("00:02:42:13", r)).toEqual({ frames: 4063, clamped: false });
    expect(secondsToTimecode(162.52, r)).toBe("00:02:42:13");
  });

  it("clamps impossible frame fields instead of overflowing", () => {
    const r = { timebase: 25, ntsc: false };
    const p = parseTimecode("00:03:03:36", r)!;
    expect(p.clamped).toBe(true);
    expect(framesToTimecode(p.frames, r)).toBe("00:03:03:24");
  });

  it("accepts decimal-second notation from the model", () => {
    const r = { timebase: 25, ntsc: false };
    expect(timecodeToSeconds("00:02:42.520", r)!.seconds).toBeCloseTo(162.52, 2);
    expect(timecodeToSeconds("02:42.5", r)!.seconds).toBeCloseTo(162.5, 1);
  });

  it("uses exact NTSC rate for seconds→frames", () => {
    const r = { timebase: 30, ntsc: true };
    expect(secondsToFrames(1001, r)).toBe(30000);
  });
});

describe("spine normalisation", () => {
  const m = media();
  const raw = {
    couple_name: "Aisyah & Daniel",
    spine_sequence: [
      {
        sequence_order: 2,
        act: "Act 1: The Hook & The Roots",
        item_type: "timeline_gap",
        gap_duration_seconds: 12,
        premiere_marker_note: "DROP KILLER SHOT HERE: venue wide",
      },
      {
        sequence_order: 1,
        act: "Act 1: The Hook & The Roots",
        item_type: "a_roll_clip",
        speaker: "Bride",
        source_filename: "a7iv_speech_01.mp4",
        in_point: "00:02:42:13",
        out_point: "00:03:03:36",
        verbatim_quote: "Over the course of our lives...",
        delivery_note: "Warm",
      },
      { sequence_order: 3, item_type: "a_roll_clip", source_filename: "missing.mov", in_seconds: 1, out_seconds: 5 },
    ],
  };

  it("orders, matches files case-insensitively, clamps gaps and drops unknown sources", () => {
    const { spine, warnings } = normalizeSpine(raw, [m], { snap: false });
    expect(spine.couple_name).toBe("Aisyah & Daniel");
    expect(spine.spine_sequence.map((i) => i.item_type)).toEqual(["a_roll_clip", "timeline_gap"]);
    const clip = spine.spine_sequence[0];
    if (clip.item_type !== "a_roll_clip") throw new Error();
    expect(clip.source_filename).toBe("A7IV_Speech_01.MP4");
    expect(clip.in_point).toBe("00:02:42:13");
    expect(clip.out_point).toBe("00:03:03:24");
    const gap = spine.spine_sequence[1];
    expect(gap.item_type === "timeline_gap" && gap.gap_duration_seconds).toBe(8);
    expect(warnings.join("\n")).toMatch(/clamped to 5–8s/);
    expect(warnings.join("\n")).toMatch(/missing\.mov/);
    expect(warnings.join("\n")).toMatch(/Spoken audio totals/);
    expect(spine.total_timeline_duration_seconds).toBeCloseTo(spine.spoken_duration_seconds + 8, 3);
  });

  it("snaps cuts onto nearby pauses and leaves distant ones alone", () => {
    const sil = [{ start: 9.6, end: 10.3 }, { start: 20.1, end: 21 }];
    expect(snapToPause(10.5, sil, "in")).toBeCloseTo(10.18, 2);
    expect(snapToPause(19.8, sil, "out")).toBeCloseTo(20.3, 2);
    expect(snapToPause(15, sil, "in")).toBe(15);
  });

  it("recompute renumbers and re-derives timecode after edits", () => {
    const { spine } = normalizeSpine(raw, [m], { snap: false });
    const reversed = recompute({ ...spine, spine_sequence: [...spine.spine_sequence].reverse() }, [m]);
    expect(reversed.spine_sequence.map((i) => i.sequence_order)).toEqual([1, 2]);
  });
});

describe("premiere xml", () => {
  it("encodes POSIX and Windows paths the way Premiere does", () => {
    expect(toPathUrl("/Volumes/SSD 1/A7IV Speech.MP4")).toBe("file://localhost/Volumes/SSD%201/A7IV%20Speech.MP4");
    expect(toPathUrl("D:\\Wedding\\A-Roll\\C0001.MP4")).toBe("file://localhost/D%3a/Wedding/A-Roll/C0001.MP4");
  });

  it("places clips back-to-back with empty space and a marker for each gap", () => {
    const m = media();
    const { spine } = normalizeSpine(
      {
        couple_name: "A & D",
        spine_sequence: [
          { sequence_order: 1, act: "Act 1", item_type: "a_roll_clip", speaker: "Bride", source_filename: m.filename, in_seconds: 10, out_seconds: 20, verbatim_quote: "Hi & <bye>" },
          { sequence_order: 2, act: "Act 1", item_type: "timeline_gap", gap_duration_seconds: 6, premiere_marker_note: "DROP KILLER SHOT HERE: rings" },
          { sequence_order: 3, act: "Act 2", item_type: "a_roll_clip", speaker: "Groom", source_filename: m.filename, in_seconds: 30, out_seconds: 34 },
        ],
      },
      [m],
      { snap: false },
    );
    const xml = buildPremiereXml(spine, [m], { mediaRoot: "/Volumes/SSD/Footage" });
    // Clip 1: 0–250, gap 250–400, clip 2: 400–500.
    expect(xml).toContain("<start>0</start><end>250</end><in>250</in><out>500</out>");
    expect(xml).toContain("<start>400</start><end>500</end><in>750</in><out>850</out>");
    expect(xml).toMatch(/<marker><name>V2 KILLER SHOT · 6s · Act 1<\/name><comment>DROP KILLER SHOT HERE: rings<\/comment><in>250<\/in><out>400<\/out><\/marker>/);
    expect(xml).toContain("<duration>500</duration>");
    expect(xml).toContain("file://localhost/Volumes/SSD/Footage/A7IV_Speech_01.MP4");
    expect(xml).toContain("Hi &amp; &lt;bye&gt;");
    // File fully described once, then referenced.
    expect(xml.match(/<file id="file-1">/g)).toHaveLength(1);
    expect(xml).toContain('<file id="file-1"/>');
    // Stereo source → linked A1 + A2 clip items.
    expect(xml).toContain("clipitem-a2-2");
  });
});
