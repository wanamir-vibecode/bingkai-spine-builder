import { secondsToFrames, timecodeToSeconds } from "./timecode";
import { isClip } from "./spine";
import type { MediaFile, Rate, Spine } from "./types";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const rateXml = (r: Rate) => `<rate><timebase>${r.timebase}</timebase><ntsc>${r.ntsc ? "TRUE" : "FALSE"}</ntsc></rate>`;

/**
 * Build a Premiere-style file:// URL. Accepts POSIX (/Volumes/SSD/...) and Windows (D:\Footage\...)
 * paths; Premiere writes drive letters as "D%3a".
 */
export function toPathUrl(fullPath: string): string {
  const p = fullPath.replace(/\\/g, "/");
  const parts = p.split("/").filter((seg, i) => seg !== "" || i === 0);
  const encoded = parts.map((seg, i) => {
    if (i === 0 && /^[A-Za-z]:$/.test(seg)) return `${seg[0]}%3a`;
    return encodeURIComponent(seg);
  });
  const joined = encoded.join("/");
  return `file://localhost/${joined.replace(/^\/+/, "")}`;
}

export function linkedPath(m: MediaFile, mediaRoot: string): string {
  const root = mediaRoot.trim();
  if (!root) return m.storedPath;
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return root.replace(/[\\/]+$/, "") + sep + m.filename;
}

// Premiere label colours, one per act, so the four-act structure reads at a glance.
const ACT_LABELS = ["Iris", "Caribbean", "Mango", "Rose"];
const labelFor = (act: string) => {
  const n = Number(/act\s*(\d)/i.exec(act)?.[1] ?? 0);
  return ACT_LABELS[(n - 1 + ACT_LABELS.length) % ACT_LABELS.length] ?? "Violet";
};

function pickSequenceRate(spine: Spine, media: MediaFile[]): Rate {
  const counts = new Map<string, { rate: Rate; n: number }>();
  for (const item of spine.spine_sequence) {
    if (!isClip(item)) continue;
    const m = media.find((x) => x.id === item.media_id);
    if (!m?.hasVideo) continue;
    const key = `${m.rate.timebase}/${m.rate.ntsc}`;
    counts.set(key, { rate: m.rate, n: (counts.get(key)?.n ?? 0) + 1 });
  }
  const best = [...counts.values()].sort((a, b) => b.n - a.n)[0];
  return best?.rate ?? media.find((m) => m.hasVideo)?.rate ?? { timebase: 25, ntsc: false };
}

type Placed = {
  index: number;
  media: MediaFile;
  start: number;
  end: number;
  in: number;
  out: number;
  name: string;
  speaker: string;
  quote: string;
  note: string;
  act: string;
};

type Marker = { start: number; end: number; name: string; comment: string };

export function buildPremiereXml(spine: Spine, media: MediaFile[], opts: { mediaRoot?: string; sequenceName?: string } = {}): string {
  const seqRate = pickSequenceRate(spine, media);
  const fmtMedia = media.find((m) => m.hasVideo && m.width && m.height);
  const width = fmtMedia?.width ?? 1920;
  const height = fmtMedia?.height ?? 1080;

  const placed: Placed[] = [];
  const markers: Marker[] = [];
  let cursor = 0;
  for (const item of spine.spine_sequence) {
    if (isClip(item)) {
      const m = media.find((x) => x.id === item.media_id);
      if (!m) continue;
      const inF = secondsToFrames(item.in_seconds, seqRate);
      const len = Math.max(1, secondsToFrames(item.out_seconds, seqRate) - inF);
      placed.push({
        index: placed.length + 1,
        media: m,
        start: cursor,
        end: cursor + len,
        in: inF,
        out: inF + len,
        name: m.filename,
        speaker: item.speaker,
        quote: item.verbatim_quote,
        note: item.delivery_note,
        act: item.act,
      });
      cursor += len;
    } else {
      const len = secondsToFrames(item.gap_duration_seconds, seqRate);
      markers.push({
        start: cursor,
        end: cursor + len,
        name: `V2 KILLER SHOT · ${item.gap_duration_seconds}s · ${item.act}`,
        comment: item.premiere_marker_note,
      });
      cursor += len;
    }
  }
  const total = cursor;

  // Files are fully described the first time they appear, then referenced by id.
  const fileIds = new Map<string, string>();
  const fileXml = (m: MediaFile) => {
    const existing = fileIds.get(m.id);
    if (existing) return `<file id="${existing}"/>`;
    const id = `file-${fileIds.size + 1}`;
    fileIds.set(m.id, id);
    const tcString = m.startTimecode && /^\d\d:\d\d:\d\d[:;]\d\d$/.test(m.startTimecode) ? m.startTimecode : "00:00:00:00";
    const tcSec = timecodeToSeconds(tcString, m.rate)?.seconds ?? 0;
    const channels = Math.max(1, m.audioChannels);
    return [
      `<file id="${id}">`,
      `<name>${esc(m.filename)}</name>`,
      `<pathurl>${esc(toPathUrl(linkedPath(m, opts.mediaRoot ?? "")))}</pathurl>`,
      rateXml(m.rate),
      `<duration>${secondsToFrames(m.durationSec, m.rate)}</duration>`,
      `<timecode>${rateXml(m.rate)}<string>${tcString}</string><frame>${secondsToFrames(tcSec, m.rate)}</frame><displayformat>${tcString.includes(";") ? "DF" : "NDF"}</displayformat></timecode>`,
      `<media>`,
      m.hasVideo
        ? `<video><samplecharacteristics>${rateXml(m.rate)}<width>${m.width ?? width}</width><height>${m.height ?? height}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></video>`
        : "",
      m.audioChannels > 0
        ? `<audio><samplecharacteristics><depth>16</depth><samplerate>${m.sampleRate ?? 48000}</samplerate></samplecharacteristics><channelcount>${channels}</channelcount></audio>`
        : "",
      `</media>`,
      `</file>`,
    ].join("");
  };

  const videoClips = placed.filter((p) => p.media.hasVideo);
  const a1Clips = placed.filter((p) => p.media.audioChannels > 0);
  const a2Clips = a1Clips.filter((p) => p.media.audioChannels >= 2);

  const vIdx = new Map(videoClips.map((p, i) => [p.index, i + 1]));
  const a1Idx = new Map(a1Clips.map((p, i) => [p.index, i + 1]));
  const a2Idx = new Map(a2Clips.map((p, i) => [p.index, i + 1]));

  const linksFor = (p: Placed) => {
    const links: string[] = [];
    const add = (ref: string, type: string, track: number, idx: number | undefined, group?: number) => {
      if (idx === undefined) return;
      links.push(
        `<link><linkclipref>${ref}</linkclipref><mediatype>${type}</mediatype><trackindex>${track}</trackindex><clipindex>${idx}</clipindex>${group ? `<groupindex>${group}</groupindex>` : ""}</link>`,
      );
    };
    add(`clipitem-v${p.index}`, "video", 1, vIdx.get(p.index));
    add(`clipitem-a1-${p.index}`, "audio", 1, a1Idx.get(p.index), 1);
    add(`clipitem-a2-${p.index}`, "audio", 2, a2Idx.get(p.index), 1);
    return links.length > 1 ? links.join("") : "";
  };

  const clipItem = (p: Placed, id: string, extra: string) =>
    [
      `<clipitem id="${id}">`,
      `<masterclipid>masterclip-${p.media.id}</masterclipid>`,
      `<name>${esc(p.name)}</name>`,
      `<enabled>TRUE</enabled>`,
      `<duration>${secondsToFrames(p.media.durationSec, seqRate)}</duration>`,
      rateXml(seqRate),
      `<start>${p.start}</start><end>${p.end}</end><in>${p.in}</in><out>${p.out}</out>`,
      fileXml(p.media),
      extra,
      linksFor(p),
      `<logginginfo><description>${esc(`${p.speaker}: "${p.quote}"`)}</description><scene>${esc(p.act)}</scene><shottake></shottake><lognote>${esc(p.note)}</lognote><good>FALSE</good></logginginfo>`,
      `<labels><label2>${labelFor(p.act)}</label2></labels>`,
      `</clipitem>`,
    ].join("");

  const audioExtra = (track: number) =>
    `<sourcetrack><mediatype>audio</mediatype><trackindex>${track}</trackindex></sourcetrack>`;

  const v1 = videoClips.map((p) => clipItem(p, `clipitem-v${p.index}`, "")).join("\n");
  const a1 = a1Clips.map((p) => clipItem(p, `clipitem-a1-${p.index}`, audioExtra(1))).join("\n");
  const a2 = a2Clips.map((p) => clipItem(p, `clipitem-a2-${p.index}`, audioExtra(2))).join("\n");

  const track = (content: string, extra = "") =>
    `<track>${content ? `\n${content}\n` : ""}<enabled>TRUE</enabled><locked>FALSE</locked>${extra}</track>`;
  const audioTrack = (content: string, channel: number) =>
    track(content, `<outputchannelindex>${channel}</outputchannelindex>`);

  const markerXml = markers
    .map(
      (mk) =>
        `<marker><name>${esc(mk.name)}</name><comment>${esc(mk.comment)}</comment><in>${mk.start}</in><out>${mk.end}</out></marker>`,
    )
    .join("\n");

  const name = opts.sequenceName ?? `${spine.couple_name} — Audio Spine`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
<sequence id="sequence-1">
<name>${esc(name)}</name>
<duration>${total}</duration>
${rateXml(seqRate)}
<timecode>${rateXml(seqRate)}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>
<in>-1</in><out>-1</out>
<media>
<video>
<format><samplecharacteristics>${rateXml(seqRate)}<width>${width}</width><height>${height}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></format>
${track(v1)}
${track("")}
</video>
<audio>
<numOutputChannels>2</numOutputChannels>
<format><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics></format>
${audioTrack(a1, 1)}
${audioTrack(a2, 2)}
${audioTrack("", 1)}
</audio>
</media>
${markerXml}
</sequence>
</xmeml>
`;
}
