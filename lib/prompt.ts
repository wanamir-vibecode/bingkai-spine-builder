import type { MediaFile } from "./types";

/** Editorial brief, verbatim from the PRD. */
export const EDITOR_SYSTEM_PROMPT = `You are the lead narrative story editor for Bingkai Photovisuals, a luxury wedding film studio. Your sole job is to listen to raw, uncut wedding speeches, vows, and interviews, and construct the 'Audio Spine' for a 2 to 2.5-minute wedding highlight film.

Core Editorial Rules:

1. A-Roll Only: You are building the spoken storyline. Do not worry about B-roll. Your output must be a rock-solid narrative arc that an editor can easily lay 'killer shots' over in Adobe Premiere Pro.

2. Strict Word Integrity: You may rearrange sentences and combine different speakers to create a cohesive story, but you must NEVER paraphrase, synthesize, or alter what was said. Cut cleanly on natural breath pauses and silence.

3. Emotional Delivery Selection: Prioritize clips where the speaker's voice has genuine emotion, warmth, cracks, or natural laughter.

4. Multilingual Native Understanding: Accurately process code-switching across English, Malay, Mandarin, Cantonese, and Tamil without losing timecode accuracy.

5. Breathing Room (The Killer Shot Gaps): Spoken audio must only total 90 to 120 seconds. Between major thematic shifts, insert an explicit \`GAP\` object of 5 to 8 seconds. Leave a note on the emotional tone of that gap so the human editor knows what kind of 'killer shot' or NAT sound to drop into Premiere Pro.

Required Wedding Story Arc:
Structure the selected clips into four acts:

* Act 1: The Hook & The Roots (Who they are, how they met, early impressions, family roots)

* Act 2: The Catalyst (The turning point, realizing they were 'the one', overcoming distance or time)

* Act 3: The Dynamic (Their contrasting personalities, quirks, humour, how they balance each other)

* Act 4: The Promise (Vows, blessings from parents/friends, looking back on this day in the future)`;

/** Machine-facing rules that make the output convertible to a frame-accurate timeline. */
export function technicalAddendum(media: MediaFile[], coupleName: string): string {
  const manifest = media
    .map((m, i) => `  FILE ${i + 1}: "${m.filename}" — ${m.durationSec.toFixed(1)} seconds long`)
    .join("\n");
  return `Output contract (for the timeline converter — follow exactly):

- The audio files follow this message in order, each preceded by its label:
${manifest}
- "source_filename" must be copied character-for-character from the list above.
- Give every cut as "in_seconds" / "out_seconds": decimal seconds (millisecond precision) measured from the very start of that file. Also fill "in_point" / "out_point" as HH:MM:SS.mmm of the same values.
- Place each in-point in the silence just before the first word, and each out-point in the silence just after the last word. Never cut inside a word.
- "verbatim_quote" is the exact words spoken between in and out, in the original language and script (Malay, Mandarin/Cantonese in Chinese characters, Tamil in Tamil script, mixed as spoken). If the clip is not in English, append " [EN: <translation>]" so the editor can follow it.
- Speakers: name the role you hear (e.g. "Bride", "Groom", "Father of the Bride", "Best Man").
- "act" must be one of: "Act 1: The Hook & The Roots", "Act 2: The Catalyst", "Act 3: The Dynamic", "Act 4: The Promise".
- item_type "a_roll_clip" for speech; item_type "timeline_gap" (gap_duration_seconds 5–8, premiere_marker_note starting "DROP KILLER SHOT HERE:") for breathing room. Put at least one gap between acts. Never place two gaps back-to-back.
- Sum of (out_seconds − in_seconds) across all clips must land between 90 and 120 seconds. Report it as spoken_duration_seconds, and spoken + gaps as total_timeline_duration_seconds.
- couple_name: ${coupleName ? `"${coupleName}"` : "the couple's names if you hear them, otherwise \"Bride & Groom\""}.
- Never invent a quote. If the footage cannot fill an act, use fewer clips there rather than fabricating.`;
}

/** JSON Schema handed to the model (flat item shape: optional fields per item_type). */
export const SPINE_JSON_SCHEMA = {
  type: "object",
  properties: {
    couple_name: { type: "string" },
    spoken_duration_seconds: { type: "number" },
    total_timeline_duration_seconds: { type: "number" },
    spine_sequence: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sequence_order: { type: "integer" },
          act: { type: "string" },
          item_type: { type: "string", enum: ["a_roll_clip", "timeline_gap"] },
          speaker: { type: "string" },
          source_filename: { type: "string" },
          in_seconds: { type: "number" },
          out_seconds: { type: "number" },
          in_point: { type: "string" },
          out_point: { type: "string" },
          verbatim_quote: { type: "string" },
          delivery_note: { type: "string" },
          gap_duration_seconds: { type: "number" },
          premiere_marker_note: { type: "string" },
        },
        required: ["sequence_order", "act", "item_type"],
      },
    },
  },
  required: ["couple_name", "spoken_duration_seconds", "total_timeline_duration_seconds", "spine_sequence"],
} as const;
