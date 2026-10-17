import { createReadStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { jsonError, loadProject } from "@/lib/http";
import { isClip } from "@/lib/spine";
import { updateProject } from "@/lib/store";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string; mediaId: string }> };

const MIME: Record<string, string> = {
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", mxf: "application/mxf",
  mts: "video/mp2t", m2ts: "video/mp2t", mkv: "video/x-matroska", webm: "video/webm",
  wav: "audio/wav", mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac",
};

/** Byte-range streaming so the paper-edit player can seek straight to a cut. */
export async function GET(req: Request, { params }: Params) {
  const { id, mediaId } = await params;
  const project = await loadProject(Promise.resolve({ id }));
  if (project instanceof NextResponse) return project;
  const m = project.media.find((x) => x.id === mediaId);
  if (!m) return jsonError("Media not found", 404);

  const usePreview = new URL(req.url).searchParams.get("variant") === "preview" && m.previewPath;
  const filePath = usePreview ? m.previewPath! : m.storedPath;
  const size = (await fs.stat(filePath)).size;
  const type = usePreview
    ? "video/mp4"
    : (MIME[m.filename.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream");
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") ?? "");
  if (!range) {
    const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
    return new Response(stream, {
      headers: { "Content-Type": type, "Content-Length": String(size), "Accept-Ranges": "bytes" },
    });
  }
  let start = range[1] ? Number(range[1]) : size - Number(range[2]);
  let end = range[1] && range[2] ? Number(range[2]) : size - 1;
  start = Math.max(0, start);
  end = Math.min(end, size - 1);
  if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  const stream = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream;
  return new Response(stream, {
    status: 206,
    headers: {
      "Content-Type": type,
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Accept-Ranges": "bytes",
    },
  });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id, mediaId } = await params;
  const project = await loadProject(Promise.resolve({ id }));
  if (project instanceof NextResponse) return project;
  const m = project.media.find((x) => x.id === mediaId);
  if (!m) return jsonError("Media not found", 404);
  if (project.spine?.spine_sequence.some((i) => isClip(i) && i.media_id === mediaId)) {
    return jsonError(`${m.filename} is used in the spine. Remove those clips first.`, 409);
  }
  const updated = await updateProject(project.id, (p) => {
    p.media = p.media.filter((x) => x.id !== mediaId);
  });
  await Promise.all([m.storedPath, m.proxyPath, m.previewPath].filter(Boolean).map((f) => fs.rm(f!, { force: true })));
  return NextResponse.json({ project: updated });
}
