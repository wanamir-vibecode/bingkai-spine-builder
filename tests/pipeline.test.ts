import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectSilences, ffmpeg, makeAudioProxy, probe, run } from "@/lib/ffmpeg";
import { renderSpine } from "@/lib/render";
import { normalizeSpine } from "@/lib/spine";
import { buildPremiereXml } from "@/lib/xml";
import type { MediaFile } from "@/lib/types";

// "Speech" = 3s tone, 1s silence, repeating; gives silencedetect real pauses to find.
const speechLike = "aevalsrc='0.4*sin(2*PI*330*t)*gte(mod(t\\,4)\\,1)':s=48000:c=stereo";

let dir: string;
const media: MediaFile[] = [];

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "bingkai-test-"));
  const cam = path.join(dir, "A7IV_Speech_01.MP4");
  await ffmpeg([
    "-f", "lavfi", "-i", "testsrc2=s=640x360:r=25:d=40", "-f", "lavfi", "-t", "40", "-i", speechLike,
    "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", cam,
  ]);
  const lav = path.join(dir, "Groom_Vows_Lav.wav");
  await ffmpeg(["-f", "lavfi", "-t", "30", "-i", speechLike, lav]);
  for (const [i, file] of [cam, lav].entries()) {
    const info = await probe(file);
    const proxy = path.join(dir, `${i}.mp3`);
    await makeAudioProxy(file, proxy);
    media.push({
      id: `${i}`.padStart(12, "0"),
      filename: path.basename(file),
      storedPath: file,
      sizeBytes: 0,
      ...info,
      proxyPath: proxy,
      previewPath: null,
      silences: await detectSilences(proxy),
      uploadedAt: "",
    });
  }
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("ffmpeg pipeline", () => {
  it("probes video and audio-only sources", () => {
    const [cam, lav] = media;
    expect(cam).toMatchObject({ hasVideo: true, width: 640, height: 360, rate: { timebase: 25, ntsc: false } });
    expect(cam.audioChannels).toBe(2);
    expect(lav.hasVideo).toBe(false);
    expect(Math.round(lav.durationSec)).toBe(30);
  });

  it("finds the pauses between phrases", () => {
    const s = media[0].silences!;
    expect(s.length).toBeGreaterThanOrEqual(9);
    expect(s[1].start).toBeCloseTo(4, 0);
    expect(s[1].end).toBeCloseTo(5, 0);
  });

  it("snaps sloppy AI cuts onto pauses, then exports XML and a stitched MP4", async () => {
    const { spine, warnings } = normalizeSpine(
      {
        couple_name: "Test Couple",
        spine_sequence: [
          // Speech runs 5–8s; model cut slightly late on the in and early on the out.
          { sequence_order: 1, act: "Act 1: The Hook & The Roots", item_type: "a_roll_clip", speaker: "Bride", source_filename: "A7IV_Speech_01.MP4", in_point: "00:00:05:08", out_point: "00:00:07:20", verbatim_quote: "..." },
          { sequence_order: 2, act: "Act 1: The Hook & The Roots", item_type: "timeline_gap", gap_duration_seconds: 5, premiere_marker_note: "DROP KILLER SHOT HERE: hands" },
          { sequence_order: 3, act: "Act 4: The Promise", item_type: "a_roll_clip", speaker: "Groom", source_filename: "Groom_Vows_Lav.wav", in_seconds: 9.1, out_seconds: 11.9, verbatim_quote: "..." },
        ],
      },
      media,
    );
    const [clip] = spine.spine_sequence;
    if (clip.item_type !== "a_roll_clip") throw new Error("expected clip");
    expect(clip.in_seconds).toBeGreaterThan(4.8);
    expect(clip.in_seconds).toBeLessThan(5.05);
    expect(clip.out_seconds).toBeGreaterThan(8);
    expect(clip.out_seconds).toBeLessThan(8.3);
    expect(warnings.some((w) => w.includes("Spoken audio"))).toBe(true);

    const xml = buildPremiereXml(spine, media);
    const xmlFile = path.join(dir, "spine.xml");
    await import("node:fs/promises").then((fs) => fs.writeFile(xmlFile, xml));
    const lint = await run("xmllint", ["--noout", xmlFile]).then(() => "ok").catch((e) => String(e));
    expect(lint === "ok" || lint.includes("Could not start")).toBe(true);

    const out = await renderSpine(spine, media, path.join(dir, "render"), () => {});
    const info = await probe(out);
    const expected = spine.total_timeline_duration_seconds;
    expect(info.hasVideo).toBe(true);
    expect(info.durationSec).toBeGreaterThan(expected - 0.3);
    expect(info.durationSec).toBeLessThan(expected + 0.5);
  });
});
