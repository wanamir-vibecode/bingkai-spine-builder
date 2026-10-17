import { promises as fs } from "node:fs";
import path from "node:path";
import { detectSilences, makeAudioProxy, makePreviewProxy } from "./ffmpeg";
import { extractSpineWithGemini } from "./ai/gemini";
import { renderSpine } from "./render";
import { normalizeSpine } from "./spine";
import { proxyDir, readProject, renderDir, setJob, updateProject } from "./store";

// Server-side background jobs. These run inside the long-lived `next start` / `next dev` process.

const inFlight = new Map<string, Promise<void>>();

/** Audio proxy for the AI, pause map for cut snapping. Idempotent and de-duplicated. */
export function prepareMedia(projectId: string, mediaId: string): Promise<void> {
  const key = `${projectId}/${mediaId}`;
  const running = inFlight.get(key);
  if (running) return running;
  const job = (async () => {
    const project = await readProject(projectId);
    const m = project?.media.find((x) => x.id === mediaId);
    if (!m) return;
    await fs.mkdir(proxyDir(projectId), { recursive: true });
    const proxy = path.join(proxyDir(projectId), `${m.id}.mp3`);
    if (!m.proxyPath) await makeAudioProxy(m.storedPath, proxy);
    const silences = m.silences ?? (await detectSilences(proxy));
    await updateProject(projectId, (p) => {
      const target = p.media.find((x) => x.id === mediaId);
      if (target) {
        target.proxyPath = proxy;
        target.silences = silences;
      }
    });
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}

/** Browser-playable preview. Slower than the audio proxy, so it runs after it. */
export async function preparePreview(projectId: string, mediaId: string): Promise<void> {
  const project = await readProject(projectId);
  const m = project?.media.find((x) => x.id === mediaId);
  if (!m?.hasVideo || m.previewPath) return;
  const out = path.join(proxyDir(projectId), `${m.id}_preview.mp4`);
  await fs.mkdir(proxyDir(projectId), { recursive: true });
  await makePreviewProxy(m.storedPath, out);
  await updateProject(projectId, (p) => {
    const target = p.media.find((x) => x.id === mediaId);
    if (target) target.previewPath = out;
  });
}

export async function runAnalysis(projectId: string): Promise<void> {
  const progress = (msg: string) =>
    updateProject(projectId, (p) => setJob(p.analysis, "running", msg)).then(() => undefined);
  try {
    const initial = await readProject(projectId);
    if (!initial) return;
    for (const [i, m] of initial.media.entries()) {
      if (m.proxyPath && m.silences) continue;
      await progress(`Preparing audio proxy ${i + 1} of ${initial.media.length}`);
      await prepareMedia(projectId, m.id);
    }
    const project = (await readProject(projectId))!;
    const raw = await extractSpineWithGemini(project.media, project.coupleName, progress);
    const { spine, warnings } = normalizeSpine(raw, project.media, { coupleName: project.coupleName });
    await updateProject(projectId, (p) => {
      p.spine = spine;
      p.warnings = warnings;
      setJob(p.analysis, "done", `Spine built: ${spine.spine_sequence.length} items`);
    });
  } catch (err) {
    await updateProject(projectId, (p) => setJob(p.analysis, "error", (err as Error).message)).catch(() => {});
  }
}

export async function runRender(projectId: string): Promise<void> {
  try {
    const project = await readProject(projectId);
    if (!project?.spine) throw new Error("Build a spine first");
    const output = await renderSpine(project.spine, project.media, renderDir(projectId), (msg) =>
      updateProject(projectId, (p) => setJob(p.render, "running", msg)).then(() => undefined),
    );
    await updateProject(projectId, (p) => {
      setJob(p.render, "done", "Spine MP4 ready");
      p.render.outputPath = output;
    });
  } catch (err) {
    await updateProject(projectId, (p) => setJob(p.render, "error", (err as Error).message)).catch(() => {});
  }
}
