"use client";

import { useMemo, useState } from "react";
import { Check, Lock, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Corner } from "@/lib/domain/types";

export interface BoutPredictionData {
  fightId: string;
  redName: string;
  blueName: string;
  redPct: number;
  bluePct: number;
  totalVotes: number;
  locked: boolean;
  /** Winning corner once settled; null while unresolved or a draw. */
  winnerCorner: Corner | null;
  weightClass: string;
  titleFight: boolean;
}

/**
 * Single-bout prediction control. One pick per bout; the choice can be changed
 * until the market locks at bout start, is visually marked, and — once the bout
 * is settled — is revealed as correct or incorrect.
 *
 * Persistence is a placeholder: the pick is optimistic local state. A real
 * implementation swaps `onPick` for `predictionService.castVote`.
 */
export function BoutPredictionCard({
  data,
  authenticated = true,
}: {
  data: BoutPredictionData;
  authenticated?: boolean;
}) {
  const [pick, setPick] = useState<Corner | null>(null);
  const [gate, setGate] = useState(false);

  // Optimistically nudge the split when the user picks (skeleton illustration).
  const { redPct, bluePct } = useMemo(() => {
    if (!pick) return { redPct: data.redPct, bluePct: data.bluePct };
    const bump = 1;
    const r = pick === "red" ? Math.min(100, data.redPct + bump) : Math.max(0, data.redPct - bump);
    return { redPct: r, bluePct: 100 - r };
  }, [pick, data.redPct, data.bluePct]);

  function choose(corner: Corner) {
    if (data.locked) return;
    if (!authenticated) {
      setGate(true);
      return;
    }
    setPick((prev) => (prev === corner ? null : corner));
    // TODO: predictionService.castVote(data.fightId, corner, userId)
  }

  const settled = data.winnerCorner !== null || data.locked;
  const outcome = (corner: Corner): "correct" | "wrong" | null => {
    if (!pick || data.winnerCorner === null) return null;
    if (pick !== corner) return null;
    return pick === data.winnerCorner ? "correct" : "wrong";
  };

  return (
    <div className="rounded-xl border border-border bg-surface p-3.5">
      <div className="mb-2 flex items-center justify-between text-[11px] text-faint">
        <span>{data.titleFight ? "Title · " : ""}{data.weightClass}</span>
        <span className="inline-flex items-center gap-1">
          {data.locked ? (
            <>
              <Lock className="h-3 w-3" /> {data.winnerCorner ? "Settled" : "Locked"}
            </>
          ) : (
            "Open"
          )}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <PickButton
          label={data.redName}
          pct={redPct}
          side="red"
          selected={pick === "red"}
          disabled={data.locked}
          winner={data.winnerCorner === "red"}
          outcome={outcome("red")}
          onClick={() => choose("red")}
        />
        <PickButton
          label={data.blueName}
          pct={bluePct}
          side="blue"
          selected={pick === "blue"}
          disabled={data.locked}
          winner={data.winnerCorner === "blue"}
          outcome={outcome("blue")}
          onClick={() => choose("blue")}
        />
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px] text-faint">
        <span className="tabular-nums">{data.totalVotes.toLocaleString()} picks</span>
        {pick && !settled ? (
          <span className="text-brand">Your pick saved · tap again to change</span>
        ) : data.locked && !data.winnerCorner ? (
          <span>Predictions closed at bout start</span>
        ) : null}
      </div>

      {gate ? (
        <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-[11px] text-muted">
          Sign in to make a prediction. <button className="font-medium text-brand" onClick={() => setGate(false)}>Dismiss</button>
        </p>
      ) : null}
    </div>
  );
}

function PickButton({
  label,
  pct,
  side,
  selected,
  disabled,
  winner,
  outcome,
  onClick,
}: {
  label: string;
  pct: number;
  side: "red" | "blue";
  selected: boolean;
  disabled: boolean;
  winner: boolean;
  outcome: "correct" | "wrong" | null;
  onClick: () => void;
}) {
  const accent = side === "red" ? "var(--color-red-corner)" : "var(--color-blue-corner)";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "relative overflow-hidden rounded-lg border p-2.5 text-left transition-colors",
        selected ? "border-brand" : "border-border",
        winner && "ring-1 ring-success",
        disabled && !selected && "opacity-80",
        !disabled && "hover:border-brand/50",
      )}
    >
      <div
        className="absolute inset-y-0 left-0 opacity-15"
        style={{ width: `${pct}%`, backgroundColor: accent }}
        aria-hidden
      />
      <div className="relative flex items-center justify-between gap-1">
        <span className="truncate text-sm font-medium">{label}</span>
        {selected ? <Check className="h-4 w-4 shrink-0 text-brand" /> : null}
      </div>
      <div className="relative mt-1 flex items-center gap-1.5">
        <span className="text-lg font-bold tabular-nums" style={{ color: accent }}>
          {pct}%
        </span>
        {outcome === "correct" ? (
          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-success">
            <Check className="h-3 w-3" /> Correct
          </span>
        ) : outcome === "wrong" ? (
          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-brand">
            <X className="h-3 w-3" /> Missed
          </span>
        ) : null}
      </div>
    </button>
  );
}
