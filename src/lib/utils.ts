import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Decimal odds → implied probability (0..1). */
export function impliedProbability(decimalOdds: number): number {
  if (decimalOdds <= 0) return 0;
  return 1 / decimalOdds;
}

/** Two-way book: remove the vig and return fair probabilities. */
export function devig(redOdds: number, blueOdds: number) {
  const r = impliedProbability(redOdds);
  const b = impliedProbability(blueOdds);
  const overround = r + b;
  return { red: r / overround, blue: b / overround, overround };
}

/** Positive "edge" when model prob exceeds market implied prob. */
export function bettingEdge(modelProb: number, decimalOdds: number): number {
  return modelProb * decimalOdds - 1; // expected value per unit staked
}

export function formatRecord(w: number, l: number, d: number, nc = 0): string {
  // No record data yet → "" so callers render nothing instead of a meaningless
  // "0-0-0" (many scraped fighters have no W-L imported).
  if (!w && !l && !d && !nc) return "";
  const base = `${w}-${l}-${d}`;
  return nc > 0 ? `${base} (${nc} NC)` : base;
}

export function koPercentage(koWins: number, wins: number): number {
  if (wins === 0) return 0;
  return Math.round((koWins / wins) * 100);
}

export function ageFrom(birthDate: string | Date | null | undefined): number | null {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  const now = new Date("2026-05-30");
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

const DAY = 86_400_000;
export function countdown(target: string | Date): {
  days: number; hours: number; minutes: number; isPast: boolean;
} {
  const t = new Date(target).getTime();
  const now = new Date("2026-05-30T12:00:00Z").getTime();
  const diff = t - now;
  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, isPast: true };
  return {
    days: Math.floor(diff / DAY),
    hours: Math.floor((diff % DAY) / 3_600_000),
    minutes: Math.floor((diff % 3_600_000) / 60_000),
    isPast: false,
  };
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function formatDate(d: string | Date, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", ...opts,
  });
}

/** Compact relative time, e.g. "just now", "5m", "3h", "2d", or a date. */
export function timeAgo(d: string | Date): string {
  const then = new Date(d).getTime();
  const secs = Math.max(0, (Date.now() - then) / 1000);
  if (secs < 45) return "just now";
  const mins = secs / 60;
  if (mins < 60) return `${Math.round(mins)}m ago`;
  const hours = mins / 60;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = hours / 24;
  if (days < 7) return `${Math.round(days)}d ago`;
  return formatDate(d, { year: undefined });
}

