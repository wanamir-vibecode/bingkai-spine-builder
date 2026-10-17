import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { ffmpeg } from "./ffmpeg";
import { isClip } from "./spine";
import type { MediaFile, Spine } from "./types";

const W = 1280;
const H = 720;
const FPS = 25;

const FONT_CANDIDATES = [
  process.env.BINGKAI_FONT,
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/System/Library/Fonts/Helvetica.ttc",
  "C:/Windows/Fonts/arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans.ttf",
];

// drawtext needs a font file on systems without fontconfig; fall back to fontconfig's default.
const fontOption = () => {
  const f = FONT_CANDIDATES.find((p) => p && existsSync(p));
  return f ? `fontfile='${f.replace(/\\/g, "/").replace(/:/g, "\\:")}':` : "";
};

// Filtergraph escaping for text passed to drawtext inside single quotes.
const dtText = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\u2019").replace(/:/g, "\\:").replace(/%/g, "\\%");

const ENCODE = [
  "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-r", String(FPS),
  "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
];

const fitVideo = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS},format=yuv420p`;

async function withTextFallback(build: (withText: boolean) => string[]) {
  try {
    await ffmpeg(build(true));
  } catch (err) {
    // Some FFmpeg builds ship without libfreetype; render without the burn-in rather than fail.
    if (!/drawtext|font|Filter not found|No such filter/i.test(String(err))) throw err;
    await ffmpeg(build(false));
  }
}

async function renderClip(m: MediaFile, inS: number, outS: number, label: string, out: string) {
  const dur = (outS - inS).toFixed(3);
  const caption = `drawtext=${fontOption()}text='${dtText(label)}':fontcolor=white@0.85:fontsize=22:x=32:y=h-56:box=1:boxcolor=black@0.45:boxborderw=8`;
  await withTextFallback((withText) => {
    const args = ["-ss", inS.toFixed(3), "-t", dur, "-i", m.storedPath];
    if (m.hasVideo) {
      args.push("-vf", withText ? `${fitVideo},${caption}` : fitVideo);
    } else {
      // Audio-only source: black frame with the speaker label.
      args.push("-f", "lavfi", "-t", dur, "-i", `color=c=black:s=${W}x${H}:r=${FPS}`);
      args.push("-map", "1:v", "-map", "0:a", "-vf", withText ? `format=yuv420p,${caption}` : "format=yuv420p");
    }
    if (m.audioChannels === 0) {
      args.push("-f", "lavfi", "-t", dur, "-i", "anullsrc=r=48000:cl=stereo", "-map", "0:v", "-map", "1:a");
    }
    return [...args, "-af", "aresample=48000,aformat=channel_layouts=stereo", ...ENCODE, "-shortest", out];
  });
}

async function renderGap(seconds: number, note: string, out: string) {
  const d = seconds.toFixed(3);
  const font = fontOption();
  const countdown = `drawtext=${font}text='%{eif\\:ceil(${d}-t)\\:d}':fontcolor=white:fontsize=120:x=(w-tw)/2:y=(h-th)/2-30`;
  const heading = `drawtext=${font}text='KILLER SHOT':fontcolor=white@0.6:fontsize=24:x=(w-tw)/2:y=(h/2)-150`;
  const short = note.replace(/^DROP KILLER SHOT HERE:\s*/i, "").slice(0, 90);
  const sub = `drawtext=${font}text='${dtText(short)}':fontcolor=white@0.6:fontsize=20:x=(w-tw)/2:y=(h/2)+90`;
  await withTextFallback((withText) => [
    "-f", "lavfi", "-t", d, "-i", `color=c=black:s=${W}x${H}:r=${FPS}`,
    "-f", "lavfi", "-t", d, "-i", "anullsrc=r=48000:cl=stereo",
    "-vf", withText ? `format=yuv420p,${heading},${countdown},${sub}` : "format=yuv420p",
    ...ENCODE, "-shortest", out,
  ]);
}

export async function renderSpine(
  spine: Spine,
  media: MediaFile[],
  workDir: string,
  onProgress: (msg: string) => Promise<void> | void,
): Promise<string> {
  await fs.rm(workDir, { recursive: true, force: true });
  await fs.mkdir(workDir, { recursive: true });
  const parts: string[] = [];
  const seq = spine.spine_sequence;
  for (let i = 0; i < seq.length; i++) {
    const item = seq[i];
    await onProgress(`Rendering segment ${i + 1} of ${seq.length}`);
    const out = path.join(workDir, `seg_${String(i).padStart(3, "0")}.mp4`);
    if (isClip(item)) {
      const m = media.find((x) => x.id === item.media_id);
      if (!m) continue;
      await renderClip(m, item.in_seconds, item.out_seconds, `${item.speaker} · ${item.act}`, out);
    } else {
      await renderGap(item.gap_duration_seconds, item.premiere_marker_note, out);
    }
    parts.push(out);
  }
  if (parts.length === 0) throw new Error("Spine is empty");
  await onProgress("Stitching spine");
  const list = path.join(workDir, "concat.txt");
  await fs.writeFile(list, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
  const output = path.join(workDir, "spine.mp4");
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", output]);
  await Promise.all(parts.map((p) => fs.rm(p, { force: true })));
  return output;
}
