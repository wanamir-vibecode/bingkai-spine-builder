import type { Rate } from "./types";

/** Map a measured frame rate onto the FCP7 timebase/ntsc pair. */
export function rateFromFps(fps: number): Rate {
  if (!Number.isFinite(fps) || fps <= 0) return { timebase: 25, ntsc: false };
  const rounded = Math.round(fps);
  const ntsc = Math.abs(fps - (rounded * 1000) / 1001) < 0.01 && Math.abs(fps - rounded) > 0.01;
  return { timebase: rounded, ntsc };
}

export function exactFps(rate: Rate): number {
  return rate.ntsc ? (rate.timebase * 1000) / 1001 : rate.timebase;
}

export function secondsToFrames(seconds: number, rate: Rate): number {
  return Math.round(seconds * exactFps(rate));
}

export function framesToSeconds(frames: number, rate: Rate): number {
  return frames / exactFps(rate);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Non-drop-frame timecode, counted at the integer timebase. */
export function framesToTimecode(frames: number, rate: Rate): string {
  const tb = rate.timebase;
  const total = Math.max(0, Math.round(frames));
  const f = total % tb;
  const s = Math.floor(total / tb);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(f)}`;
}

export function secondsToTimecode(seconds: number, rate: Rate): string {
  return framesToTimecode(secondsToFrames(seconds, rate), rate);
}

export type ParsedTimecode = { frames: number; clamped: boolean };

/**
 * Parse HH:MM:SS:FF (also accepts ; for drop-frame notation, HH:MM:SS.mmm and MM:SS).
 * A frame field at or above the timebase is clamped to the last frame of that second
 * and reported, since models occasionally emit e.g. ":36" against a 25 fps source.
 */
export function parseTimecode(tc: string, rate: Rate): ParsedTimecode | null {
  const s = tc.trim();
  const ms = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(s);
  if (ms && s.includes(".")) {
    const seconds = Number(ms[1] ?? 0) * 3600 + Number(ms[2]) * 60 + Number(ms[3]);
    return { frames: secondsToFrames(seconds, rate), clamped: false };
  }
  const m = /^(\d{1,2}):(\d{2}):(\d{2})[:;.](\d{1,3})$/.exec(s);
  if (m) {
    const [h, mi, se, fr] = m.slice(1).map(Number);
    const clamped = fr >= rate.timebase;
    const f = clamped ? rate.timebase - 1 : fr;
    return { frames: ((h * 60 + mi) * 60 + se) * rate.timebase + f, clamped };
  }
  if (ms) {
    const seconds = Number(ms[1] ?? 0) * 3600 + Number(ms[2]) * 60 + Number(ms[3]);
    return { frames: secondsToFrames(seconds, rate), clamped: false };
  }
  return null;
}

/** Timecode frames are counted at the integer timebase, so convert back through it. */
export function timecodeToSeconds(tc: string, rate: Rate): { seconds: number; clamped: boolean } | null {
  const p = parseTimecode(tc, rate);
  if (!p) return null;
  return { seconds: framesToSeconds(p.frames, rate), clamped: p.clamped };
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}
