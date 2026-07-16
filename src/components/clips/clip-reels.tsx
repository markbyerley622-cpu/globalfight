"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Star, Volume2, VolumeX, Plus, Loader2, Upload as UploadIcon } from "lucide-react";
import { useAuth } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { UploadSheet } from "./upload-sheet";

export interface Clip {
  id: string; title: string; videoUrl: string; posterUrl: string | null;
  topic: string | null; communitySlug: string | null; communityName: string | null;
  authorId: string; authorName: string; authorImage: string | null;
  ratingAvg: number; ratingCount: number; myRating: number | null; createdAt: string;
}

// Native-video reels. Unlike the YouTube embed, a muted <video playsinline>
// autoplays reliably on mobile — the IntersectionObserver just plays the one in
// view and pauses the rest. No gesture gymnastics needed.
interface Slot { key: string; clip: Clip }

export function ClipReels({ initial, initialCursor }: { initial: Clip[]; initialCursor: string | null }) {
  const { user } = useAuth();
  // A "slot" is one on-screen reel. The same clip can occupy several slots once
  // we recycle, so slots carry their own unique key (clip.id can repeat).
  const keyCounter = useRef(0);
  const makeSlots = (cs: Clip[]): Slot[] => cs.map((c) => ({ key: `s${keyCounter.current++}`, clip: c }));
  const [slots, setSlots] = useState<Slot[]>(() => makeSlots(initial));
  const [muted, setMuted] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const videos = useRef<Record<string, HTMLVideoElement | null>>({});
  const hlsInstances = useRef<Record<string, { destroy: () => void }>>({});
  const attached = useRef<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const mutedRef = useRef(true);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  // Attach a clip's source to its <video>. HLS (Cloudflare Stream .m3u8) plays
  // natively on Safari/iOS; elsewhere we lazy-load hls.js. Plain MP4/WebM (R2
  // fallback) just sets src. Done imperatively so an HLS attach isn't torn down
  // by React re-renders.
  // Play the video if it's the one currently centred in the viewport (the source
  // may attach after the observer already tried to play it).
  const playIfCentred = (el: HTMLVideoElement) => {
    const r = el.getBoundingClientRect();
    const mid = window.innerHeight / 2;
    if (r.top <= mid && r.bottom >= mid) { el.muted = mutedRef.current; el.play().catch(() => {}); }
  };

  const attachSource = useCallback((el: HTMLVideoElement, url: string, key: string) => {
    if (url.includes(".m3u8") && !el.canPlayType("application/vnd.apple.mpegurl")) {
      import("hls.js").then(({ default: Hls }) => {
        if (!videos.current[key]) return; // unmounted while loading
        if (Hls.isSupported()) {
          const hls = new Hls({ enableWorker: true });
          hls.loadSource(url);
          hls.attachMedia(el);
          hls.on(Hls.Events.MANIFEST_PARSED, () => playIfCentred(el));
          hlsInstances.current[key] = hls;
        } else { el.src = url; playIfCentred(el); }
      }).catch(() => { el.src = url; playIfCentred(el); });
    } else {
      el.src = url; // MP4/WebM, or native HLS on Safari
      playIfCentred(el);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Attach sources for newly-mounted slots; tear down hls for slots that left.
  useEffect(() => {
    for (const { key, clip } of slots) {
      const el = videos.current[key];
      if (el && !attached.current.has(key)) { attached.current.add(key); attachSource(el, clip.videoUrl, key); }
    }
    const live = new Set(slots.map((s) => s.key));
    for (const key of Object.keys(hlsInstances.current)) {
      if (!live.has(key)) { try { hlsInstances.current[key].destroy(); } catch { /* noop */ } delete hlsInstances.current[key]; attached.current.delete(key); }
    }
  }, [slots, attachSource]);

  // Master list of every unique clip we've loaded, + a cursor and a round-robin
  // pointer for recycling once the real pages run out. Refs so the bound
  // IntersectionObserver always reads live values.
  const allClips = useRef<Clip[]>(initial);
  const idSet = useRef<Set<string>>(new Set(initial.map((c) => c.id)));
  const cursorRef = useRef<string | null>(initialCursor);
  const recycleIdx = useRef(0);
  const loadingRef = useRef(false);
  const slotsLenRef = useRef(slots.length);
  useEffect(() => { slotsLenRef.current = slots.length; }, [slots.length]);

  // Take the next N clips from the master list, looping (so the feed never ends).
  const recycleBatch = useCallback((n = 6): Clip[] => {
    const all = allClips.current;
    if (!all.length) return [];
    const out: Clip[] = [];
    for (let i = 0; i < n; i++) out.push(all[recycleIdx.current++ % all.length]);
    return out;
  }, []);

  // Grow the feed: fetch the next real page if there is one, otherwise recycle.
  const extend = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      if (cursorRef.current) {
        const res = await fetch(`/api/clips?cursor=${cursorRef.current}`, { cache: "no-store" });
        const data = (await res.json()) as { items: Clip[]; nextCursor: string | null };
        const fresh = data.items.filter((c) => !idSet.current.has(c.id));
        fresh.forEach((c) => { idSet.current.add(c.id); allClips.current.push(c); });
        cursorRef.current = data.nextCursor;
        setSlots((prev) => [...prev, ...makeSlots(fresh.length ? fresh : recycleBatch())]);
      } else {
        setSlots((prev) => [...prev, ...makeSlots(recycleBatch())]);
      }
    } catch { /* keep what we have */ }
    loadingRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recycleBatch]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        const v = en.target as HTMLVideoElement;
        if (en.isIntersecting && en.intersectionRatio >= 0.6) {
          v.muted = mutedRef.current;
          v.play().catch(() => {});
          // Grow before the user reaches the bottom → seamless endless scroll.
          const idx = Number(v.dataset.idx);
          if (idx >= slotsLenRef.current - 3) void extend();
        } else {
          v.pause();
        }
      }
    }, { threshold: [0, 0.6, 1] });
    Object.values(videos.current).forEach((v) => v && io.observe(v));
    return () => io.disconnect();
  }, [slots, extend]);

  function toggleMute() {
    setMuted((m) => {
      const next = !m;
      Object.values(videos.current).forEach((v) => { if (v) v.muted = next; });
      return next;
    });
  }

  async function rate(clip: Clip, value: number) {
    if (!user) return;
    const apply = (patch: Partial<Clip>) => {
      setSlots((prev) => prev.map((s) => s.clip.id === clip.id ? { ...s, clip: { ...s.clip, ...patch } } : s));
      allClips.current = allClips.current.map((c) => c.id === clip.id ? { ...c, ...patch } : c);
    };
    apply({ myRating: value });
    try {
      const res = await fetch(`/api/clips/${clip.id}/rate`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ value }),
      });
      const data = await res.json();
      if (res.ok) apply({ ratingAvg: data.ratingAvg, ratingCount: data.ratingCount, myRating: data.myRating });
    } catch { /* keep optimistic */ }
  }

  const prependClip = (c: Clip) => {
    if (!idSet.current.has(c.id)) { idSet.current.add(c.id); allClips.current = [c, ...allClips.current]; }
    setSlots((prev) => [...makeSlots([c]), ...prev]);
  };

  if (!slots.length) {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center gap-5 bg-ink-950 px-6 text-center">
        <p className="font-display text-lg font-bold text-chalk">No clips yet</p>
        <p className="max-w-sm text-sm text-fog">Be the first to upload a fight. Uploaded clips autoplay in the feed and get rated by the community.</p>
        {user ? (
          <button onClick={() => setUploadOpen(true)} className="inline-flex items-center gap-2 rounded-lg bg-blood-500 px-5 py-2.5 font-display text-sm font-semibold uppercase text-white hover:bg-blood-400">
            <UploadIcon className="size-4" /> Upload a clip
          </button>
        ) : (
          <Link href="/account" className="rounded-lg bg-blood-500 px-5 py-2.5 font-display text-sm font-semibold uppercase text-white hover:bg-blood-400">Sign in to upload</Link>
        )}
        {uploadOpen && <UploadSheet onClose={() => setUploadOpen(false)} onUploaded={(c) => { prependClip(c); setUploadOpen(false); }} />}
      </div>
    );
  }

  return (
    <div className="relative bg-black">
      {/* top actions */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-20 flex items-center gap-3 px-4 pt-[calc(0.9rem+env(safe-area-inset-top))]">
        <span className="pointer-events-none font-display text-sm font-semibold uppercase tracking-wide text-chalk/90 [text-shadow:0_1px_6px_rgba(0,0,0,0.8)]">Clips</span>
        <div className="flex-1" />
        <button onClick={toggleMute} aria-label="Sound" className="pointer-events-auto flex size-10 items-center justify-center rounded-full border border-white/15 bg-black/40 text-chalk backdrop-blur-md">
          {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
        </button>
        {user && (
          <button onClick={() => setUploadOpen(true)} aria-label="Upload" className="pointer-events-auto flex size-10 items-center justify-center rounded-full bg-blood-500 text-white">
            <Plus className="size-5" />
          </button>
        )}
      </div>

      <div ref={containerRef} className="h-[100dvh] snap-y snap-mandatory overflow-y-scroll">
        {slots.map(({ key, clip }, i) => (
          <section key={key} className="relative flex h-[100dvh] snap-start snap-always items-center justify-center overflow-hidden bg-black">
            <video
              // Mute is controlled imperatively (here + in the observer + toggle),
              // NOT via a React prop — a React-managed `muted` prop is the known
              // cause of muted-autoplay being blocked, and would re-mute on every
              // re-render. The IntersectionObserver sets muted then calls play().
              ref={(el) => { if (el) { videos.current[key] = el; el.muted = mutedRef.current; } else { delete videos.current[key]; } }}
              data-idx={i}
              poster={clip.posterUrl ?? undefined}
              className="absolute inset-0 size-full object-contain"
              loop
              playsInline
              preload="auto"
              onClick={(e) => { const v = e.currentTarget; v.paused ? v.play().catch(() => {}) : v.pause(); }}
            />
            <div className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-b from-black/30 via-transparent to-black/80" />

            {/* rating rail */}
            <div className="absolute bottom-[calc(7rem+env(safe-area-inset-bottom))] right-3.5 z-[3] flex flex-col items-center gap-1">
              <div className="flex flex-col items-center gap-0.5 rounded-2xl bg-black/35 p-2 backdrop-blur-md">
                {[5, 4, 3, 2, 1].map((n) => (
                  <button
                    key={n}
                    onClick={() => rate(clip, n)}
                    disabled={!user}
                    aria-label={`Rate ${n}`}
                    className="disabled:opacity-50"
                  >
                    <Star className={cn("size-6 transition-colors", (clip.myRating ?? 0) >= n ? "fill-gold-400 text-gold-400" : "text-white/80")} />
                  </button>
                ))}
              </div>
              <span className="mt-1 text-[0.7rem] font-semibold tabular-nums text-white/95 [text-shadow:0_1px_5px_rgba(0,0,0,0.9)]">
                {clip.ratingAvg ? clip.ratingAvg.toFixed(1) : "—"}
              </span>
              <span className="text-[0.6rem] text-white/60">{clip.ratingCount} rating{clip.ratingCount === 1 ? "" : "s"}</span>
            </div>

            {/* info */}
            <div className="absolute bottom-[calc(1.9rem+env(safe-area-inset-bottom))] left-4 right-[5.25rem] z-[3] text-chalk">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="font-display text-[0.95rem] font-bold tracking-tight [text-shadow:0_1px_6px_rgba(0,0,0,0.7)]">{clip.authorName}</span>
                {clip.communitySlug && (
                  <Link href={`/community/${clip.communitySlug}`} className="pointer-events-auto rounded-full bg-white/10 px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-wider text-chalk/90">
                    {clip.communityName}
                  </Link>
                )}
              </div>
              <p className="line-clamp-2 text-[0.9rem] font-medium leading-snug [text-shadow:0_1px_8px_rgba(0,0,0,0.85)]">{clip.title}</p>
              {!user && <p className="mt-1 text-[0.7rem] text-chalk/60">Sign in to rate</p>}
            </div>
          </section>
        ))}
      </div>

      {uploadOpen && <UploadSheet onClose={() => setUploadOpen(false)} onUploaded={(c) => { prependClip(c); setUploadOpen(false); }} />}
    </div>
  );
}
