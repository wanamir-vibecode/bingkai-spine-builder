import { GoogleGenAI, FileState, createPartFromUri, type Part } from "@google/genai";
import { EDITOR_SYSTEM_PROMPT, SPINE_JSON_SCHEMA, technicalAddendum } from "../prompt";
import type { MediaFile } from "../types";

export const geminiConfigured = () => Boolean(process.env.GEMINI_API_KEY);
export const geminiModel = () => process.env.GEMINI_MODEL || "gemini-pro-latest";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Send the audio proxies straight to a native multimodal model and get the spine JSON back.
 * The model hears tone, pauses and code-switching directly — there is no transcription step.
 */
export async function extractSpineWithGemini(
  media: MediaFile[],
  coupleName: string,
  onProgress: (msg: string) => Promise<void> | void,
): Promise<unknown> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set. Add it to .env.local, or paste spine JSON manually.");
  const ai = new GoogleGenAI({ apiKey });

  const uploaded: { name: string; uri: string; mimeType: string }[] = [];
  try {
    for (const [i, m] of media.entries()) {
      if (!m.proxyPath) throw new Error(`No audio proxy for ${m.filename}`);
      await onProgress(`Uploading audio ${i + 1} of ${media.length} to the AI engine`);
      let file = await ai.files.upload({
        file: m.proxyPath,
        config: { mimeType: "audio/mpeg", displayName: m.filename },
      });
      const deadline = Date.now() + 10 * 60_000;
      while (file.state === FileState.PROCESSING && Date.now() < deadline) {
        await sleep(3000);
        file = await ai.files.get({ name: file.name! });
      }
      if (file.state !== FileState.ACTIVE || !file.uri) {
        throw new Error(`AI engine could not process ${m.filename} (state ${file.state})`);
      }
      uploaded.push({ name: file.name!, uri: file.uri, mimeType: file.mimeType ?? "audio/mpeg" });
    }

    const parts: Part[] = [{ text: technicalAddendum(media, coupleName) }];
    media.forEach((m, i) => {
      parts.push({ text: `FILE ${i + 1}: "${m.filename}"` });
      parts.push(createPartFromUri(uploaded[i].uri, uploaded[i].mimeType));
    });
    parts.push({ text: "Listen to every file in full, then return the Audio Spine JSON." });

    await onProgress(`Listening and building the story (${geminiModel()}) — this can take a few minutes`);
    const response = await ai.models.generateContent({
      model: geminiModel(),
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction: EDITOR_SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseJsonSchema: SPINE_JSON_SCHEMA,
        temperature: 0.4,
      },
    });
    const text = response.text;
    if (!text) throw new Error("AI engine returned an empty response");
    try {
      return JSON.parse(text);
    } catch {
      const match = /\{[\s\S]*\}/.exec(text);
      if (match) return JSON.parse(match[0]);
      throw new Error("AI engine did not return valid JSON");
    }
  } finally {
    await Promise.allSettled(uploaded.map((u) => ai.files.delete({ name: u.name })));
  }
}
