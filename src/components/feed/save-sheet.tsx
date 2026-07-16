"use client";

import { useEffect, useState } from "react";
import { Bookmark, Clock, Heart, Plus, X, FolderPlus } from "lucide-react";
import type { FeedVideo } from "./client";
import { fetchLibrary, saveVideo, createCollection, type CollectionMeta } from "./library-client";

const sysIcon = (system: string | null) =>
  system === "favorites" ? <Heart className="size-5" /> : system === "watch_later" ? <Clock className="size-5" /> : <Bookmark className="size-5" />;

export function SaveSheet({ video, onClose, onSaved }: { video: FeedVideo; onClose: () => void; onSaved?: (videoId: string) => void }) {
  const [collections, setCollections] = useState<CollectionMeta[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => { fetchLibrary().then((d) => setCollections(d.collections)); }, []);

  const addTo = async (c: CollectionMeta) => {
    setBusy(c.id);
    await saveVideo(video, { collectionId: c.id });
    onSaved?.(video.id);
    setBusy(null);
    onClose();
  };
  const makeAndAdd = async () => {
    const nm = name.trim();
    if (!nm) return;
    setBusy("new");
    const c = await createCollection(nm);
    if (c) await saveVideo(video, { collectionId: c.id });
    onSaved?.(video.id);
    setBusy(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[140] flex items-end justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl border border-ink-700 bg-ink-900 p-5 pb-[calc(1.75rem+env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h4 className="font-display text-base font-semibold uppercase tracking-wide">Save to</h4>
          <button onClick={onClose} aria-label="Close" className="flex size-8 items-center justify-center rounded-full border border-ink-700 text-mist"><X className="size-4" /></button>
        </div>

        <div className="max-h-[46vh] space-y-1 overflow-y-auto">
          {collections.map((c) => (
            <button
              key={c.id}
              onClick={() => addTo(c)}
              disabled={busy !== null}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-chalk transition-colors hover:bg-ink-800 disabled:opacity-50"
            >
              <span className="text-mist">{sysIcon(c.system)}</span>
              <span className="flex-1 font-semibold">{c.name}</span>
              <span className="text-xs text-fog">{c.count}</span>
            </button>
          ))}
        </div>

        {creating ? (
          <div className="mt-3 flex gap-2">
            <input
              autoFocus value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") makeAndAdd(); }}
              placeholder="Collection name"
              className="flex-1 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2.5 text-sm text-chalk outline-none focus:border-blood-500/60"
            />
            <button onClick={makeAndAdd} disabled={busy !== null} className="rounded-lg bg-blood-500 px-4 font-display text-sm font-semibold uppercase text-white disabled:opacity-50">Add</button>
          </div>
        ) : (
          <button onClick={() => setCreating(true)} className="mt-3 flex w-full items-center gap-3 rounded-xl border border-dashed border-ink-600 px-3 py-3 text-mist transition-colors hover:border-blood-500/50 hover:text-chalk">
            <FolderPlus className="size-5" /> <span className="font-semibold">New collection</span> <Plus className="ml-auto size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
