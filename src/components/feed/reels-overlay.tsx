"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Heart, MessageCircle, Share2, Volume2, VolumeX, MoreVertical, X, ChevronDown, EyeOff, Bookmark,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { useScrollLock } from "@/lib/use-scroll-lock";
import { TOPIC_LABEL, contentPill } from "@/lib/feed/tags";
import {
  getClientId, loadYT, fmtViews, timeAgo, cleanTitle, posterUrl, preloadPosters,
  isNewToday, getRecentOpeners, pushOpener, type FeedVideo, type YTPlayer,
} from "./client";
import { SaveSheet } from "./save-sheet";
import { DiscussionSheet } from "./discussion-sheet";
import { fetchLibrary } from "./library-client";

const REELS_ENDPOINT = "/api/feed/reels";
const MAX_ITEMS = 600;

// ── Lifecycle instrumentation (opt-in via ?fdebug=1). Logs to console AND an
// on-screen panel so the exact playback chain can be captured on a real device.
const YT_STATE: Record<number, string> = { [-1]: "UNSTARTED", 0: "ENDED", 1: "PLAYING", 2: "PAUSED", 3: "BUFFERING", 5: "CUED" };
let dbgOn: boolean | null = null;
function dbg(msg: string) {
  if (typeof window === "undefined") return;
  if (dbgOn === null) dbgOn = new URLSearchParams(window.location.search).get("fdebug") === "1";
  if (!dbgOn) return;
  const line = `${(performance.now() / 1000).toFixed(2)}s ${msg}`;
  console.log("[reel]", line);
  let el = document.getElementById("cr-reel-debug");
  if (!el) {
    el = document.createElement("div");
    el.id = "cr-reel-debug";
    el.style.cssText = "position:fixed;top:52px;left:6px;z-index:99999;max-width:78vw;max-height:64vh;overflow:auto;background:rgba(0,0,0,.86);color:#0f0;font:10px/1.35 monospace;white-space:pre-wrap;padding:6px;border:1px solid #0f0;border-radius:4px";
    document.body.appendChild(el);
  }
  el.textContent += line + "\n";
  el.scrollTop = el.scrollHeight;
}
const standalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches || (window.navigator as unknown as { standalone?: boolean }).standalone === true);

export function ReelsOverlay({
  open, onClose, query,
}: {
  open: boolean;
  onClose: () => void;
  query: Record<string, string>;
}) {
  const [items, setItems] = useState<FeedVideo[]>([]);
  const [reacted, setReacted] = useState<Record<string, "respect" | "dislike">>({});
  const [moreFor, setMoreFor] = useState<FeedVideo | null>(null);
  const [saveFor, setSaveFor] = useState<FeedVideo | null>(null);
  const [discussFor, setDiscussFor] = useState<FeedVideo | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [prog, setProg] = useState(0); // swipe progress (fraction through loaded reels)

  const cid = useRef<string>("anon");
  const firstBatch = useRef(true); // the opening batch gets opener-rotation params
  // Live snapshot of `items` so the (once-created) IntersectionObserver's
  // activate() always sees the current list — not a stale empty closure.
  const itemsRef = useRef<FeedVideo[]>([]);
  const players = useRef<Record<number, YTPlayer>>({});
  const current = useRef(0);
  const userPaused = useRef<Set<number>>(new Set()); // reels the user deliberately paused
  const muted = useRef(true);
  const ytReady = useRef(false);
  const loadingBatch = useRef(false);
  const lastReactTs = useRef(0);
  const observed = useRef(0);
  const touchStart = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const touchMoved = useRef(false);
  const io = useRef<IntersectionObserver | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ---- data ----
  const fetchBatch = useCallback(async () => {
    if (loadingBatch.current) return;
    loadingBatch.current = true;
    const isFirst = firstBatch.current;
    try {
      const p = new URLSearchParams({ ...query, cid: cid.current, limit: "12" });
      if (isFirst) {
        // First batch of the session: ask the engine to rotate the opener and
        // steer away from the last few clips we opened on (ranked-but-rotating).
        p.set("opener", "1");
        const recent = getRecentOpeners();
        if (recent.length) p.set("excludeOpeners", recent.join(","));
      }
      const res = await fetch(`${REELS_ENDPOINT}?${p.toString()}`);
      const data = (await res.json()) as { videos?: FeedVideo[] };
      const fresh = data.videos ?? [];
      if (fresh.length) {
        preloadPosters(fresh); // warm upcoming thumbnails so scrolling reveals them instantly
        if (isFirst && fresh[0]) pushOpener(fresh[0].id);
        setItems((prev) => {
          if (prev.length >= MAX_ITEMS) return prev;
          const seen = new Set(prev.map((v) => v.id));
          const add = fresh.filter((v) => !seen.has(v.id)); // de-dupe when the pool recycles
          return add.length ? [...prev, ...add] : prev;
        });
      }
    } catch { /* keep what we have */ }
    firstBatch.current = false;
    loadingBatch.current = false;
  }, [query]);

  const signal = useCallback((id: string) => {
    fetch("/api/feed/signal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cid: cid.current, id }) }).catch(() => {});
  }, []);

  // ---- players ----
  const setPaused = (i: number, paused: boolean) => {
    document.querySelector(`[data-reel="${i}"]`)?.classList.toggle("is-paused", paused);
  };
  // Fade the poster out once the video is actually painting; restore it if the
  // player is torn down so a re-scrolled reel shows a crisp frame, not black.
  const setPoster = (i: number, hidden: boolean) => {
    document.querySelector(`[data-reel="${i}"] .cr-reel-poster`)?.classList.toggle("is-hidden", hidden);
  };
  // Start reel i and keep verifying it actually plays. A muted YouTube iframe on
  // mobile frequently ignores a programmatic playVideo() that isn't inside a user
  // gesture (the IntersectionObserver-driven activate() is not one), leaving the
  // Play button up — so we re-issue play a few times until the state is PLAYING.
  const playIndex = useCallback((i: number, attempt = 0) => {
    const p = players.current[i];
    if (!p || typeof p.playVideo !== "function") return;
    if (i !== current.current || userPaused.current.has(i)) return;
    muted.current ? p.mute() : p.unMute();
    try { p.playVideo(); } catch { /* noop */ }
    setPaused(i, false);
    if (attempt < 5) setTimeout(() => {
      if (i !== current.current || userPaused.current.has(i)) return;
      const st = typeof p.getPlayerState === "function" ? p.getPlayerState() : -1;
      const PLAYING = window.YT?.PlayerState.PLAYING, BUFFERING = window.YT?.PlayerState.BUFFERING;
      if (st !== PLAYING && st !== BUFFERING) {
        dbg(`retry play #${i} attempt ${attempt + 1} st=${YT_STATE[st] ?? st}`);
        playIndex(i, attempt + 1);
      }
    }, 220 + attempt * 160);
  }, []);
  const createPlayer = useCallback((i: number, video: FeedVideo) => {
    if (players.current[i] || !window.YT?.Player) return;
    const host = document.getElementById(`cr-pl-${i}`);
    if (!host) return;
    dbg(`create #${i} (${video.id}) standalone=${standalone()}`);
    players.current[i] = new window.YT.Player(host, {
      videoId: video.id,
      // autoplay:1 + mute:1 → the browser permits muted autoplay at the embed
      // level. Programmatic playVideo() after load is blocked on mobile (shows
      // the Play button); the init-level autoplay param is what actually starts
      // muted playback. Preloaded (non-active) players are paused in onReady so
      // only one plays — but they've "started", which unlocks later playVideo().
      playerVars: { autoplay: 1, mute: 1, controls: 0, playsinline: 1, rel: 0, modestbranding: 1, loop: 1, playlist: video.id, fs: 0, disablekb: 1, iv_load_policy: 3 },
      events: {
        onReady: (e: { target: YTPlayer }) => {
          dbg(`onReady #${i} cur=${current.current} st=${YT_STATE[e.target.getPlayerState()]}`);
          e.target.mute(); dbg(`mute #${i}`);
          if (i === current.current) {
            playIndex(i); // active reel: play now (with retry watchdog)
          } else if (i === current.current + 1) {
            // Keep the NEXT reel warm: let it play muted so a forward swipe lands on
            // an already-unlocked, already-playing player instead of a blocked one.
            e.target.playVideo();
            dbg(`warm next #${i}`);
          } else {
            e.target.pauseVideo(); // farther neighbour: don't play offscreen
          }
        },
        onStateChange: (e: { data: number }) => {
          dbg(`state #${i} = ${YT_STATE[e.data] ?? e.data}`);
          if (!window.YT) return;
          // Reveal the video the moment ANY reel starts painting (even a preloaded
          // neighbour) so its poster never lingers over live frames.
          if (e.data === window.YT.PlayerState.PLAYING) setPoster(i, true);
          if (i !== current.current) return;
          if (e.data === window.YT.PlayerState.PLAYING) setPaused(i, false);
          else if (e.data === window.YT.PlayerState.PAUSED) setPaused(i, true);
        },
      },
    });
  }, []);
  const destroyPlayer = (i: number) => {
    const p = players.current[i];
    if (!p) return;
    try { p.destroy(); } catch { /* noop */ }
    delete players.current[i];
    // Rebuild a fresh player host but keep the poster so the reel shows a crisp
    // frame (not black) if the user scrolls back to it.
    const cover = document.querySelector(`[data-reel="${i}"] .cr-reel-cover`);
    if (cover) {
      const poster = cover.querySelector(".cr-reel-poster");
      cover.innerHTML = "";
      if (poster) { poster.classList.remove("is-hidden"); cover.appendChild(poster); }
      const host = document.createElement("div");
      host.id = `cr-pl-${i}`;
      cover.appendChild(host);
    }
  };

  const activate = useCallback((i: number) => {
    current.current = i;
    if (!ytReady.current) { dbg(`activate #${i} SKIPPED (yt not ready)`); return; }
    dbg(`activate #${i}`);
    const list = itemsRef.current; // always current — the observer captures this once
    if (list.length) setProg((i + 1) / list.length);
    for (const off of [0, 1, 2]) if (list[i + off]) createPlayer(i + off, list[i + off]);
    Object.keys(players.current).forEach((k) => { const n = +k; if (n < i - 1 || n > i + 2) destroyPlayer(n); });
    userPaused.current.delete(i); // a fresh scroll onto a reel should always autoplay
    Object.keys(players.current).forEach((k) => {
      const n = +k; const p = players.current[n];
      // Skip players whose IFrame API methods aren't attached yet — a freshly
      // created YT.Player has no methods until its onReady fires (which itself
      // starts playback for the active reel). Calling them early throws.
      if (!p || typeof p.playVideo !== "function") { if (n === i) dbg(`activate #${i}: player not ready, deferring to onReady`); return; }
      if (n === i) {
        // Restart from the top if it was already playing (warm), then ensure play.
        const st = typeof p.getPlayerState === "function" ? p.getPlayerState() : -1;
        if (st === window.YT?.PlayerState.PLAYING && typeof p.seekTo === "function") { try { p.seekTo(0, true); } catch { /* noop */ } }
        playIndex(i);
      } else { try { p.pauseVideo(); } catch { /* noop */ } }
    });
    if (i >= list.length - 5) void fetchBatch();
  }, [createPlayer, fetchBatch, playIndex]);

  // ---- reactions ----
  const spawnBurst = (x: number, y: number, type: "respect" | "disrespect") => {
    const b = document.createElement("div");
    b.className = `cr-react-burst ${type}`;
    b.style.left = `${x}px`; b.style.top = `${y}px`;
    let parts = "";
    if (type === "respect") for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, tx = Math.cos(a) * 60, ty = Math.sin(a) * 60;
      parts += `<i class="cr-rb-p" style="--tx:${tx.toFixed(0)}px;--ty:${ty.toFixed(0)}px"></i>`;
    }
    const glyph = type === "respect"
      ? '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="14" width="10" height="8.5" rx="3"/><rect x="4.6" y="8" width="14.8" height="9" rx="4.2"/><circle cx="7.8" cy="8.4" r="2.3"/><circle cx="12" cy="7.9" r="2.5"/><circle cx="16.2" cy="8.4" r="2.3"/><rect x="3" y="10.4" width="4.6" height="6" rx="2.3"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="9.7" y="2" width="4.6" height="12.5" rx="2.3"/><rect x="4.8" y="11" width="14.4" height="9.5" rx="4.2"/><circle cx="7.4" cy="12" r="2.1"/><circle cx="16.6" cy="12" r="2.1"/><rect x="3" y="13.6" width="4.4" height="5.8" rx="2.2"/></svg>';
    b.innerHTML = `<span class="rb-icon">${glyph}</span>${parts}`;
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 680);
  };

  // "+1 Respect" that flies from the tap toward the Respect rail button.
  const spawnPlusOne = (x: number, y: number, i: number) => {
    const target = document.querySelector(`[data-respect="${i}"]`)?.getBoundingClientRect();
    const dx = target ? target.left + target.width / 2 - x : 0;
    const dy = target ? target.top + target.height / 2 - y : -80;
    const el = document.createElement("div");
    el.className = "cr-plus-one";
    el.style.left = `${x}px`; el.style.top = `${y}px`;
    el.style.setProperty("--dx", `${dx.toFixed(0)}px`);
    el.style.setProperty("--dy", `${dy.toFixed(0)}px`);
    el.textContent = "+1 Respect";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 640);
  };

  const reactAt = useCallback((x: number, y: number, video: FeedVideo) => {
    const now = Date.now();
    if (now - lastReactTs.current < 250) return;
    lastReactTs.current = now;
    const type = y < window.innerHeight / 2 ? "respect" : "disrespect";
    spawnBurst(x, y, type);
    if (type === "respect") spawnPlusOne(x, y, current.current);
    // Haptics where supported (Android Chrome). iOS Safari has no navigator.vibrate,
    // so there's no web-haptic there — we don't fake it.
    // Respect: one firm pulse. Disrespect: a double pulse.
    try { navigator.vibrate?.(type === "respect" ? 35 : [0, 18, 45, 22]); } catch { /* noop */ }
    if (type === "respect") { setReacted((r) => ({ ...r, [video.id]: "respect" })); signal(video.id); }
    else setReacted((r) => ({ ...r, [video.id]: "dislike" }));
  }, [signal]);

  const togglePlay = (i: number) => {
    const p = players.current[i];
    if (!p || !window.YT || typeof p.getPlayerState !== "function") return;
    if (p.getPlayerState() === window.YT.PlayerState.PLAYING) { userPaused.current.add(i); p.pauseVideo(); setPaused(i, true); }
    else { userPaused.current.delete(i); playIndex(i); }
  };
  const toggleMute = () => {
    muted.current = !muted.current;
    try { localStorage.setItem("cr_reels_muted", muted.current ? "1" : "0"); } catch { /* noop */ }
    const p = players.current[current.current];
    if (p && typeof p.mute === "function") { muted.current ? p.mute() : p.unMute(); }
    setItems((v) => [...v]); // reflect sound icon
  };

  // Mobile browsers (esp. iOS Safari) won't start a cross-origin YouTube embed
  // without a user gesture, and on phones the reels auto-open with none — so the
  // first clip sits paused until it's tapped. Turn the FIRST natural gesture
  // (a scroll or a tap, anywhere) into "play the current reel", so playback
  // starts on the user's first touch instead of forcing a deliberate reel tap.
  const primed = useRef(false);
  const justPrimedAt = useRef(0);
  const primePlayback = useCallback(() => {
    if (primed.current) return;
    const p = players.current[current.current];
    if (!p || typeof p.playVideo !== "function") return; // not ready yet — retry on next gesture
    primed.current = true;
    justPrimedAt.current = Date.now();
    muted.current ? p.mute() : p.unMute();
    try { p.playVideo(); } catch { /* noop */ }
    setPaused(current.current, false);
  }, []);

  // per-reel tap handler (single = play/pause, double = react)
  const tapState = useRef<{ last: number; timer: ReturnType<typeof setTimeout> | null }>({ last: 0, timer: null });
  const onReelTap = (e: React.MouseEvent, i: number, video: FeedVideo) => {
    const now = Date.now();
    if (now - tapState.current.last < 300) {
      if (tapState.current.timer) clearTimeout(tapState.current.timer);
      tapState.current.timer = null; tapState.current.last = 0;
      reactAt(e.clientX, e.clientY, video);
    } else {
      tapState.current.last = now;
      tapState.current.timer = setTimeout(() => {
        tapState.current.timer = null;
        // If this same tap just unlocked/started playback, don't toggle it back off.
        if (Date.now() - justPrimedAt.current < 500) return;
        togglePlay(i);
      }, 270);
    }
  };

  // ---- lifecycle ----
  useScrollLock(open);

  useEffect(() => {
    if (!open) return;
    cid.current = getClientId();
    // Restore the sound preference. Default muted (browsers block unmuted
    // autoplay without a gesture); once the user turns sound on it sticks and
    // playIndex/toggleMute honour it on their next in-gesture play.
    try { muted.current = localStorage.getItem("cr_reels_muted") !== "0"; } catch { /* noop */ }
    fetchLibrary().then((d) => setSavedIds(new Set(d.savedIds)));
    io.current = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (en.isIntersecting && en.intersectionRatio >= 0.6) {
          const i = Number((en.target as HTMLElement).dataset.reel);
          if (i !== current.current || !players.current[i]) activate(i);
        }
      }
    }, { threshold: [0, 0.6, 1] });

    loadYT().then(() => { ytReady.current = true; activate(current.current); }).catch(() => {});
    void fetchBatch();

    // Mobile autoplay: iOS blocks a programmatic playVideo() that isn't inside a
    // user gesture, so the IntersectionObserver-driven activate() can't start a
    // cold reel. The swipe itself IS a gesture — so on touchend, if the finger
    // moved (a swipe, not a tap), we synchronously play the reel that snapped
    // nearest the viewport centre. That single in-gesture call is what unlocks
    // muted playback; the watchdog keeps it going.
    const onTouchStart = (e: TouchEvent) => {
      primePlayback(); // first-touch unlock for the opening reel
      const t = e.touches[0];
      if (t) touchStart.current = { x: t.clientX, y: t.clientY };
      touchMoved.current = false;
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      if (Math.abs(t.clientY - touchStart.current.y) > 18 || Math.abs(t.clientX - touchStart.current.x) > 18) touchMoved.current = true;
    };
    const onTouchEnd = () => {
      if (!touchMoved.current) return; // a tap — let onReelTap handle play/pause
      // Tapping a reel plays it, so a gesture-driven playVideo() works on this
      // device — only the IntersectionObserver's non-gesture call is blocked. The
      // snap hasn't settled at touchend, so we don't know which reel wins yet —
      // so play EVERY loaded player here, inside the gesture. Whichever reel snaps
      // in is already playing; activate() (fired by the IO after the snap) then
      // pauses the others. Muted, so the brief overlap is silent.
      justPrimedAt.current = Date.now(); // don't let the tap-guard toggle it back off
      for (const k of Object.keys(players.current)) {
        const p = players.current[+k];
        if (!p || typeof p.playVideo !== "function") continue;
        try { muted.current ? p.mute() : p.unMute(); p.playVideo(); } catch { /* noop */ }
      }
    };
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      io.current?.disconnect();
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      Object.keys(players.current).forEach((k) => destroyPlayer(+k));
      setItems([]); current.current = 0; firstBatch.current = true; primed.current = false; userPaused.current.clear(); setProg(0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // observe newly-appended reels
  useEffect(() => {
    itemsRef.current = items; // keep the ref the observer reads in lock-step with state
    if (!open || !io.current) return;
    for (let i = observed.current; i < items.length; i++) {
      const el = document.querySelector(`[data-reel="${i}"]`);
      if (el) io.current.observe(el);
    }
    observed.current = items.length;
    if (ytReady.current && items.length && !players.current[current.current]) activate(current.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, open]);

  useEffect(() => {
    if (!open) { observed.current = 0; return; }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const next = current.current + (e.key === "ArrowDown" ? 1 : -1);
        document.querySelector(`[data-reel="${next}"]`)?.scrollIntoView({ behavior: "smooth" });
        e.preventDefault();
      }
      if (e.key === "m") toggleMute();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const applyPref = (body: Record<string, string>) => {
    fetch("/api/feed/prefs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cid: cid.current, ...body }) }).catch(() => {});
  };

  return (
    <div className="fixed inset-0 z-[120] bg-ink-950">
      {/* floating nav */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-10 flex items-center gap-3 px-4 pt-[calc(0.9rem+env(safe-area-inset-top))]">
        <Logo href={null} sizeClass="h-7" showWordmark={false} className="pointer-events-auto" />
        <span className="pointer-events-none font-display text-sm font-semibold uppercase tracking-wide text-chalk/90">Feed</span>
        <div className="flex-1" />
        <button onClick={onClose} aria-label="Close reels" className="pointer-events-auto flex size-10 items-center justify-center rounded-full border border-white/15 bg-black/40 text-chalk backdrop-blur-md">
          <X className="size-5" />
        </button>
      </div>

      <div ref={containerRef} className="cr-reels h-dvh snap-y snap-mandatory overflow-y-scroll">
        {items.map((v, i) => {
          const pill = contentPill(v.tags || []);
          const mine = reacted[v.id];
          return (
            <section key={i} data-reel={i} className="relative h-dvh snap-start snap-always overflow-hidden bg-black">
              <div className="cr-reel-cover absolute inset-0 z-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="cr-reel-poster" src={posterUrl(v.id)} alt="" aria-hidden decoding="async" />
                <div id={`cr-pl-${i}`} />
              </div>
              <div className="absolute inset-0 z-[1]" onClick={(e) => onReelTap(e, i, v)} />
              <div className="pointer-events-none absolute inset-0 z-[2] bg-gradient-to-b from-black/40 via-transparent to-black/80" />

              {/* right rail */}
              <div className="absolute bottom-[calc(7rem+env(safe-area-inset-bottom))] right-3.5 z-[4] flex flex-col items-center gap-5">
                <RailButton label="Respect" active={mine === "respect"} respectIndex={i}
                  onClick={() => setReacted((r) => {
                    const next = { ...r };
                    if (next[v.id] === "respect") delete next[v.id];
                    else { next[v.id] = "respect"; signal(v.id); }
                    return next;
                  })}>
                  <Heart className={mine === "respect" ? "size-7 fill-blood-500 text-blood-500" : "size-7"} />
                </RailButton>
                <RailButton label="Comments" onClick={() => setDiscussFor(v)}>
                  <MessageCircle className="size-7" />
                </RailButton>
                <RailButton label="Save" active={savedIds.has(v.id)} onClick={() => setSaveFor(v)}>
                  <Bookmark className={savedIds.has(v.id) ? "size-7 fill-blood-500 text-blood-500" : "size-7"} />
                </RailButton>
                <RailButton label="Share" onClick={() => share(v)}>
                  <Share2 className="size-7" />
                </RailButton>
                <RailButton label="Sound" onClick={toggleMute}>
                  {muted.current ? <VolumeX className="size-7" /> : <Volume2 className="size-7" />}
                </RailButton>
                <RailButton label="More" onClick={() => setMoreFor(v)}>
                  <MoreVertical className="size-7" />
                </RailButton>
              </div>

              {/* info */}
              <div className="absolute bottom-[calc(1.9rem+env(safe-area-inset-bottom))] left-4 right-[5.25rem] z-[3] text-chalk">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="font-display text-[0.95rem] font-bold tracking-tight [text-shadow:0_1px_6px_rgba(0,0,0,0.7)]">{cleanTitle(v.channel)}</span>
                  {isNewToday(v.publishedAt) && (
                    <span className="rounded-full bg-blood-500 px-1.5 py-0.5 text-[0.55rem] font-bold uppercase tracking-widest text-white shadow-glow-red">New</span>
                  )}
                </div>
                <p className="mb-2 line-clamp-2 text-[0.9rem] font-medium leading-snug [text-shadow:0_1px_8px_rgba(0,0,0,0.85)]">{cleanTitle(v.title)}</p>
                <div className="flex flex-wrap items-center gap-1.5 text-[0.7rem] text-chalk/60">
                  {pill && (
                    <span className={`rounded px-1.5 py-0.5 text-[0.58rem] font-bold uppercase tracking-wider ${pill[1] ? "bg-blood-500/90 text-white" : "bg-white/10 text-chalk/90"}`}>{pill[0]}</span>
                  )}
                  <span className="rounded px-1.5 py-0.5 text-[0.58rem] font-bold uppercase tracking-wider bg-white/10 text-chalk/90">{TOPIC_LABEL[v.topic ?? ""] ?? v.topic}</span>
                  {[fmtViews(v.viewCount), timeAgo(v.publishedAt)].filter(Boolean).map((s, k) => (
                    <span key={k} className="before:mr-1.5 before:text-chalk/30 before:content-['·']">{s}</span>
                  ))}
                </div>
              </div>

              {/* paused indicator — YouTube embeds can't reliably autoplay on
                  mobile, so make tap-to-play read as intentional. */}
              <div className="cr-pause pointer-events-none absolute inset-0 z-[2] flex flex-col items-center justify-center gap-3 opacity-0 transition-opacity">
                <span className="flex size-20 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="ml-1 size-9 text-white"><polygon points="6 3 20 12 6 21 6 3" /></svg>
                </span>
                <span className="rounded-full bg-black/40 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white/90 backdrop-blur-sm">Tap to play</span>
              </div>
            </section>
          );
        })}

        {items.length === 0 && (
          <div className="cr-boot absolute inset-0 z-[6] flex h-dvh flex-col items-center justify-center gap-6 bg-ink-950">
            {/* skeleton scaffold behind the boot brand */}
            <div className="cr-shimmer pointer-events-none absolute inset-0 opacity-40" />
            <Logo href={null} sizeClass="h-12" showWordmark={false} className="relative" />
            <div className="cr-boot-bar relative" />
          </div>
        )}
      </div>

      {/* swipe-progress rail (right edge) */}
      {items.length > 0 && (
        <div className="pointer-events-none fixed right-0 top-1/2 z-[5] h-32 w-[3px] -translate-y-1/2 overflow-hidden rounded-full bg-white/10">
          <div className="cr-progress h-full w-full rounded-full bg-blood-500/90" style={{ transform: `scaleY(${Math.max(0.06, prog)})` }} />
        </div>
      )}

      {/* swipe hint (only until the user starts scrolling) */}
      {items.length > 0 && prog <= 1 / Math.max(items.length, 1) + 0.001 && (
        <div className="cr-bob pointer-events-none fixed bottom-[calc(8rem+env(safe-area-inset-bottom))] left-1/2 z-[5] -translate-x-1/2 text-center text-xs font-semibold text-chalk/80 [text-shadow:0_1px_6px_rgba(0,0,0,0.8)]">
          <div>Swipe up</div>
          <ChevronDown className="mx-auto size-5" />
        </div>
      )}

      {/* More sheet */}
      {moreFor && (
        <div className="fixed inset-0 z-[130] flex items-end justify-center bg-black/60" onClick={() => setMoreFor(null)}>
          <div className="w-full max-w-md rounded-t-2xl border border-ink-700 bg-ink-900 p-5 pb-[calc(1.75rem+env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
            <h4 className="mb-2 font-display text-base font-semibold">Tune your feed</h4>
            <button className="flex w-full items-center gap-3 border-b border-ink-800 py-3.5 text-left text-sm font-semibold text-chalk"
              onClick={() => { applyPref({ notInterestedId: moreFor.id }); setMoreFor(null); }}>
              <EyeOff className="size-5 text-mist" /> Not interested in this
            </button>
            {moreFor.channelId && (
              <button className="flex w-full items-center gap-3 border-b border-ink-800 py-3.5 text-left text-sm font-semibold text-chalk"
                onClick={() => { applyPref({ hideChannelId: moreFor.channelId! }); setMoreFor(null); }}>
                <EyeOff className="size-5 text-mist" /> Hide {cleanTitle(moreFor.channel)}
              </button>
            )}
            <button className="w-full py-3.5 text-center text-sm font-semibold text-mist" onClick={() => setMoreFor(null)}>Cancel</button>
          </div>
        </div>
      )}

      {saveFor && (
        <SaveSheet video={saveFor} onClose={() => setSaveFor(null)} onSaved={(id) => setSavedIds((s) => new Set(s).add(id))} />
      )}

      {discussFor && (
        <DiscussionSheet video={discussFor} onClose={() => setDiscussFor(null)} />
      )}
    </div>
  );
}

function RailButton({ children, label, onClick, active, respectIndex }: { children: React.ReactNode; label: string; onClick: () => void; active?: boolean; respectIndex?: number }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      data-respect={respectIndex}
      className="group flex flex-col items-center gap-1.5"
    >
      <span
        className={`flex size-11 items-center justify-center rounded-full border backdrop-blur-md shadow-[0_4px_16px_-4px_rgba(0,0,0,0.6)] transition-all duration-200 group-active:scale-90 [&>svg]:size-6 ${
          active
            ? "border-blood-500/70 bg-blood-500/20 text-blood-500"
            : "border-white/12 bg-black/30 text-white group-hover:border-white/25 group-hover:bg-black/45"
        }`}
      >
        {children}
      </span>
      <small className="text-[0.64rem] font-semibold tracking-wide text-white/95 [text-shadow:0_1px_5px_rgba(0,0,0,0.9)]">{label}</small>
    </button>
  );
}

function share(v: FeedVideo) {
  const url = `https://www.youtube.com/watch?v=${v.id}`;
  if (navigator.share) { navigator.share({ title: v.title, text: v.title, url }).catch(() => {}); return; }
  navigator.clipboard?.writeText(url).catch(() => {});
}
