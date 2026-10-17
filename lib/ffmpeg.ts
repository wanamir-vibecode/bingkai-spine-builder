import { spawn } from "node:child_process";
import { rateFromFps } from "./timecode";
import type { Rate, SilenceSpan } from "./types";

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";

export function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => {
      stderr += d;
      if (stderr.length > 2_000_000) stderr = stderr.slice(-1_000_000);
    });
    child.on("error", (err) =>
      reject(new Error(`Could not start ${cmd}: ${err.message}. Is FFmpeg installed and on PATH?`)),
    );
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited with code ${code}: ${stderr.trim().split("\n").slice(-4).join(" | ")}`));
    });
  });
}

export const ffmpeg = (args: string[]) => run(FFMPEG, ["-hide_banner", "-nostdin", "-y", ...args]);

export type ProbeResult = {
  durationSec: number;
  hasVideo: boolean;
  width: number | null;
  height: number | null;
  fps: number;
  rate: Rate;
  audioChannels: number;
  sampleRate: number | null;
  startTimecode: string | null;
};

type FfprobeStream = {
  codec_type?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  channels?: number;
  sample_rate?: string;
  disposition?: { attached_pic?: number };
  tags?: Record<string, string>;
};

const ratio = (s?: string) => {
  if (!s) return NaN;
  const [n, d] = s.split("/").map(Number);
  return d ? n / d : n;
};

export async function probe(file: string): Promise<ProbeResult> {
  const { stdout } = await run(FFPROBE, [
    "-v", "error", "-print_format", "json", "-show_format", "-show_streams", file,
  ]);
  const info = JSON.parse(stdout) as {
    format?: { duration?: string; tags?: Record<string, string> };
    streams?: FfprobeStream[];
  };
  const streams = info.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const audio = streams.filter((s) => s.codec_type === "audio");
  if (!video && audio.length === 0) throw new Error("No audio or video streams found in file");
  let fps = ratio(video?.avg_frame_rate);
  if (!Number.isFinite(fps) || fps <= 0 || fps > 240) fps = ratio(video?.r_frame_rate);
  // Audio-only sources (lav recorders) get a 25 fps grid, the PAL standard used in Malaysia.
  if (!Number.isFinite(fps) || fps <= 0 || fps > 240) fps = 25;
  const tmcd = streams.find((s) => s.tags?.timecode)?.tags?.timecode ?? info.format?.tags?.timecode ?? null;
  return {
    durationSec: Number(info.format?.duration ?? 0),
    hasVideo: Boolean(video),
    width: video?.width ?? null,
    height: video?.height ?? null,
    fps,
    rate: rateFromFps(fps),
    audioChannels: audio.reduce((n, s) => n + (s.channels ?? 0), 0),
    sampleRate: audio[0]?.sample_rate ? Number(audio[0].sample_rate) : null,
    startTimecode: tmcd,
  };
}

/** Small mono MP3 the multimodal model listens to. ~0.35 MB per minute. */
export async function makeAudioProxy(input: string, output: string): Promise<void> {
  await ffmpeg(["-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "48k", output]);
}

/** Keyframe-dense 540p H.264 so the paper-edit player can seek instantly to any cut. */
export async function makePreviewProxy(input: string, output: string): Promise<void> {
  await ffmpeg([
    "-i", input, "-map", "0:v:0", "-map", "0:a:0?",
    "-vf", "scale=-2:540,format=yuv420p", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", "-g", "25",
    "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-movflags", "+faststart", output,
  ]);
}

export async function detectSilences(input: string, noiseDb = -35, minDur = 0.25): Promise<SilenceSpan[]> {
  const { stderr } = await ffmpeg([
    "-i", input, "-vn", "-af", `silencedetect=noise=${noiseDb}dB:d=${minDur}`, "-f", "null", "-",
  ]);
  const spans: SilenceSpan[] = [];
  let start: number | null = null;
  for (const line of stderr.split("\n")) {
    const s = /silence_start: (-?[\d.]+)/.exec(line);
    if (s) start = Math.max(0, Number(s[1]));
    const e = /silence_end: ([\d.]+)/.exec(line);
    if (e && start !== null) {
      spans.push({ start, end: Number(e[1]) });
      start = null;
    }
  }
  return spans;
}
