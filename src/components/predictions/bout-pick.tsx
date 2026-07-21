"use client";

import { useState } from "react";
import { Star, Loader2, Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-client";
import { ProbabilityBar } from "@/components/probability-bar";

type Corner = "RED" | "BLUE";
interface Crowd { red: number; blue: number; total: number }
interface Pick { corner: Corner; confidence: number | null }

/**
 * The crowd pick — the core habit-loop control. One tap picks a corner; a 1–5
 * confidence star row appears; the aggregate renders as the red-vs-blue crowd
 * bar with a running count. Optimistic, backed by /api/fights/[slug]/pick.
 * Signed-out users are routed to /account. Reusable on the bout page and inline
 * on cards.
 */
// A corner priced at or below this vig-free market probability is the underdog —
// roughly +140 or longer. Below the threshold we surface an "Underdog" chip and,
// when the user picks that corner, an upset nudge (the pick is worth more if it
// lands — see reputation.ts::pickReputation).
const UNDERDOG_THRESHOLD = 0.42;

export function BoutPick({
  fightSlug,
  redName,
  blueName,
  initialCrowd,
  initialPick,
  marketRedP = null,
}: {
  fightSlug: string;
  redName: string;
  blueName: string;
  initialCrowd: Crowd;
  initialPick: Pick | null;
  /** Vig-free market win probability for the RED corner (0..1), or null when no
   *  odds are connected (niche sports) — the underdog cue simply stays hidden. */
  marketRedP?: number | null;
}) {
  const { user } = useAuth();
  const [crowd, setCrowd] = useState<Crowd>(initialCrowd);
  const [pick, setPick] = useState<Pick | null>(initialPick);
  const [busy, setBusy] = useState(false);

  async function send(corner: Corner, confidence: number | null) {
    if (!user) { window.location.href = "/account"; return; }
    if (busy) return;
    setBusy(true);

    // Optimistic crowd move.
    const prev = pick;
    setPick({ corner, confidence });
    setCrowd((c) => {
      const next = { ...c };
      if (!prev) { next.total += 1; corner === "RED" ? next.red++ : next.blue++; }
      else if (prev.corner !== corner) {
        corner === "RED" ? next.red++ : next.blue++;
        prev.corner === "RED" ? next.red-- : next.blue--;
      }
      return next;
    });

    try {
      const res = await fetch(`/api/fights/${encodeURIComponent(fightSlug)}/pick`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ corner, confidence }),
      });
      if (res.ok) {
        const d = await res.json();
        setCrowd(d.crowd);
        setPick(d.myPick);
      } else {
        setPick(prev);
        setCrowd(initialCrowd);
      }
    } catch {
      setPick(prev);
    } finally {
      setBusy(false);
    }
  }

  const redP = crowd.total ? crowd.red / crowd.total : 0.5;

  const redUnderdog = marketRedP != null && marketRedP <= UNDERDOG_THRESHOLD;
  const blueUnderdog = marketRedP != null && 1 - marketRedP <= UNDERDOG_THRESHOLD;
  const pickedUnderdog =
    (pick?.corner === "RED" && redUnderdog) || (pick?.corner === "BLUE" && blueUnderdog);

  return (
    <div className="card-surface p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-display text-sm font-bold uppercase tracking-wide text-chalk">Make your pick</span>
        {busy && <Loader2 className="size-4 animate-spin text-fog" />}
      </div>

      {/* Corner buttons */}
      <div className="grid grid-cols-2 gap-3">
        <CornerButton
          name={redName}
          picked={pick?.corner === "RED"}
          tone="red"
          underdog={redUnderdog}
          onClick={() => send("RED", pick?.corner === "RED" ? pick.confidence : null)}
        />
        <CornerButton
          name={blueName}
          picked={pick?.corner === "BLUE"}
          tone="blue"
          underdog={blueUnderdog}
          onClick={() => send("BLUE", pick?.corner === "BLUE" ? pick.confidence : null)}
        />
      </div>

      {/* Upset nudge — the pick is against the market; correct upset calls score
          higher, and saying so at pick time makes the reward legible. */}
      {pickedUnderdog && (
        <p className="mt-3 flex items-center justify-center gap-1.5 text-[0.7rem] font-semibold text-gold-400">
          <Flame className="size-3.5" /> You&apos;re calling the upset — worth more if you nail it.
        </p>
      )}

      {/* Confidence — appears once a corner is chosen */}
      {pick && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <span className="text-[0.65rem] uppercase tracking-wider text-fog">Confidence</span>
          <div className="-my-1 flex items-center">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                aria-label={`Confidence ${n} of 5`}
                aria-pressed={(pick.confidence ?? 0) >= n}
                onClick={() => send(pick.corner, n)}
                // Comfortable ~36px thumb target; the visual star stays 16px.
                className="tap p-2"
              >
                <Star className={cn("size-4 transition-colors", (pick.confidence ?? 0) >= n ? "fill-gold-400 text-gold-400" : "text-ink-600")} />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Crowd read */}
      <div className="mt-5">
        <div className="mb-1.5 flex items-center justify-between text-[0.65rem] uppercase tracking-wider text-fog">
          <span>The crowd read</span>
          <span className="tabular-nums">{crowd.total.toLocaleString()} pick{crowd.total === 1 ? "" : "s"}</span>
        </div>
        {crowd.total > 0 ? (
          <ProbabilityBar redLabel={redName} blueLabel={blueName} redProbability={redP} />
        ) : (
          <p className="rounded-lg bg-ink-800 px-3 py-2 text-center text-xs text-fog">
            No picks yet — be the first to call it.
          </p>
        )}
      </div>
    </div>
  );
}

function CornerButton({
  name,
  picked,
  tone,
  underdog = false,
  onClick,
}: {
  name: string;
  picked: boolean;
  tone: "red" | "blue";
  underdog?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={picked}
      className={cn(
        "relative flex flex-col items-center gap-1 rounded-xl border px-3 py-3 text-center transition-all active:scale-95",
        picked
          ? tone === "red"
            ? "border-blood-500 bg-blood-500/15 text-chalk shadow-glow-red"
            : "border-volt-500 bg-volt-500/15 text-chalk"
          : "border-ink-700 text-mist hover:border-ink-600 hover:bg-ink-800",
      )}
    >
      {underdog && (
        <span className="absolute right-1.5 top-1.5 rounded bg-gold-400/15 px-1.5 py-0.5 text-[0.55rem] font-bold uppercase tracking-wide text-gold-400">
          Underdog
        </span>
      )}
      <span className={cn("text-[0.6rem] font-bold uppercase tracking-wider", tone === "red" ? "text-blood-400" : "text-volt-400")}>
        {tone === "red" ? "Red corner" : "Blue corner"}
      </span>
      <span className="font-display text-sm font-bold leading-tight">{name}</span>
      <span className="text-[0.65rem] text-fog">{picked ? "Your pick ✓" : "Tap to pick"}</span>
    </button>
  );
}
