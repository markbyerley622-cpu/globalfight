"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  FIGHT NIGHT — the one screen used standing up, in the dark, on a phone.
//
//  ── Design constraints that are NOT preference ────────────────────────────
//  The promoter is cageside. They are holding a phone in one hand, the bout
//  just ended, and the crowd is loud. Every control here is sized for that:
//
//  • The two corner buttons are the biggest tappable things in the product.
//    Recording the wrong winner is the single most damaging mistake available
//    — it settles every prediction on that bout the wrong way — so the target
//    is enormous and the two options are visually opposite, not a dropdown.
//  • Method, round and time are OPTIONAL and come after. A winner with no
//    method is a usable result; a form that demands all four before saving
//    anything is how a card ends up with no results entered at all.
//  • One bout at a time. A list of twelve editable bouts on a phone at night is
//    a mis-tap waiting to happen, and the promoter always knows which bout just
//    finished.
//
//  ── Why it is optimistic ──────────────────────────────────────────────────
//  Arena wifi is bad. The result is on screen the instant it is tapped and
//  reconciles behind them; a spinner between "the fight ended" and "the app
//  believes me" is the difference between using this and giving up on it.
// ════════════════════════════════════════════════════════════════════════════

export interface NightBout {
  id: string;
  order: number;
  redName: string;
  blueName: string;
  mainEvent: boolean;
  /** Already recorded — RED / BLUE / DRAW / NO_CONTEST, or null. */
  recorded: string | null;
}

const METHODS = [
  { value: "KO", label: "KO" },
  { value: "TKO", label: "TKO" },
  { value: "SUB", label: "Sub" },
  { value: "UD", label: "Unanimous" },
  { value: "SD", label: "Split" },
  { value: "MD", label: "Majority" },
  { value: "RTD", label: "Retired" },
  { value: "DQ", label: "DQ" },
] as const;

export function FightNight({ eventId, bouts: initial }: { eventId: string; bouts: NightBout[] }) {
  const router = useRouter();
  const [bouts, setBouts] = useState(initial);
  const [active, setActive] = useState<string | null>(
    // Open on the first bout WITHOUT a result — the one they are about to
    // record. Opening on bout 1 every time means scrolling past finished work.
    initial.find((b) => !b.recorded)?.id ?? null,
  );
  const [method, setMethod] = useState<string | null>(null);
  const [round, setRound] = useState<number | null>(null);
  const [time, setTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bout = bouts.find((b) => b.id === active) ?? null;

  async function save(winner: "RED" | "BLUE" | "DRAW" | "NO_CONTEST") {
    if (!bout || saving) return;
    const previous = bouts;

    // Optimistic — see the header.
    setBouts((bs) => bs.map((b) => (b.id === bout.id ? { ...b, recorded: winner } : b)));
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/promoter/events/${eventId}/results`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fightId: bout.id, winner, method, round, time }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.error === "string" ? data.error : "Couldn't save that result.");
      }

      // Straight on to the next unrecorded bout. The promoter's next action is
      // always "the next fight", and making them find it is the friction that
      // stops this being used for a whole card.
      const next = bouts.find((b) => !b.recorded && b.id !== bout.id);
      setActive(next?.id ?? null);
      setMethod(null);
      setRound(null);
      setTime("");
      // Refresh the public event, leaderboard and predictions behind them.
      router.refresh();
    } catch (e) {
      setBouts(previous);
      setError(e instanceof Error ? e.message : "Couldn't save that result.");
    } finally {
      setSaving(false);
    }
  }

  const done = bouts.filter((b) => b.recorded).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-blood-500/40 bg-blood-500/10 px-3.5 py-2.5">
        <span className="flex items-center gap-2 font-display text-sm font-black uppercase tracking-wider text-blood-200">
          <span className="live-dot" aria-hidden /> Fight night
        </span>
        <span className="text-xs font-semibold tabular-nums text-mist">
          {done} of {bouts.length} recorded
        </span>
      </div>

      {error && (
        <p role="alert" className="flex items-center gap-2 rounded-lg border border-blood-500/40 bg-blood-500/10 px-3 py-2 text-xs text-blood-200">
          <AlertCircle className="size-4 shrink-0" aria-hidden /> {error}
        </p>
      )}

      {bout ? (
        <div className="rounded-2xl border border-ink-800 bg-ink-900/60 p-4">
          <p className="mb-3 text-center font-display text-3xs font-bold uppercase tracking-[0.18em] text-fog">
            {bout.mainEvent ? "Main event" : `Bout ${bout.order + 1}`} · Who won?
          </p>

          {/* THE decision. Two targets, as large as the screen allows. */}
          <div className="grid grid-cols-2 gap-2.5">
            <CornerButton
              name={bout.redName}
              corner="red"
              disabled={saving}
              onClick={() => void save("RED")}
            />
            <CornerButton
              name={bout.blueName}
              corner="blue"
              disabled={saving}
              onClick={() => void save("BLUE")}
            />
          </div>

          {/* Optional detail. AFTER the winner, and never blocking it. */}
          <div className="mt-4 space-y-2.5 border-t border-ink-800 pt-3.5">
            <p className="font-display text-3xs font-bold uppercase tracking-wider text-fog">
              How it ended — optional
            </p>
            <div className="flex flex-wrap gap-1.5">
              {METHODS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMethod(method === m.value ? null : m.value)}
                  aria-pressed={method === m.value}
                  className={cn(
                    "tap min-h-10 rounded-full border px-3.5 text-xs font-bold transition-colors",
                    method === m.value
                      ? "border-blood-500 bg-blood-500 text-white"
                      : "border-ink-700 bg-ink-950/50 text-mist hover:border-blood-500/50",
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-3xs font-bold uppercase tracking-wider text-fog">Round</span>
              {[1, 2, 3, 4, 5].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRound(round === r ? null : r)}
                  aria-pressed={round === r}
                  className={cn(
                    "tap size-10 rounded-lg border font-display text-sm font-black tabular-nums transition-colors",
                    round === r
                      ? "border-blood-500 bg-blood-500 text-white"
                      : "border-ink-700 bg-ink-950/50 text-mist hover:border-blood-500/50",
                  )}
                >
                  {r}
                </button>
              ))}
              <input
                value={time}
                onChange={(e) => setTime(e.target.value)}
                placeholder="2:47"
                inputMode="numeric"
                aria-label="Time in the round"
                className="min-h-10 w-20 rounded-lg border border-ink-700 bg-ink-950/50 px-2.5 text-center text-sm tabular-nums text-chalk outline-none focus:border-blood-500/60"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                disabled={saving}
                onClick={() => void save("DRAW")}
                className="tap min-h-10 flex-1 rounded-lg border border-ink-700 text-xs font-bold uppercase tracking-wider text-fog transition-colors hover:text-mist"
              >
                Draw
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void save("NO_CONTEST")}
                className="tap min-h-10 flex-1 rounded-lg border border-ink-700 text-xs font-bold uppercase tracking-wider text-fog transition-colors hover:text-mist"
              >
                No contest
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-volt-500/30 bg-volt-500/[0.07] p-6 text-center">
          <Check className="mx-auto size-8 text-volt-300" aria-hidden />
          <p className="mt-2 font-display text-base font-black uppercase tracking-wide text-chalk">
            Every bout recorded
          </p>
          <p className="mt-1 text-xs text-fog">
            Results are live on the event page, and every prediction has settled.
          </p>
        </div>
      )}

      {/* The card, as a running order. Tap any bout to record or correct it. */}
      <ul className="space-y-1.5">
        {bouts.map((b) => (
          <li key={b.id}>
            <button
              type="button"
              onClick={() => setActive(b.id)}
              className={cn(
                "tap flex min-h-12 w-full items-center gap-2.5 rounded-lg border px-3 text-left transition-colors",
                b.id === active
                  ? "border-blood-500/50 bg-blood-500/10"
                  : "border-ink-800 bg-ink-900/40 hover:border-ink-700",
              )}
            >
              <span className={cn(
                "grid size-6 shrink-0 place-items-center rounded-full text-3xs font-black",
                b.recorded ? "bg-volt-500/20 text-volt-300" : "bg-ink-800 text-fog",
              )}>
                {b.recorded ? <Check className="size-3.5" aria-hidden /> : b.order + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-chalk">
                {b.redName} <span className="text-fog">vs</span> {b.blueName}
              </span>
              {b.recorded && (
                <span className="shrink-0 text-3xs font-bold uppercase tracking-wider text-volt-300">
                  {b.recorded === "RED" ? b.redName.split(" ")[0]
                    : b.recorded === "BLUE" ? b.blueName.split(" ")[0]
                    : b.recorded === "DRAW" ? "Draw" : "NC"}
                </span>
              )}
              {saving && b.id === active && <Loader2 className="size-3.5 shrink-0 animate-spin text-fog" aria-hidden />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CornerButton({
  name, corner, disabled, onClick,
}: { name: string; corner: "red" | "blue"; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        // min-h-24: deliberately enormous. This is the highest-consequence tap
        // in the product, made one-handed, at night, in a loud room.
        "tap flex min-h-24 flex-col items-center justify-center gap-1 rounded-xl border-2 px-3 py-4 transition-all active:scale-[0.98] disabled:opacity-60",
        corner === "red"
          ? "border-blood-500/60 bg-blood-500/15 hover:border-blood-500 hover:bg-blood-500/25"
          : "border-sky-500/60 bg-sky-500/15 hover:border-sky-400 hover:bg-sky-500/25",
      )}
    >
      <span className={cn(
        "font-display text-3xs font-black uppercase tracking-[0.18em]",
        corner === "red" ? "text-blood-300" : "text-sky-300",
      )}>
        {corner} corner
      </span>
      <span className="text-balance text-center font-display text-base font-black leading-tight text-chalk">
        {name}
      </span>
    </button>
  );
}
