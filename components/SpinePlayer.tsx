"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatClock } from "@/lib/timecode";
import type { MediaFile, SpineItem } from "@/lib/types";

export type PlayRequest = { index: number; nonce: number };

const itemLength = (it: SpineItem) =>
  it.item_type === "timeline_gap" ? it.gap_duration_seconds : Math.max(0, it.out_seconds - it.in_seconds);

/**
 * Plays the spine straight off the source files: seeks to each in-point, stops at the out-point,
 * and shows a black countdown for each killer-shot gap. Nothing is rendered server-side.
 */
export default function SpinePlayer({
  projectId,
  seq,
  media,
  request,
  onActive,
}: {
  projectId: string;
  seq: SpineItem[];
  media: MediaFile[];
  request: PlayRequest | null;
  onActive: (index: number | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const seqRef = useRef(seq);
  const mediaRef = useRef(media);
  seqRef.current = seq;
  mediaRef.current = media;

  const rafRef = useRef<number | null>(null);
  const tokenRef = useRef(0);
  const gapRef = useRef<{ remaining: number; startedAt: number } | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [gapLeft, setGapLeft] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const total = seq.reduce((s, it) => s + itemLength(it), 0);
  const offsetOf = (i: number) => seqRef.current.slice(0, i).reduce((s, it) => s + itemLength(it), 0);

  const stopLoop = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };

  const urlFor = (m: MediaFile) =>
    `/api/projects/${projectId}/media/${m.id}${m.previewPath ? "?variant=preview" : ""}`;

  const playIndex = useCallback(
    async (i: number, resumeGap?: number) => {
      stopLoop();
      const token = ++tokenRef.current;
      const video = videoRef.current;
      const item = seqRef.current[i];
      if (!video || !item) {
        setPlaying(false);
        setActive(null);
        setGapLeft(null);
        onActive(null);
        return;
      }
      setError(null);
      setActive(i);
      onActive(i);
      setPlaying(true);
      const base = offsetOf(i);

      if (item.item_type === "timeline_gap") {
        video.pause();
        const duration = resumeGap ?? item.gap_duration_seconds;
        gapRef.current = { remaining: duration, startedAt: performance.now() };
        const tick = () => {
          if (token !== tokenRef.current || !gapRef.current) return;
          const left = gapRef.current.remaining - (performance.now() - gapRef.current.startedAt) / 1000;
          setGapLeft(Math.max(0, left));
          setPosition(base + item.gap_duration_seconds - Math.max(0, left));
          if (left <= 0) {
            gapRef.current = null;
            setGapLeft(null);
            void playIndex(i + 1);
          } else rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      gapRef.current = null;
      setGapLeft(null);
      const m = mediaRef.current.find((x) => x.id === item.media_id);
      if (!m) return void playIndex(i + 1);
      const url = urlFor(m);
      if (video.dataset.src !== url) {
        video.dataset.src = url;
        video.src = url;
        await new Promise<void>((resolve) => {
          video.addEventListener("loadedmetadata", () => resolve(), { once: true });
          video.addEventListener("error", () => resolve(), { once: true });
        });
        if (video.error) {
          setError(
            `The browser can't decode ${m.filename}${m.hasVideo && !m.previewPath ? " yet — the preview proxy is still being built" : ""}.`,
          );
          setPlaying(false);
          return;
        }
      }
      if (token !== tokenRef.current) return;
      const resumeAt = video.currentTime > item.in_seconds && video.currentTime < item.out_seconds && resumeGap === -1;
      if (!resumeAt) video.currentTime = item.in_seconds;
      try {
        await video.play();
      } catch {
        setPlaying(false);
        return;
      }
      const tick = () => {
        if (token !== tokenRef.current) return;
        const t = video.currentTime;
        setPosition(base + Math.max(0, t - item.in_seconds));
        if (t >= item.out_seconds - 0.02 || video.ended) void playIndex(i + 1);
        else rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, onActive],
  );

  const pause = () => {
    stopLoop();
    tokenRef.current++;
    videoRef.current?.pause();
    if (gapRef.current) {
      gapRef.current.remaining -= (performance.now() - gapRef.current.startedAt) / 1000;
    }
    setPlaying(false);
  };

  const resume = () => {
    if (active === null) return void playIndex(0);
    if (gapRef.current) return void playIndex(active, gapRef.current.remaining);
    void playIndex(active, -1);
  };

  useEffect(() => {
    if (request) void playIndex(request.index);
  }, [request, playIndex]);

  useEffect(() => () => stopLoop(), []);

  const current = active !== null ? seq[active] : null;

  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <div className="relative aspect-video bg-black">
        <video ref={videoRef} className="h-full w-full" playsInline preload="metadata" />
        {current?.item_type === "a_roll_clip" && !media.find((m) => m.id === current.media_id)?.hasVideo && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/60">
            {current.speaker} · audio only
          </div>
        )}
        {gapLeft !== null && current?.item_type === "timeline_gap" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black px-10 text-center text-white">
            <div className="text-[11px] uppercase tracking-[0.25em] text-white/50">Killer shot</div>
            <div className="mt-2 text-7xl font-light tabular-nums">{Math.ceil(gapLeft)}</div>
            <div className="mt-4 max-w-md text-sm text-white/60">
              {current.premiere_marker_note.replace(/^DROP KILLER SHOT HERE:\s*/i, "")}
            </div>
          </div>
        )}
        {active === null && (
          <button
            onClick={() => playIndex(0)}
            disabled={seq.length === 0}
            className="absolute inset-0 flex items-center justify-center text-sm text-white/70 hover:text-white"
          >
            ▶ Play spine
          </button>
        )}
        {error && (
          <div className="absolute inset-x-0 bottom-0 bg-black/80 px-4 py-3 text-sm text-white">{error}</div>
        )}
      </div>
      <div className="flex items-center gap-4 px-4 py-3">
        <button
          onClick={playing ? pause : resume}
          disabled={seq.length === 0}
          className="w-16 rounded-md border border-line px-2 py-1 text-sm disabled:opacity-40"
        >
          {playing ? "Pause" : "Play"}
        </button>
        <div className="h-1 flex-1 overflow-hidden rounded bg-line">
          <div className="h-full bg-ink" style={{ width: `${total ? (position / total) * 100 : 0}%` }} />
        </div>
        <div className="w-24 text-right text-xs tabular-nums text-muted">
          {formatClock(position)} / {formatClock(total)}
        </div>
      </div>
      {current?.item_type === "a_roll_clip" && (
        <div className="border-t border-line px-4 py-3 text-sm">
          <span className="font-medium">{current.speaker}: </span>
          <span className="text-muted">“{current.verbatim_quote}”</span>
        </div>
      )}
    </div>
  );
}
