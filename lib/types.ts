export type Rate = {
  /** Integer timebase used for timecode and FCP7 XML (e.g. 30 for 29.97). */
  timebase: number;
  /** True for 23.976 / 29.97 / 59.94 style rates. */
  ntsc: boolean;
};

export type SilenceSpan = { start: number; end: number };

export type MediaFile = {
  id: string;
  filename: string;
  storedPath: string;
  sizeBytes: number;
  durationSec: number;
  hasVideo: boolean;
  width: number | null;
  height: number | null;
  /** Exact frames-per-second, e.g. 29.97002997. */
  fps: number;
  rate: Rate;
  audioChannels: number;
  sampleRate: number | null;
  /** Embedded camera timecode, if the container carries one. Informational. */
  startTimecode: string | null;
  proxyPath: string | null;
  /** Low-res H.264 copy the browser can always decode (camera 10-bit 4:2:2 often can't). */
  previewPath: string | null;
  silences: SilenceSpan[] | null;
  uploadedAt: string;
};

export const ACTS = [
  "Act 1: The Hook & The Roots",
  "Act 2: The Catalyst",
  "Act 3: The Dynamic",
  "Act 4: The Promise",
] as const;

export type ClipItem = {
  id: string;
  sequence_order: number;
  act: string;
  item_type: "a_roll_clip";
  speaker: string;
  source_filename: string;
  media_id: string;
  /** HH:MM:SS:FF relative to the start of the source file, at the source timebase. */
  in_point: string;
  out_point: string;
  /** Canonical cut positions in seconds from the start of the source file. */
  in_seconds: number;
  out_seconds: number;
  verbatim_quote: string;
  delivery_note: string;
};

export type GapItem = {
  id: string;
  sequence_order: number;
  act: string;
  item_type: "timeline_gap";
  gap_duration_seconds: number;
  premiere_marker_note: string;
};

export type SpineItem = ClipItem | GapItem;

export type Spine = {
  couple_name: string;
  spoken_duration_seconds: number;
  total_timeline_duration_seconds: number;
  spine_sequence: SpineItem[];
};

export type JobState = "idle" | "running" | "done" | "error";

export type Job = {
  state: JobState;
  message: string;
  updatedAt: string;
};

export type ProjectSettings = {
  /**
   * Folder on the editor's machine that holds the original camera files.
   * When set, the Premiere XML links to <mediaRoot>/<filename> instead of the uploaded copy.
   */
  mediaRoot: string;
};

export type Project = {
  id: string;
  name: string;
  coupleName: string;
  createdAt: string;
  media: MediaFile[];
  spine: Spine | null;
  warnings: string[];
  analysis: Job;
  render: Job & { outputPath: string | null };
  settings: ProjectSettings;
};

export const GAP_MIN = 5;
export const GAP_MAX = 8;
export const SPOKEN_MIN = 90;
export const SPOKEN_MAX = 120;
