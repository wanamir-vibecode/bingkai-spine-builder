import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import { NextResponse } from "next/server";
import { probe } from "@/lib/ffmpeg";
import { jsonError, loadProject, safeFilename, type IdParams } from "@/lib/http";
import { prepareMedia, preparePreview } from "@/lib/jobs";
import { mediaDir, newId, updateProject } from "@/lib/store";
import type { MediaFile } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Streamed upload: the raw request body is the file (camera originals can be several GB,
 * so it is never buffered in memory). Filename comes from ?filename=.
 */
export async function POST(req: Request, { params }: IdParams) {
  const project = await loadProject(params);
  if (project instanceof NextResponse) return project;
  const original = new URL(req.url).searchParams.get("filename");
  if (!original) return jsonError("filename query parameter is required");
  if (!req.body) return jsonError("Empty upload");

  const filename = safeFilename(original);
  if (project.media.some((m) => m.filename.toLowerCase() === filename.toLowerCase())) {
    return jsonError(`${filename} is already in this project`, 409);
  }

  const id = newId();
  const dir = mediaDir(project.id);
  await fs.mkdir(dir, { recursive: true });
  const storedPath = path.join(dir, `${id}${path.extname(filename)}`);
  try {
    await pipeline(Readable.fromWeb(req.body as unknown as NodeWebStream), createWriteStream(storedPath));
  } catch (err) {
    await fs.rm(storedPath, { force: true });
    return jsonError(`Upload failed: ${(err as Error).message}`, 500);
  }

  let info;
  try {
    info = await probe(storedPath);
  } catch (err) {
    await fs.rm(storedPath, { force: true });
    return jsonError(`${filename} is not a readable audio/video file: ${(err as Error).message}`, 422);
  }

  const media: MediaFile = {
    id,
    filename,
    storedPath,
    sizeBytes: (await fs.stat(storedPath)).size,
    ...info,
    proxyPath: null,
    previewPath: null,
    silences: null,
    uploadedAt: new Date().toISOString(),
  };
  const updated = await updateProject(project.id, (p) => {
    p.media.push(media);
  });
  // Build the AI proxy, pause map and preview in the background so analysis can start sooner.
  void prepareMedia(project.id, id)
    .then(() => preparePreview(project.id, id))
    .catch(() => {});
  return NextResponse.json({ media, project: updated }, { status: 201 });
}
