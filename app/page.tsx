"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Summary = { id: string; name: string; coupleName: string; createdAt: string; mediaCount: number; hasSpine: boolean };

export default function Home() {
  const router = useRouter();
  const [projects, setProjects] = useState<Summary[] | null>(null);
  const [name, setName] = useState("");
  const [couple, setCouple] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/projects").then((r) => r.json()).then(setProjects).catch(() => setProjects([]));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name || couple, coupleName: couple }),
    });
    const p = await res.json();
    router.push(`/projects/${p.id}`);
  }

  return (
    <div className="grid gap-16 md:grid-cols-[1fr_1.2fr]">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight">Build the audio spine.</h1>
        <p className="mt-3 max-w-md text-muted">
          Upload the raw speeches, vows and interviews. The story editor listens to every word and returns a
          2–2.5 minute four-act spine with killer-shot gaps, ready for Premiere Pro.
        </p>
        <form onSubmit={create} className="mt-8 space-y-3">
          <input
            value={couple}
            onChange={(e) => setCouple(e.target.value)}
            placeholder="Couple — e.g. Aisyah & Daniel"
            className="w-full rounded-md border border-line px-3 py-2 outline-none focus:border-ink"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name (optional)"
            className="w-full rounded-md border border-line px-3 py-2 outline-none focus:border-ink"
          />
          <button
            disabled={busy}
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            New wedding
          </button>
        </form>
      </section>

      <section>
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted">Weddings</h2>
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {projects === null && <li className="py-4 text-sm text-muted">Loading…</li>}
          {projects?.length === 0 && <li className="py-4 text-sm text-muted">No weddings yet.</li>}
          {projects?.map((p) => (
            <li key={p.id}>
              <Link href={`/projects/${p.id}`} className="flex items-center justify-between py-4 hover:opacity-70">
                <div>
                  <div className="font-medium">{p.coupleName || p.name}</div>
                  <div className="text-xs text-muted">
                    {new Date(p.createdAt).toLocaleDateString()} · {p.mediaCount} file{p.mediaCount === 1 ? "" : "s"}
                  </div>
                </div>
                <span className="text-xs text-muted">{p.hasSpine ? "Spine ready" : "No spine yet"}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
