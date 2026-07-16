// ════════════════════════════════════════════════════════════════════════
//  BKFC provider — pure normalization helpers.
//
//  No I/O, no cheerio, no Prisma. Every function here is deterministic and
//  unit-tested (see __tests__/normalize.test.ts). Kept separate so the parsers
//  stay thin and the tricky string-wrangling lives in one place.
// ════════════════════════════════════════════════════════════════════════

import type { BkfcRecord, Corner, CardResult } from "./types";

/** Trim + collapse internal whitespace; return null for empty. */
export function clean(input: string | null | undefined): string | null {
  if (input == null) return null;
  const s = input.replace(/\s+/g, " ").trim();
  return s.length ? s : null;
}

/** Last path segment of a BKFC URL, lower-cased. `/fighters/aaron-chalmers` → "aaron-chalmers". */
export function slugFromUrl(url: string): string | null {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "");
    const seg = path.split("/").filter(Boolean).pop();
    return seg ? decodeURIComponent(seg).toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * BKFC dates come as human strings: "Feb 15, 2020", "May 30, 2026",
 * "September 27, 2025". Parse to an ISO date (UTC midnight) or null.
 * Deliberately strict: we never guess a year or fabricate a date.
 */
export function parseHumanDate(input: string | null | undefined): string | null {
  const s = clean(input);
  if (!s) return null;
  // Reject strings with no 4-digit year — a date without a year is not a date.
  if (!/\b\d{4}\b/.test(s)) return null;
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  // A bare "Feb 15, 2020" is parsed in the host timezone, so read the LOCAL
  // calendar fields (not UTC — that would shift the day in a +/- TZ) and pin
  // them to UTC midnight so the value is stable and TZ-independent thereafter.
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString();
}

/**
 * Parse a W-L-D record from loose fragments. Accepts "2-1-0", "2 – 1 – 0",
 * or an array of the visible number cells ["2","1","0"].
 */
export function parseRecord(parts: string[]): BkfcRecord | null {
  const nums = parts
    .map((p) => p.replace(/[^\d]/g, ""))
    .filter((p) => p.length > 0)
    .map((p) => Number.parseInt(p, 10))
    .filter((n) => Number.isFinite(n));
  if (nums.length < 2) return null; // need at least W and L
  return {
    wins: nums[0] ?? 0,
    losses: nums[1] ?? 0,
    draws: nums[2] ?? 0,
    noContests: nums[3] ?? 0,
  };
}

/** Parse "BKFC 10 …" / "BKFC KnuckleMania 4" → 10 / 4, or null. */
export function parseEventNumber(name: string): number | null {
  const m = name.match(/\bBKFC\b[^\d]*?(\d{1,4})\b/i);
  if (m) return Number.parseInt(m[1], 10);
  return null;
}

/** "75in / 190cm" or "1.8288" (metres) → centimetres, or null. */
export function parseLengthCm(input: string | null | undefined): number | null {
  const s = clean(input);
  if (!s) return null;
  const cm = s.match(/([\d.]+)\s*cm/i);
  if (cm) return Math.round(Number.parseFloat(cm[1]));
  const inches = s.match(/([\d.]+)\s*in/i);
  if (inches) return Math.round(Number.parseFloat(inches[1]) * 2.54);
  // Bare metres value (BKFC height widget stores e.g. "1.8288").
  const metres = Number.parseFloat(s);
  if (Number.isFinite(metres) && metres > 0.5 && metres < 2.6) return Math.round(metres * 100);
  return null;
}

/** Map a loose stance string to the Stance enum, or null. */
export function parseStance(input: string | null | undefined): "ORTHODOX" | "SOUTHPAW" | "SWITCH" | null {
  const s = clean(input)?.toLowerCase();
  if (!s) return null;
  if (s.includes("southpaw")) return "SOUTHPAW";
  if (s.includes("switch")) return "SWITCH";
  if (s.includes("orthodox")) return "ORTHODOX";
  return null;
}

/**
 * Derive event status from a parsed date and any status label on the page.
 * A completed card (past date) is COMPLETED; a future date SCHEDULED; today
 * within a window is LIVE. Explicit labels (cancelled/postponed) win.
 */
export function deriveEventStatus(
  isoDate: string | null,
  label: string | null,
  now: Date,
): "ANNOUNCED" | "SCHEDULED" | "LIVE" | "COMPLETED" | "CANCELLED" | "POSTPONED" {
  const l = clean(label)?.toLowerCase() ?? "";
  if (l.includes("cancel")) return "CANCELLED";
  if (l.includes("postpon")) return "POSTPONED";
  if (l.includes("live")) return "LIVE";
  if (!isoDate) return "ANNOUNCED";
  const eventMs = Date.parse(isoDate);
  if (!Number.isFinite(eventMs)) return "ANNOUNCED";
  const dayMs = 86_400_000;
  const diff = eventMs - now.getTime();
  if (diff <= -dayMs) return "COMPLETED";
  if (diff <= dayMs && diff > -dayMs) return "LIVE"; // within the event day
  return "SCHEDULED";
}

/** Winner corner from the two per-corner result tokens, or null. */
export function deriveWinnerCorner(
  redResult: CardResult | null,
  blueResult: CardResult | null,
): Corner | null {
  if (redResult === "win") return "red";
  if (blueResult === "win") return "blue";
  return null;
}

/**
 * Best-effort map of a free-text finish description to a FightMethod token.
 * Returns null (not a guess) when nothing matches — the ingest layer stores
 * null rather than a fabricated method.
 */
export function parseMethod(input: string | null | undefined): string | null {
  const s = clean(input)?.toLowerCase();
  if (!s) return null;
  if (/\btko\b|technical knockout/.test(s)) return "TKO";
  if (/\bko\b|knockout/.test(s)) return "KO";
  if (/unanimous/.test(s)) return "UD";
  if (/split/.test(s)) return "SD";
  if (/majority/.test(s)) return "MD";
  if (/submission|\bsub\b|tap/.test(s)) return "SUB";
  if (/disqualif|\bdq\b/.test(s)) return "DQ";
  if (/retire|\brtd\b|corner stoppage|doctor/.test(s)) return "RTD";
  if (/technical decision/.test(s)) return "TD";
  if (/no contest|\bnc\b/.test(s)) return "NC";
  if (/\bdraw\b/.test(s)) return "DRAW";
  if (/decision/.test(s)) return "UD"; // bare "decision" → unanimous by convention
  return null;
}

/** Extract a YouTube video id from any embed/watch/short URL, or null. */
export function extractYouTubeId(url: string | null | undefined): string | null {
  const s = clean(url);
  if (!s) return null;
  const m = s.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/,
  );
  return m ? m[1] : null;
}

/** Classify a social URL to a platform, or null if it is not a known one. */
export function socialPlatform(
  url: string | null | undefined,
): "instagram" | "twitter" | "facebook" | "youtube" | "tiktok" | "web" | null {
  const s = clean(url)?.toLowerCase();
  if (!s) return null;
  if (s.includes("instagram.com")) return "instagram";
  if (s.includes("twitter.com") || s.includes("x.com")) return "twitter";
  if (s.includes("facebook.com")) return "facebook";
  if (s.includes("youtube.com") || s.includes("youtu.be")) return "youtube";
  if (s.includes("tiktok.com")) return "tiktok";
  return null;
}

/** Split a "City, Country" or "Venue, City, State" location string. */
export function splitLocation(input: string | null | undefined): {
  city: string | null;
  country: string | null;
} {
  const s = clean(input);
  if (!s) return { city: null, country: null };
  const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { city: null, country: null };
  if (parts.length === 1) return { city: parts[0], country: null };
  return { city: parts[parts.length - 2], country: parts[parts.length - 1] };
}
