"use client";

import { useState } from "react";
import { newId } from "@/lib/id";
import { secondsToTimecode } from "@/lib/timecode";
import { ACTS, GAP_MAX, GAP_MIN, type ClipItem, type GapItem, type MediaFile, type SpineItem } from "@/lib/types";

const ACT_COLORS = ["bg-act1", "bg-act2", "bg-act3", "bg-act4"];
const actIndex = (act: string) => Math.max(0, Number(/act\s*(\d)/i.exec(act)?.[1] ?? 1) - 1) % 4;

const NUDGE = 0.25;

export default function SpineEditor({
  seq,
  media,
  activeIndex,
  onChange,
  onPlay,
}: {
  seq: SpineItem[];
  media: MediaFile[];
  activeIndex: number | null;
  onChange: (next: SpineItem[]) => void;
  onPlay: (index: number) => void;
}) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const update = (i: number, patch: Partial<ClipItem> | Partial<GapItem>) =>
    onChange(seq.map((it, j) => (j === i ? ({ ...it, ...patch } as SpineItem) : it)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= seq.length || from === to) return;
    const next = [...seq];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    onChange(next);
  };
  const remove = (i: number) => onChange(seq.filter((_, j) => j !== i));
  const addGapAfter = (i: number) => {
    const gap: GapItem = {
      id: newId(),
      sequence_order: 0,
      act: seq[i].act,
      item_type: "timeline_gap",
      gap_duration_seconds: 6,
      premiere_marker_note: "DROP KILLER SHOT HERE: ",
    };
    onChange([...seq.slice(0, i + 1), gap, ...seq.slice(i + 1)]);
  };

  return (
    <ol className="space-y-2">
      {seq.map((item, i) => {
        const showAct = i === 0 || seq[i - 1].act !== item.act;
        const color = ACT_COLORS[actIndex(item.act)];
        const isActive = activeIndex === i;
        const dropMarker = dragOver === i && dragFrom !== null && dragFrom !== i;
        return (
          <li key={item.id}>
            {showAct && (
              <div className="mb-2 mt-6 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted first:mt-0">
                <span className={`h-2 w-2 rounded-full ${color}`} />
                {item.act}
              </div>
            )}
            <div
              draggable
              onDragStart={(e) => {
                setDragFrom(i);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(i);
              }}
              onDragLeave={() => setDragOver((d) => (d === i ? null : d))}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom !== null) move(dragFrom, i);
                setDragFrom(null);
                setDragOver(null);
              }}
              onDragEnd={() => {
                setDragFrom(null);
                setDragOver(null);
              }}
              className={`group relative flex gap-3 rounded-lg border bg-white transition ${
                isActive ? "border-ink" : "border-line"
              } ${dropMarker ? "ring-2 ring-ink/20" : ""} ${dragFrom === i ? "opacity-40" : ""}`}
            >
              <div className={`w-1 shrink-0 rounded-l-lg ${item.item_type === "timeline_gap" ? "bg-transparent" : color}`} />
              <div className="flex-1 py-3 pr-3">
                {item.item_type === "a_roll_clip" ? (
                  <ClipBody item={item} media={media} onUpdate={(p) => update(i, p)} />
                ) : (
                  <GapBody item={item} onUpdate={(p) => update(i, p)} />
                )}
              </div>
              <div className="flex shrink-0 flex-col items-center justify-center gap-1 border-l border-line px-2 text-xs text-muted">
                <IconButton label="Play from here" onClick={() => onPlay(i)}>▶</IconButton>
                <IconButton label="Move up" onClick={() => move(i, i - 1)}>↑</IconButton>
                <IconButton label="Move down" onClick={() => move(i, i + 1)}>↓</IconButton>
                <IconButton label="Insert gap after" onClick={() => addGapAfter(i)}>＋</IconButton>
                <IconButton label="Remove" onClick={() => remove(i)}>✕</IconButton>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button title={label} aria-label={label} onClick={onClick} className="h-6 w-6 rounded hover:bg-line hover:text-ink">
      {children}
    </button>
  );
}

function ClipBody({
  item,
  media,
  onUpdate,
}: {
  item: ClipItem;
  media: MediaFile[];
  onUpdate: (p: Partial<ClipItem>) => void;
}) {
  const m = media.find((x) => x.id === item.media_id);
  const rate = m?.rate ?? { timebase: 25, ntsc: false };
  const max = m?.durationSec ?? Infinity;
  const dur = item.out_seconds - item.in_seconds;
  const nudge = (edge: "in" | "out", delta: number) => {
    if (edge === "in") {
      const v = Math.min(item.out_seconds - 0.5, Math.max(0, item.in_seconds + delta));
      onUpdate({ in_seconds: Math.round(v * 1000) / 1000 });
    } else {
      const v = Math.max(item.in_seconds + 0.5, Math.min(max, item.out_seconds + delta));
      onUpdate({ out_seconds: Math.round(v * 1000) / 1000 });
    }
  };
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span className="font-medium text-ink">{item.speaker}</span>
        <span>{item.source_filename}</span>
        <span className="font-mono tabular-nums">
          <Trim onMinus={() => nudge("in", -NUDGE)} onPlus={() => nudge("in", NUDGE)} />
          {secondsToTimecode(item.in_seconds, rate)} → {secondsToTimecode(item.out_seconds, rate)}
          <Trim onMinus={() => nudge("out", -NUDGE)} onPlus={() => nudge("out", NUDGE)} />
        </span>
        <span className="tabular-nums">{dur.toFixed(1)}s</span>
        <select
          value={ACTS.find((a) => a.slice(0, 5) === item.act.slice(0, 5)) ?? item.act}
          onChange={(e) => onUpdate({ act: e.target.value })}
          className="ml-auto rounded border-none bg-transparent text-xs text-muted outline-none hover:text-ink"
        >
          {ACTS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
          {!ACTS.some((a) => a.slice(0, 5) === item.act.slice(0, 5)) && <option value={item.act}>{item.act}</option>}
        </select>
      </div>
      <p className="mt-1.5 text-[15px] leading-relaxed">“{item.verbatim_quote}”</p>
      {item.delivery_note && <p className="mt-1 text-xs italic text-muted">{item.delivery_note}</p>}
    </div>
  );
}

function Trim({ onMinus, onPlus }: { onMinus: () => void; onPlus: () => void }) {
  return (
    <span className="mx-1 inline-flex opacity-0 transition group-hover:opacity-100">
      <button title={`−${NUDGE}s`} onClick={onMinus} className="px-1 hover:text-ink">−</button>
      <button title={`+${NUDGE}s`} onClick={onPlus} className="px-1 hover:text-ink">+</button>
    </span>
  );
}

function GapBody({ item, onUpdate }: { item: GapItem; onUpdate: (p: Partial<GapItem>) => void }) {
  return (
    <div className="rounded-md border border-dashed border-line bg-neutral-50 px-3 py-2">
      <div className="flex items-center gap-3 text-xs">
        <span className="font-medium uppercase tracking-wider">Killer shot gap</span>
        <input
          type="range"
          min={GAP_MIN}
          max={GAP_MAX}
          step={0.5}
          value={item.gap_duration_seconds}
          onChange={(e) => onUpdate({ gap_duration_seconds: Number(e.target.value) })}
          className="w-40"
          aria-label="Gap duration"
        />
        <span className="w-10 tabular-nums">{item.gap_duration_seconds.toFixed(1)}s</span>
      </div>
      <textarea
        value={item.premiere_marker_note}
        onChange={(e) => onUpdate({ premiere_marker_note: e.target.value })}
        rows={2}
        className="mt-2 w-full resize-none bg-transparent text-sm text-muted outline-none focus:text-ink"
        aria-label="Premiere marker note"
      />
    </div>
  );
}
