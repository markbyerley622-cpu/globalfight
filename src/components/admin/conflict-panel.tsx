"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

interface Conflict {
  id: string; entity: string; field: string;
  currentValue: string | null; importedValue: string | null;
  source: string | null; subject?: string | null;
}

const show = (v: string | null) => (v === null || v === "" ? "—" : v);

/**
 * Where the importer and the operator disagree.
 *
 * The lock already decided who wins; this exists so the operator can SEE that a
 * source disagreed and change their mind. Accepting an import also releases the
 * lock — taking the source's value means handing the field back to automation,
 * and re-locking it would raise the identical conflict on every future run.
 */
export function ConflictPanel({ eventId }: { eventId: string }) {
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/events/${eventId}/conflicts`);
      if (res.ok) setConflicts((await res.json()).conflicts ?? []);
    } catch { /* the panel simply stays empty */ }
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  async function resolve(action: "accept" | "keep", conflictId?: string) {
    setBusy(conflictId ?? "all"); setError(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/conflicts`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(conflictId ? { conflictId, action } : { all: true, action }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? "Could not resolve."); return; }
      await load();
      if (action === "accept") window.location.reload(); // values on screen are now stale
    } catch { setError("Could not resolve."); }
    finally { setBusy(null); }
  }

  if (conflicts.length === 0) return null;

  return (
    <section className="rounded-lg border border-gold-500/40 bg-gold-500/5">
      <header className="flex flex-wrap items-center gap-2 border-b border-gold-500/30 px-3 py-2">
        <AlertTriangle className="size-3.5 text-gold-400" />
        <h2 className="font-display text-xs font-bold uppercase tracking-[0.14em] text-gold-200">
          Import disagreements
        </h2>
        <span className="text-[0.7rem] text-gold-300/80">{conflicts.length}</span>
        <div className="ml-auto flex gap-1.5">
          <button
            onClick={() => resolve("accept")}
            disabled={!!busy}
            className="rounded border border-gold-500/40 px-2 py-1 text-[0.7rem] font-semibold text-gold-200 hover:bg-gold-500/15 disabled:opacity-40"
          >
            Accept all
          </button>
          <button
            onClick={() => resolve("keep")}
            disabled={!!busy}
            className="rounded border border-ink-700 px-2 py-1 text-[0.7rem] font-semibold text-fog hover:text-chalk disabled:opacity-40"
          >
            Keep all mine
          </button>
        </div>
      </header>

      {error && <p className="border-b border-gold-500/20 px-3 py-1.5 text-[0.7rem] text-blood-300">{error}</p>}

      <ul className="divide-y divide-gold-500/15">
        {conflicts.map((c) => (
          <li key={c.id} className="px-3 py-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-[0.7rem] text-gold-300">{c.field}</span>
              {c.subject && <span className="text-[0.7rem] text-fog">{c.subject}</span>}
              {c.source && <span className="text-[0.65rem] text-ink-600">via {c.source}</span>}
            </div>
            <div className="mt-1 grid gap-1 sm:grid-cols-2">
              <div className="rounded border border-ink-700 bg-ink-950/50 px-2 py-1">
                <p className="text-[0.6rem] uppercase tracking-wide text-fog">Yours (winning)</p>
                <p className="truncate text-xs text-chalk">{show(c.currentValue)}</p>
              </div>
              <div className="rounded border border-ink-800 bg-ink-950/30 px-2 py-1">
                <p className="text-[0.6rem] uppercase tracking-wide text-fog">Imported</p>
                <p className="truncate text-xs text-mist">{show(c.importedValue)}</p>
              </div>
            </div>
            <div className="mt-1.5 flex gap-1.5">
              <button
                onClick={() => resolve("accept", c.id)}
                disabled={!!busy}
                className="inline-flex items-center gap-1 rounded border border-gold-500/40 px-2 py-0.5 text-[0.68rem] font-semibold text-gold-200 hover:bg-gold-500/15 disabled:opacity-40"
              >
                {busy === c.id && <Loader2 className="size-2.5 animate-spin" />} Accept import
              </button>
              <button
                onClick={() => resolve("keep", c.id)}
                disabled={!!busy}
                className="rounded border border-ink-700 px-2 py-0.5 text-[0.68rem] font-semibold text-fog hover:text-chalk disabled:opacity-40"
              >
                Keep mine
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
