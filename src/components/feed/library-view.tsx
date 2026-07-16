"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Heart, Clock, Bookmark, Play, Trash2, Plus, X, FolderPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { cleanTitle } from "./client";
import { TOPIC_LABEL } from "@/lib/feed/tags";
import {
  fetchLibrary, fetchCollection, createCollection, deleteCollection, unsaveVideo,
  type CollectionMeta, type LibraryItem,
} from "./library-client";

const icon = (system: string | null) =>
  system === "favorites" ? <Heart className="size-5" /> : system === "watch_later" ? <Clock className="size-5" /> : <Bookmark className="size-5" />;

export function LibraryView() {
  const [collections, setCollections] = useState<CollectionMeta[]>([]);
  const [active, setActive] = useState<CollectionMeta | null>(null);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [playing, setPlaying] = useState<LibraryItem | null>(null);

  const loadCollections = useCallback(async () => {
    setLoading(true);
    const d = await fetchLibrary();
    setCollections(d.collections);
    setLoading(false);
  }, []);
  useEffect(() => { loadCollections(); }, [loadCollections]);

  const open = async (c: CollectionMeta) => {
    setActive(c);
    const d = await fetchCollection(c.id);
    setItems(d?.items ?? []);
  };
  const remove = async (videoId: string) => {
    if (!active) return;
    setItems((xs) => xs.filter((x) => x.videoId !== videoId));
    await unsaveVideo(videoId, active.id);
  };
  const make = async () => {
    const nm = name.trim(); if (!nm) return;
    await createCollection(nm);
    setName(""); setCreating(false);
    loadCollections();
  };
  const removeCollection = async (c: CollectionMeta) => {
    await deleteCollection(c.id);
    loadCollections();
  };

  return (
    <div className="container-cr py-6 lg:py-8">
      {!active ? (
        <>
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-bold uppercase tracking-tight text-chalk lg:text-3xl">Your Library</h1>
              <p className="mt-1 text-sm text-mist">Saved fights, Watch Later and your collections.</p>
            </div>
            <Link href="/" className="inline-flex items-center gap-2 rounded-lg border border-ink-600 bg-ink-800/40 px-4 py-2.5 font-display text-sm font-semibold uppercase tracking-wide text-chalk hover:border-blood-500/60">
              <ChevronLeft className="size-4" /> Feed
            </Link>
          </div>

          {loading ? (
            <p className="py-16 text-center text-mist">Loading…</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {collections.map((c) => (
                <div key={c.id} className="group relative">
                  <button
                    onClick={() => open(c)}
                    className="flex w-full items-center gap-4 rounded-card border border-ink-700 bg-ink-900 p-5 text-left transition-all hover:-translate-y-0.5 hover:border-blood-500/50 hover:shadow-glow-red"
                  >
                    <span className="flex size-12 items-center justify-center rounded-xl bg-blood-500/15 text-blood-300">{icon(c.system)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-display text-lg font-bold uppercase tracking-tight text-chalk">{c.name}</span>
                      <span className="text-sm text-mist">{c.count} {c.count === 1 ? "fight" : "fights"}</span>
                    </span>
                  </button>
                  {c.system === null && (
                    <button onClick={() => removeCollection(c)} aria-label="Delete collection" className="absolute right-3 top-3 hidden size-8 items-center justify-center rounded-full border border-ink-700 bg-ink-850 text-fog hover:text-down group-hover:flex">
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
              ))}

              {creating ? (
                <div className="flex items-center gap-2 rounded-card border border-dashed border-ink-600 p-4">
                  <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && make()}
                    placeholder="Collection name" className="flex-1 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2.5 text-sm text-chalk outline-none focus:border-blood-500/60" />
                  <button onClick={make} className="rounded-lg bg-blood-500 px-4 py-2.5 font-display text-sm font-semibold uppercase text-white">Add</button>
                  <button onClick={() => setCreating(false)} aria-label="Cancel" className="text-mist"><X className="size-5" /></button>
                </div>
              ) : (
                <button onClick={() => setCreating(true)} className="flex items-center justify-center gap-2 rounded-card border border-dashed border-ink-600 p-5 text-mist transition-colors hover:border-blood-500/50 hover:text-chalk">
                  <FolderPlus className="size-5" /> <span className="font-display font-semibold uppercase tracking-wide">New collection</span> <Plus className="size-4" />
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="mb-6 flex items-center gap-3">
            <button onClick={() => setActive(null)} aria-label="Back" className="flex size-10 items-center justify-center rounded-full border border-ink-700 bg-ink-850 text-chalk"><ChevronLeft className="size-5" /></button>
            <div>
              <h1 className="font-display text-2xl font-bold uppercase tracking-tight text-chalk">{active.name}</h1>
              <p className="text-sm text-mist">{items.length} {items.length === 1 ? "fight" : "fights"}</p>
            </div>
          </div>
          {items.length === 0 ? (
            <p className="py-16 text-center text-mist">Nothing saved here yet. Tap <Bookmark className="inline size-4" /> on any fight to add it.</p>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {items.map((it) => (
                <article key={it.videoId} className="group overflow-hidden rounded-card border border-ink-700 bg-ink-900 transition-all hover:-translate-y-1 hover:border-blood-500/50">
                  <button onClick={() => setPlaying(it)} className="relative block aspect-video w-full overflow-hidden bg-ink-800">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`https://i.ytimg.com/vi/${it.videoId}/hqdefault.jpg`} alt="" loading="lazy" className="size-full object-cover transition-transform duration-500 group-hover:scale-105" />
                    <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                      <span className="flex size-14 items-center justify-center rounded-full border border-white/25 bg-white/15 backdrop-blur-md"><Play className="ml-0.5 size-5 fill-white text-white" /></span>
                    </span>
                    {it.topic && <span className="absolute right-3 top-3 rounded-md bg-black/60 px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-wider text-chalk backdrop-blur-sm">{TOPIC_LABEL[it.topic] ?? it.topic}</span>}
                  </button>
                  <div className="p-3.5">
                    <p className="line-clamp-2 text-sm font-semibold leading-snug text-chalk">{cleanTitle(it.title)}</p>
                    <div className="mt-1.5 flex items-center justify-between text-xs text-mist">
                      <span className="truncate font-semibold text-chalk/80">{cleanTitle(it.channel)}</span>
                      <button onClick={() => remove(it.videoId)} aria-label="Remove" className="ml-2 flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 hover:bg-ink-800 hover:text-down">
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {playing && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 p-4" onClick={() => setPlaying(null)}>
          <div className="w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-4">
              <p className="line-clamp-1 font-display font-semibold text-chalk">{cleanTitle(playing.title)}</p>
              <button onClick={() => setPlaying(null)} aria-label="Close" className="flex size-9 items-center justify-center rounded-full border border-ink-700 bg-ink-850 text-chalk"><X className="size-5" /></button>
            </div>
            <div className="aspect-video w-full overflow-hidden rounded-card border border-ink-700 bg-black">
              <iframe src={`https://www.youtube-nocookie.com/embed/${playing.videoId}?autoplay=1&rel=0`} className="size-full" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
