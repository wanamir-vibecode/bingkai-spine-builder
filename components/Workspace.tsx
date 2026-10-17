"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import SpineEditor from "./SpineEditor";
import SpinePlayer, { type PlayRequest } from "./SpinePlayer";
import { formatClock } from "@/lib/timecode";
import { SPOKEN_MAX, SPOKEN_MIN, type MediaFile, type Project, type SpineItem } from "@/lib/types";

type Engine = { configured: boolean; model: string };
type Upload = { name: string; progress: number; error?: string };

const totals = (seq: SpineItem[]) => {
  let spoken = 0;
  let gaps = 0;
  for (const it of seq) {
    if (it.item_type === "timeline_gap") gaps += it.gap_duration_seconds;
    else spoken += Math.max(0, it.out_seconds - it.in_seconds);
  }
  return { spoken, total: spoken + gaps };
};

const formatBytes = (n: number) =>
  n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(0)} MB` : `${Math.ceil(n / 1e3)} KB`;

const fpsLabel = (m: MediaFile) =>
  m.rate.ntsc ? ((m.rate.timebase * 1000) / 1001).toFixed(3).replace(/0+$/, "") : String(m.rate.timebase);

export default function Workspace({ id }: { id: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seq, setSeq] = useState<SpineItem[] | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [request, setRequest] = useState<PlayRequest | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [mediaRoot, setMediaRoot] = useState("");
  const [saving, setSaving] = useState(false);

  // Local edits win over polled server state until they are saved.
  const editVersion = useRef(0);
  const savedVersion = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const accept = useCallback((p: Project) => {
    setProject(p);
    if (editVersion.current === savedVersion.current) setSeq(p.spine?.spine_sequence ?? null);
  }, []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${id}`, { cache: "no-store" });
    if (res.status === 404) return setNotFound(true);
    const data = (await res.json()) as { project: Project; engine: Engine };
    setEngine(data.engine);
    accept(data.project);
    return data.project;
  }, [id, accept]);

  useEffect(() => {
    load().then((p) => p && setMediaRoot(p.settings.mediaRoot));
  }, [load]);

  const busy =
    project &&
    (project.analysis.state === "running" ||
      project.render.state === "running" ||
      project.media.some((m) => !m.silences || (m.hasVideo && !m.previewPath)));
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [busy, load]);

  async function call(path: string, init: RequestInit = {}) {
    setError(null);
    const res = await fetch(`/api/projects/${id}${path}`, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? `Request failed (${res.status})`);
      return null;
    }
    if (data.project) accept(data.project);
    return data;
  }

  function editSeq(next: SpineItem[]) {
    setSeq(next);
    const version = ++editVersion.current;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spine_sequence: next }),
      });
      setSaving(false);
      if (!res.ok) return setError("Could not save the edit");
      const data = (await res.json()) as { project: Project };
      if (version === editVersion.current) {
        savedVersion.current = version;
        accept(data.project);
      } else setProject(data.project);
    }, 500);
  }

  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    setUploads(list.map((f) => ({ name: f.name, progress: 0 })));
    for (const [i, file] of list.entries()) {
      await new Promise<void>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `/api/projects/${id}/media?filename=${encodeURIComponent(file.name)}`);
        xhr.upload.onprogress = (e) =>
          setUploads((u) => u.map((x, j) => (j === i ? { ...x, progress: e.loaded / e.total } : x)));
        xhr.onload = () => {
          let msg: string | undefined;
          try {
            const data = JSON.parse(xhr.responseText);
            if (xhr.status >= 300) msg = data.error;
            else accept(data.project);
          } catch {
            msg = `Upload failed (${xhr.status})`;
          }
          setUploads((u) => u.map((x, j) => (j === i ? { ...x, progress: 1, error: msg } : x)));
          resolve();
        };
        xhr.onerror = () => {
          setUploads((u) => u.map((x, j) => (j === i ? { ...x, error: "Network error" } : x)));
          resolve();
        };
        xhr.send(file);
      });
    }
    setUploads((u) => u.filter((x) => x.error));
  }

  if (notFound)
    return (
      <p className="text-muted">
        Wedding not found. <Link href="/" className="underline">Back</Link>
      </p>
    );
  if (!project) return <p className="text-muted">Loading…</p>;

  const t = seq ? totals(seq) : null;
  const spokenOk = t && t.spoken >= SPOKEN_MIN && t.spoken <= SPOKEN_MAX;
  const analysing = project.analysis.state === "running";
  const rendering = project.render.state === "running";

  return (
    <div className="space-y-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/" className="text-xs text-muted hover:text-ink">← All weddings</Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{project.coupleName || project.name}</h1>
        </div>
        {saving && <span className="text-xs text-muted">Saving…</span>}
      </div>

      {error && (
        <div className="flex items-start justify-between rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-4 text-red-400">✕</button>
        </div>
      )}

      {/* 1 — Upload */}
      <section>
        <SectionTitle n={1} title="Raw A-roll" hint="Speeches, vows and interviews only — no B-roll." />
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
          }}
          className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-line px-6 py-8 text-sm text-muted hover:border-ink"
        >
          <input
            type="file"
            multiple
            accept="video/*,audio/*,.mxf,.mts"
            className="hidden"
            onChange={(e) => e.target.files && upload(e.target.files)}
          />
          Drop camera or recorder files here, or click to choose
        </label>
        {uploads.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
            {uploads.map((u) => (
              <li key={u.name} className="flex items-center gap-3">
                <span className="w-64 truncate">{u.name}</span>
                {u.error ? (
                  <span className="text-red-700">{u.error}</span>
                ) : (
                  <div className="h-1 w-48 overflow-hidden rounded bg-line">
                    <div className="h-full bg-ink" style={{ width: `${u.progress * 100}%` }} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {project.media.length > 0 && (
          <table className="mt-4 w-full text-sm">
            <tbody className="divide-y divide-line">
              {project.media.map((m) => (
                <tr key={m.id}>
                  <td className="py-2 font-medium">{m.filename}</td>
                  <td className="py-2 text-muted tabular-nums">{formatClock(m.durationSec)}</td>
                  <td className="py-2 text-muted">
                    {m.hasVideo ? `${m.width}×${m.height} · ${fpsLabel(m)} fps` : "Audio only"}
                  </td>
                  <td className="py-2 text-muted">{formatBytes(m.sizeBytes)}</td>
                  <td className="py-2 text-xs text-muted">
                    {!m.silences ? "Preparing audio…" : m.hasVideo && !m.previewPath ? "Building preview…" : "Ready"}
                  </td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => call(`/media/${m.id}`, { method: "DELETE" })}
                      className="text-xs text-muted hover:text-ink"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 2 — Extract */}
      <section>
        <SectionTitle
          n={2}
          title="Story extraction"
          hint="The editor listens to vocal emotion, pauses and code-switching directly."
        />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={() => call("/analyze", { method: "POST" })}
            disabled={analysing || project.media.length === 0 || !engine?.configured}
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {analysing ? "Listening…" : project.spine ? "Rebuild spine" : "Build spine"}
          </button>
          <button onClick={() => setShowImport((s) => !s)} className="text-sm text-muted hover:text-ink">
            {showImport ? "Hide JSON import" : "Paste spine JSON instead"}
          </button>
          <span className="text-xs text-muted">
            {engine?.configured ? `Engine: ${engine.model}` : "Set GEMINI_API_KEY on the server to enable AI extraction"}
          </span>
        </div>
        {project.analysis.state !== "idle" && (
          <p className={`mt-3 text-sm ${project.analysis.state === "error" ? "text-red-700" : "text-muted"}`}>
            {project.analysis.message}
          </p>
        )}
        {showImport && (
          <div className="mt-4">
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={8}
              placeholder='{ "couple_name": "...", "spine_sequence": [ ... ] }'
              className="w-full rounded-md border border-line p-3 font-mono text-xs outline-none focus:border-ink"
            />
            <button
              onClick={async () => {
                const ok = await call("/spine", { method: "POST", body: importText });
                if (ok) setShowImport(false);
              }}
              disabled={!importText.trim()}
              className="mt-2 rounded-md border border-ink px-4 py-1.5 text-sm disabled:opacity-40"
            >
              Import
            </button>
          </div>
        )}
      </section>

      {/* 3 — Paper edit */}
      {seq && (
        <section>
          <SectionTitle n={3} title="Paper edit" hint="Drag to reorder. Hover a clip to trim. Slide a gap to resize." />
          <div className="mt-4 flex flex-wrap gap-6 text-sm">
            <Stat label="Spoken" value={`${t!.spoken.toFixed(1)}s`} sub={`target ${SPOKEN_MIN}–${SPOKEN_MAX}s`} ok={!!spokenOk} />
            <Stat label="Timeline" value={formatClock(t!.total)} sub="target 2:00–2:30" ok={t!.total >= 120 && t!.total <= 150} />
            <Stat label="Clips" value={String(seq.filter((s) => s.item_type === "a_roll_clip").length)} />
            <Stat label="Gaps" value={String(seq.filter((s) => s.item_type === "timeline_gap").length)} />
          </div>
          {project.warnings.length > 0 && (
            <ul className="mt-4 space-y-1 text-xs text-amber-700">
              {project.warnings.map((w) => (
                <li key={w}>• {w}</li>
              ))}
            </ul>
          )}
          <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_420px]">
            <SpineEditor
              seq={seq}
              media={project.media}
              activeIndex={activeIndex}
              onChange={editSeq}
              onPlay={(index) => setRequest({ index, nonce: Date.now() })}
            />
            <div className="lg:sticky lg:top-6 lg:self-start">
              <SpinePlayer
                projectId={id}
                seq={seq}
                media={project.media}
                request={request}
                onActive={setActiveIndex}
              />
            </div>
          </div>
        </section>
      )}

      {/* 4 — Export */}
      {seq && seq.length > 0 && (
        <section>
          <SectionTitle n={4} title="Export" />
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            <div className="rounded-lg border border-line p-5">
              <h3 className="font-medium">Premiere Pro XML</h3>
              <p className="mt-1 text-sm text-muted">
                A-roll on V1/A1, empty gaps with killer-shot markers. Links to your camera originals.
              </p>
              <label className="mt-4 block text-xs text-muted">
                Original footage folder on the editing machine (optional)
                <input
                  value={mediaRoot}
                  onChange={(e) => setMediaRoot(e.target.value)}
                  onBlur={() =>
                    call("", {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ settings: { mediaRoot } }),
                    })
                  }
                  placeholder="/Volumes/SSD/Wedding/A-Roll  or  D:\Wedding\A-Roll"
                  className="mt-1 w-full rounded-md border border-line px-3 py-2 font-mono text-xs text-ink outline-none focus:border-ink"
                />
              </label>
              <a
                href={`/api/projects/${id}/export/xml?mediaRoot=${encodeURIComponent(mediaRoot)}`}
                className="mt-4 inline-block rounded-md bg-ink px-4 py-2 text-sm font-medium text-white"
              >
                Export Premiere XML
              </a>
            </div>
            <div className="rounded-lg border border-line p-5">
              <h3 className="font-medium">Spine MP4</h3>
              <p className="mt-1 text-sm text-muted">
                Talking-head cuts stitched with black countdowns in each gap, to hear the flow before Premiere.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  onClick={() => call("/export/mp4", { method: "POST" })}
                  disabled={rendering}
                  className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  {rendering ? "Rendering…" : "Export Spine MP4"}
                </button>
                {project.render.state === "done" && !rendering && (
                  <a href={`/api/projects/${id}/export/mp4`} className="text-sm underline">
                    Download
                  </a>
                )}
              </div>
              {project.render.state !== "idle" && (
                <p className={`mt-3 text-xs ${project.render.state === "error" ? "text-red-700" : "text-muted"}`}>
                  {project.render.message}
                </p>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function SectionTitle({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-line pb-2">
      <span className="text-xs tabular-nums text-muted">0{n}</span>
      <h2 className="font-medium">{title}</h2>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}

function Stat({ label, value, sub, ok }: { label: string; value: string; sub?: string; ok?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className={`text-lg font-medium tabular-nums ${ok === false ? "text-amber-700" : ""}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}
