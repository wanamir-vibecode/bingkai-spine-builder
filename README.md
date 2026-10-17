# Bingkai Spine Builder (MVP)

Upload raw wedding A-roll (speeches, vows, interviews). A native multimodal model listens to it and returns a
2–2.5 minute, four-act **audio spine** with 5–8 s killer-shot gaps. Review it as a paper edit, then export:

- **Premiere XML** (FCP7 `xmeml` v4): A-roll on V1 + A1/A2, empty space for every gap, and a duration marker
  on each gap carrying the `premiere_marker_note`. V2 and A3 are left empty for B-roll and NAT sound.
  Clips are labelled by act colour, with speaker, quote and delivery note in the clip's log info.
- **Spine MP4**: 720p stitched cuts with a black countdown card during each gap.

## Run it

Requires Node 20+ and FFmpeg/ffprobe on `PATH` (built with libx264, libmp3lame and, for the countdown text, libfreetype).

```bash
npm install
cp .env.example .env.local     # add GEMINI_API_KEY
npm run build && npm start     # http://localhost:3000
```

This is a **local-first** app: run it on the editing machine or a studio server. Uploads, proxies and renders
live in `./data` (override with `BINGKAI_DATA_DIR`). If the XML must point at the camera cards rather than the
uploaded copies, set **Original footage folder** before exporting (e.g. `/Volumes/SSD/Wedding/A-Roll` or
`D:\Wedding\A-Roll`). Files are then linked as `<folder>/<original filename>`.

## How the pipeline works

1. **Upload** streams to disk (multi-GB safe), then `ffprobe` reads the duration, frame rate (NTSC-aware), channels and embedded timecode.
2. **Prep** (background): a 16 kHz mono MP3 proxy for the model, a `silencedetect` pause map, and a 540p H.264 preview for the browser (10-bit 4:2:2 camera files won't play in browsers).
3. **Extraction**: the proxies go to Gemini via the Files API, with the PRD's editorial prompt as the system instruction (`lib/prompt.ts`) and a JSON schema. A technical addendum asks for cuts as decimal seconds and for non-English quotes in the original script plus an `[EN: …]` gloss.
4. **Normalisation** (`lib/spine.ts`): matches filenames, snaps each in/out to the nearest pause within 0.6 s so cuts land on breaths, clamps gaps to 5–8 s, and re-derives `HH:MM:SS:FF` at each source's own frame rate. Warnings cover a spoken total outside 90–120 s, missing acts, and back-to-back gaps.
5. **Paper edit**: drag or use ↑↓ to reorder, ± to trim in/out by 0.25 s, a slider for gap length, editable marker notes, and you can change a clip's act or insert/remove items. Edits autosave.

You can skip the AI step by pasting JSON in the PRD schema ("Paste spine JSON instead"). Either `in_point`/`out_point`
timecodes or `in_seconds`/`out_seconds` work.

## Notes

- Seconds are the canonical cut position. Model-supplied timecodes with impossible frame fields (e.g. `:36` at 25 fps) are clamped and flagged.
- The sequence frame rate is the most common rate among the clips used. Mixed-rate sources are conformed by Premiere.
- The AI engine is behind `lib/ai/gemini.ts`. Set `GEMINI_MODEL` to pin a specific model.
- Jobs run in-process. A job interrupted by a server restart can be restarted after 15 minutes.

## Develop

```bash
npm run dev
npm test          # timecode/spine/XML unit tests + a real FFmpeg render on synthetic footage
npm run typecheck
```
