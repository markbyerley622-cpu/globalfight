"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { CommunityMarketView, MarketVote } from "@/features/predictions/community/types";
import type { PredictionMarket } from "@/features/predictions/types";

/**
 * "Fight Pulse vs The Market" — how far the Combat Register community's read of a
 * fight diverges from the live market. Positive delta = fans back the reference
 * side MORE than the market does. Returns null until the fight has community
 * votes and a comparable two-way market. This divergence is the signature,
 * shareable number nobody else has (fans + market on one fight).
 */
export function marketDivergence(
  market: PredictionMarket,
  vote?: MarketVote,
): { delta: number; commPct: number; marketPct: number; label: string } | null {
  if (!vote || vote.voteCount === 0 || market.outcomes.length !== 2) return null;
  const total = Object.values(vote.tally).reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const share = (id: string) => Math.round(((vote.tally[id] ?? 0) / total) * 100);

  const labels = market.outcomes.map((o) => o.label);
  const isYesNo = labels.every((l) => /^(yes|no)$/i.test(l.trim()));

  if (isYesNo) {
    const yes = market.outcomes.find((o) => /^yes$/i.test(o.label.trim()));
    if (!yes) return null;
    const marketPct = Math.round(yes.probability * 100);
    const commPct = share("yes");
    return { delta: commPct - marketPct, commPct, marketPct, label: "Yes" };
  }
  // Head-to-head: reference = the market favourite (community ids match outcomes).
  const fav = [...market.outcomes].sort((a, b) => b.probability - a.probability)[0];
  const marketPct = Math.round(fav.probability * 100);
  return { delta: share(fav.id) - marketPct, commPct: share(fav.id), marketPct, label: fav.label };
}

/** Native share sheet with a clipboard fallback. Returns "shared" | "copied". */
export async function sharePrediction(title: string, text: string, url: string): Promise<"shared" | "copied"> {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  if (nav && "share" in nav) {
    try {
      await (nav as Navigator).share({ title, text, url });
      return "shared";
    } catch {
      /* user cancelled or unsupported → fall through to copy */
    }
  }
  try {
    await nav?.clipboard?.writeText(`${text} ${url}`.trim());
  } catch {
    /* ignore */
  }
  return "copied";
}

// Shared vote POST used by every community card.
export async function postVote(
  marketId: string,
  choice: string,
): Promise<{ ok: true; market: CommunityMarketView } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/predictions/community/vote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ marketId, choice }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error ?? "Could not record your vote." };
    return { ok: true, market: data.market as CommunityMarketView };
  } catch {
    return { ok: false, error: "Could not record your vote." };
  }
}

/** Vote shares (0..100) per option id; even split when there are no votes yet. */
export function voteShares(m: CommunityMarketView): Record<string, number> {
  const total = Object.values(m.tally).reduce((a, b) => a + b, 0);
  const out: Record<string, number> = {};
  for (const o of m.options) {
    out[o.id] = total === 0 ? Math.round(100 / m.options.length) : Math.round(((m.tally[o.id] ?? 0) / total) * 100);
  }
  return out;
}

// ── Formatting helpers ─────────────────────────────────────────────────────
export const fmtUsd = (n: number): string => {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
};
export const fmtNum = (n: number): string => n.toLocaleString("en-US");
export const pct = (p: number) => Math.round(p * 100);
export const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase();

/** Human close-time, e.g. "3d left", "5h left", "Closing soon", or null. */
function timeLeft(iso: string | null): { text: string; urgent: boolean } | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return null;
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (d >= 1) return { text: `${d}d left`, urgent: false };
  if (h >= 1) return { text: `${h}h ${m}m left`, urgent: h < 12 };
  return { text: `${m}m left`, urgent: true };
}

// ── Close timer (live, ticks each minute) ──────────────────────────────────
export function CloseTimer({ closesAt, className }: { closesAt: string | null; className?: string }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  const t = timeLeft(closesAt);
  if (!t) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide",
        t.urgent ? "bg-blood-500/15 text-blood-300" : "bg-ink-800/80 text-mist",
        className,
      )}
    >
      {t.urgent && <span className="live-dot !size-1.5" />}
      {t.text}
    </span>
  );
}

// ── Chips / badges ─────────────────────────────────────────────────────────
export function Chip({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "gold" | "hot" | "outline" | "live";
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "bg-ink-800 text-mist",
    gold: "bg-gold-500/15 text-gold-300",
    hot: "bg-blood-500/15 text-blood-300 hot-sheen",
    outline: "border border-ink-600 text-fog",
    live: "bg-volt-500/15 text-volt-400",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[0.58rem] font-bold uppercase tracking-wide",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

// ── Gradient fighter portrait (no photo needed) ────────────────────────────
export function Portrait({
  name,
  tone,
  size = "md",
  leading,
}: {
  name: string;
  tone: "red" | "blue";
  size?: "md" | "lg";
  /** true = the favourite/leading side (subtle ring). */
  leading?: boolean;
}) {
  const dim = size === "lg" ? "size-16 text-lg sm:size-20 sm:text-xl" : "size-12 text-sm";
  return (
    <div
      className={cn(
        "grid shrink-0 place-items-center rounded-full border font-display font-bold text-white",
        dim,
        tone === "red"
          ? "border-blood-500/50 bg-gradient-to-br from-blood-500 to-blood-700"
          : "border-volt-500/50 bg-gradient-to-br from-volt-500 to-[#16407a]",
        leading && "ring-2 ring-offset-2 ring-offset-ink-900",
        leading && (tone === "red" ? "ring-blood-400/70" : "ring-volt-400/70"),
      )}
    >
      {initials(name)}
    </div>
  );
}

// ── Animated dual consensus / probability bar (the hero) ───────────────────
export function ConsensusBar({
  leftLabel,
  leftPct,
  rightLabel,
  rightPct,
  size = "md",
}: {
  leftLabel: string;
  leftPct: number;
  rightLabel: string;
  rightPct: number;
  size?: "sm" | "md" | "lg";
}) {
  // Animate the fill in from a neutral 50% on mount.
  const [w, setW] = useState(50);
  useEffect(() => {
    const id = requestAnimationFrame(() => setW(leftPct));
    return () => cancelAnimationFrame(id);
  }, [leftPct]);

  const big = size === "lg";
  return (
    <div>
      <div className="mb-1.5 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className={cn("font-display font-bold leading-none text-up", big ? "text-2xl" : "text-lg")}>
            {leftPct}%
          </div>
          <div className="mt-0.5 truncate text-[0.72rem] font-semibold text-chalk">{leftLabel}</div>
        </div>
        <div className="min-w-0 text-right">
          <div className={cn("font-display font-bold leading-none text-mist", big ? "text-2xl" : "text-lg")}>
            {rightPct}%
          </div>
          <div className="mt-0.5 truncate text-[0.72rem] font-semibold text-mist">{rightLabel}</div>
        </div>
      </div>
      <div className={cn("flex overflow-hidden rounded-full bg-ink-700", big ? "h-3" : size === "sm" ? "h-1.5" : "h-2.5")}>
        <div
          className="prob-fill h-full rounded-l-full bg-gradient-to-r from-up/80 to-up"
          style={{ width: `${w}%` }}
        />
        <div className="h-full flex-1 rounded-r-full bg-gradient-to-r from-blood-600 to-blood-500/70" />
      </div>
    </div>
  );
}
