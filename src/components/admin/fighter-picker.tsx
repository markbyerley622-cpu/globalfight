"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

interface Hit { id: string; name: string; sport: string; record: string }

/** Two typeaheads against the existing fighter table. Debounced, server-side —
 *  the roster is far too large to filter in the browser. */
export function FighterPicker({ onPick, onCancel }: {
  onPick: (redId: string, blueId: string) => void; onCancel: () => void;
}) {
  const [red, setRed] = useState<Hit | null>(null);
  const [blue, setBlue] = useState<Hit | null>(null);

  return (
    <div className="rounded-md border border-ink-700 bg-ink-900 p-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <Search label="Red corner" picked={red} onPick={setRed} />
        <Search label="Blue corner" picked={blue} onPick={setBlue} />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          disabled={!red || !blue || red.id === blue.id}
          onClick={() => red && blue && onPick(red.id, blue.id)}
          className="rounded bg-blood-500 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-40"
        >
          Add bout
        </button>
        <button onClick={onCancel} className="px-1.5 text-xs text-fog hover:text-chalk">Cancel</button>
        {red && blue && red.id === blue.id && (
          <span className="text-[0.7rem] text-blood-300">A fighter cannot face themselves.</span>
        )}
      </div>
    </div>
  );
}

function Search({ label, picked, onPick }: { label: string; picked: Hit | null; onPick: (h: Hit | null) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (picked || q.trim().length < 2) { setHits([]); return; }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await fetch(`/api/admin/fighters?q=${encodeURIComponent(q)}`);
        setHits(res.ok ? (await res.json()).fighters ?? [] : []);
      } finally { setBusy(false); }
    }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q, picked]);

  if (picked) {
    return (
      <div className="flex items-center gap-2 rounded border border-ink-700 bg-ink-950/60 px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate text-sm text-chalk">{picked.name}</span>
        <span className="text-[0.65rem] tabular-nums text-fog">{picked.record}</span>
        <button onClick={() => onPick(null)} className="text-xs text-fog hover:text-chalk">×</button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={label}
        className="w-full rounded border border-ink-700 bg-ink-950/60 px-2 py-1.5 text-sm text-chalk outline-none placeholder:text-ink-600 focus:border-blood-500/60"
      />
      {busy && <Loader2 className="absolute right-2 top-2 size-3.5 animate-spin text-fog" />}
      {hits.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded border border-ink-700 bg-ink-900 shadow-xl">
          {hits.map((h) => (
            <li key={h.id}>
              <button
                onClick={() => { onPick(h); setQ(""); setHits([]); }}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm text-mist hover:bg-ink-800 hover:text-chalk"
              >
                <span className="min-w-0 flex-1 truncate">{h.name}</span>
                <span className="text-[0.65rem] tabular-nums text-fog">{h.record}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
