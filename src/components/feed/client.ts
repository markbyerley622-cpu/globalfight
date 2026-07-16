// Client-side helpers shared by the feed grid and reels overlay.
import type { FeedVideo } from "@/lib/feed/types";

export type { FeedVideo };

export function getClientId(): string {
  if (typeof window === "undefined") return "anon";
  let c = localStorage.getItem("cr_feed_cid");
  if (!c) {
    c = "c_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    localStorage.setItem("cr_feed_cid", c);
  }
  return c;
}

// YouTube poster used as an instant first frame under each reel (crisp thumbnail
// shown until the iframe reaches PLAYING). hqdefault is the universally-present size.
export function posterUrl(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

// Warm the browser cache for upcoming reel posters so scrolling reveals them instantly.
export function preloadPosters(videos: FeedVideo[], limit = 6): void {
  if (typeof window === "undefined") return;
  for (const v of videos.slice(0, limit)) {
    const img = new Image();
    img.decoding = "async";
    img.src = posterUrl(v.id);
  }
}

// A clip is "new today" when it published within the last ~30h (covers late-night uploads).
export function isNewToday(iso?: string): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return false;
  return Date.now() - t < 30 * 3600 * 1000;
}

// Opener rotation (client memory): remember the last few videos we opened the reels
// on, so a fresh session leads with a *different* strong clip instead of the same one.
const OPENERS_KEY = "cr_feed_openers";
export function getRecentOpeners(): string[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(OPENERS_KEY) || "[]") as string[]; }
  catch { return []; }
}
export function pushOpener(id: string, keep = 6): void {
  if (typeof window === "undefined" || !id) return;
  try {
    const next = [id, ...getRecentOpeners().filter((x) => x !== id)].slice(0, keep);
    localStorage.setItem(OPENERS_KEY, JSON.stringify(next));
  } catch { /* storage full/blocked — non-fatal */ }
}

export function fmtViews(n?: number): string {
  if (n == null || isNaN(n)) return "";
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M views";
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "K views";
  return n + " views";
}

export function timeAgo(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

// Strip creator emoji/pictographs from titles for a clean, premium look.
export function cleanTitle(s = ""): string {
  // Pictographs and skin-tone modifiers, then the joiners (ZWJ + variation selector)
  // separately. Putting a combining joiner inside the same character class as a range
  // is ambiguous — it can silently match the wrong thing.
  return String(s)
    .replace(/[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}]/gu, "")
    .replace(/‍/g, "")   // zero-width joiner
    .replace(/️/g, "")   // variation selector-16
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function fmtDuration(v: FeedVideo): string {
  let s: number | null = typeof v.durationSeconds === "number" ? v.durationSeconds : null;
  if (s == null && v.duration) {
    const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(v.duration);
    if (m) s = +(m[1] || 0) * 3600 + +(m[2] || 0) * 60 + +(m[3] || 0);
  }
  if (s == null) return "";
  const h = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(mm)}:${pad(sec)}` : `${mm}:${pad(sec)}`;
}

export const INTENT_WORDS =
  /\b(only|just|no|not|without|hide|striking|grappling|ground|knockout|kos?|finish|submission|subs?|tapout|instructional|technique|tutorial|highlight|full fight|training|sparring|promo|preview|interview|podcast|drama|boxing|mma|ufc|bjj|jiu|muay thai|kickboxing|wrestling|one championship)\b/i;

export const SMART_CHIPS = [
  { intent: "striking", label: "Striking" },
  { intent: "grappling", label: "Grappling" },
  { intent: "knockouts", label: "Knockouts" },
  { intent: "submissions", label: "Submissions" },
  { intent: "full fights", label: "Full Fights" },
  { intent: "technique", label: "Technique" },
];

// ---- Minimal YouTube IFrame API typings ----
export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  getPlayerState(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  destroy(): void;
}
export interface YTNamespace {
  Player: new (el: HTMLElement | string, opts: unknown) => YTPlayer;
  PlayerState: { PLAYING: number; PAUSED: number; ENDED: number; BUFFERING: number; CUED: number };
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytPromise: Promise<YTNamespace> | null = null;
export function loadYT(): Promise<YTNamespace> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (ytPromise) return ytPromise;
  ytPromise = new Promise<YTNamespace>((resolve) => {
    window.onYouTubeIframeAPIReady = () => resolve(window.YT!);
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  });
  return ytPromise;
}
