"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Flame, Users, Swords, Lock, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthGate } from "@/lib/auth-client";
import { useT } from "@/lib/i18n";
import { ProbabilityBar } from "@/components/probability-bar";

type Corner = "RED" | "BLUE";

/**
 * The confirmation wears the colour of the corner you called.
 *
 * It used to be green for both, and flashed `shadow-glow-red` whichever side
 * you took — so calling the blue corner lit up red, which is the one colour on
 * this screen that means the OTHER fighter. Green was worse than neutral: it is
 * the "correct answer" colour, and a pick is not correct yet.
 *
 * Corner colour is already the language of the whole card (Portrait, the
 * probability bar, the corner pills all use blood/volt), so the confirmation
 * reinforcing "you are on THIS side" costs nothing and reads instantly.
 */
const CORNER_THEME: Record<Corner, {
  text: string; border: string; bg: string; glow: string; ring: string; word: string;
}> = {
  RED: {
    text: "text-blood-300",
    border: "border-blood-500/60",
    bg: "bg-blood-500/10",
    glow: "shadow-glow-red",
    ring: "ring-blood-500/40",
    word: "RED",
  },
  BLUE: {
    text: "text-volt-400",
    border: "border-volt-500/60",
    bg: "bg-volt-500/10",
    glow: "shadow-glow-volt",
    ring: "ring-volt-500/40",
    word: "BLUE",
  },
};
type Method = "KO" | "SUB" | "UD";
interface Crowd { red: number; blue: number; total: number }
/**
 * `confidence` is carried but NEVER SET by this control any more.
 *
 * The 1–5 star selector is gone: it asked for a second decision immediately
 * after the first, in the moment the reader had just committed and wanted the
 * payoff, and it was the reason a "locked" pick still read as an unfinished
 * form. The COLUMN stays — historical picks have real values, and the victory
 * card, /predictions/mine, the event room and the battle tiebreak all render
 * theirs behind a null guard, so old calls keep their stars and new ones simply
 * do not have any. Nothing was migrated and nothing needs to be.
 */
interface Pick { corner: Corner; confidence: number | null; method: Method | null }

// The plan's Phase-1 pick: winner + method. Three plain choices map to
// FightMethod enum values (UD stands in for any decision). Offered on the
// dedicated bout page only — see the `variant` doc.
const METHODS: { value: Method; label: string; short: string }[] = [
  { value: "KO", label: "KO/TKO", short: "KO" },
  { value: "SUB", label: "Submission", short: "Sub" },
  { value: "UD", label: "Decision", short: "Dec" },
];

/**
 * A short buzz on the tap that commits a call.
 *
 * Not decoration — it is the only feedback channel that survives a thumb
 * covering the button it just pressed, which is exactly what happens on a
 * phone. Guarded because `vibrate` is absent on iOS Safari and desktop, and
 * because a browser that has never had a user gesture throws rather than
 * returning false.
 */
function haptic(pattern: number | number[]) {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(pattern);
    }
  } catch {
    /* vibration is a nicety; never let it break a pick */
  }
}

/**
 * The crowd pick — the core habit-loop control. One tap LOCKS a corner; the
 * aggregate renders as the red-vs-blue crowd bar with a running count.
 * Optimistic, backed by /api/fights/[slug]/pick. Signed-out users are routed to
 * /account. Reusable on the bout page, on the event page and inline on cards.
 */
// A corner priced at or below this vig-free market probability is the underdog —
// roughly +140 or longer. Below the threshold we surface an "Underdog" chip and,
// when the user picks that corner, an upset nudge (the pick is worth more if it
// lands — see reputation.ts::pickReputation).
const UNDERDOG_THRESHOLD = 0.42;

/** How long a "tap again to switch" arm stays live before it forgets. */
const ARM_MS = 3200;

export function BoutPick({
  fightSlug,
  redName,
  blueName,
  initialCrowd,
  initialPick,
  marketRedP = null,
  locked = false,
  lockedNote,
  variant = "full",
  friendPicks = null,
  challenge = null,
}: {
  fightSlug: string;
  redName: string;
  blueName: string;
  initialCrowd: Crowd;
  initialPick: Pick | null;
  /** Vig-free market win probability for the RED corner (0..1), or null when no
   *  odds are connected (niche sports) — the underdog cue simply stays hidden. */
  marketRedP?: number | null;
  /**
   * Picks are CLOSED (first bell has rung — see intelligence/pick-status
   * ::picksLocked, the same predicate castPick enforces server-side).
   *
   * Without this the control stayed fully interactive on a bout that had already
   * happened: taps were rejected by the API, and a call made before the bell read
   * as a live, unsettled prediction indefinitely. A locked card shows the call that
   * was made and says what it is waiting for.
   */
  locked?: boolean;
  /** What the locked card is waiting for, e.g. "Awaiting confirmed result". */
  lockedNote?: string;
  /**
   * `full`    — the dedicated bout page and the event page's main-event slot.
   *             One bout on screen, so the control can afford section headings,
   *             explanatory copy and the optional finish-method refinement.
   * `compact` — inline on an event card and down a fight card, where this
   *             repeats once per bout.
   *
   * The two exist because the same control that reads as generous on a single
   * bout reads as noise twelve times down a card. Compact keeps every DECISION
   * (corner, crowd, underdog, locked state) and drops the labelling and the
   * secondary refinement that repetition makes into furniture.
   */
  variant?: "full" | "compact";
  /**
   * Who among the people you follow called this bout. Rendered verbatim under
   * the corners when supplied — the social proof that turns a solo prediction
   * into a room. Null today on every surface; the slot exists so the feature
   * lands as data plumbing and not another redesign of this component.
   */
  friendPicks?: React.ReactNode;
  /** The "Challenge a friend" entry point, shown once a call is locked in. */
  challenge?: React.ReactNode;
}) {
  const gate = useAuthGate();
  const t = useT();
  const [crowd, setCrowd] = useState<Crowd>(initialCrowd);
  const [pick, setPick] = useState<Pick | null>(initialPick);
  const [busy, setBusy] = useState(false);
  // Transient "just locked it" celebration — the moment a call is committed,
  // fired only when the CORNER changes (not on a method tweak), so the reward
  // marks the decision, not each adjustment.
  const [flash, setFlash] = useState(false);
  /**
   * CANNOT ACCIDENTALLY SUBMIT.
   *
   * A first pick commits on one tap: nothing is being destroyed, and putting a
   * confirmation in front of the single action this product exists for would
   * cost far more than a stray tap does.
   *
   * OVERWRITING a locked call is the destructive one — a mis-tap on a scrolling
   * fourteen-bout card silently threw away the pick you had already made and
   * moved the crowd bar. So the opposite corner ARMS first ("tap again to
   * switch") and commits on the second tap, disarming itself after a few
   * seconds. Two taps, no dialog, no modal to dismiss on a phone.
   */
  const [armed, setArmed] = useState<Corner | null>(null);
  // A tap that lands BEFORE auth resolves is remembered, not discarded.
  // Verified: without this, a tap at 6x CPU throttle on Slow 3G no longer
  // redirected (the P0 fix) but silently did nothing — the intent was dropped
  // and the user was left tapping a dead control. Queue it, replay it the
  // moment auth resolves. Event-driven; no delay, no polling, no retry loop.
  const queued = useRef<{ corner: Corner; method: Method | null } | null>(null);

  /**
   * The arm expires by itself.
   *
   * Derived from the `armed` state rather than held in a ref + setTimeout pair,
   * so there is exactly one place the timer can exist: re-arming the other
   * corner cancels the previous timer through the cleanup, and unmounting mid-arm
   * cancels it too. The ref version needed both of those written by hand, and
   * read `.current` inside a handler passed down during render.
   */
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), ARM_MS);
    return () => clearTimeout(t);
  }, [armed]);

  const send = useCallback(async function send(corner: Corner, method: Method | null) {
    const decision = gate.requireSignIn();
    // PENDING = auth still resolving. Do NOT redirect (that was the P0 bug) and
    // do NOT drop the tap either — hold it and replay when we know who they are.
    if (decision === "PENDING") { queued.current = { corner, method }; return; }
    if (decision !== "OK") return;
    // Belt and braces: the buttons are disabled when locked, and the write is
    // refused here too, so no code path optimistically moves the crowd bar for a
    // pick the server is going to reject.
    if (locked || busy) return;
    setBusy(true);

    // Optimistic crowd move.
    const prev = pick;
    const committing = !prev || prev.corner !== corner;
    setPick({ corner, confidence: prev?.corner === corner ? prev.confidence : null, method });
    if (committing) haptic([12, 28, 18]);
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
        body: JSON.stringify({ corner, method }),
      });
      if (res.ok) {
        const d = await res.json();
        setCrowd(d.crowd);
        setPick(d.myPick);
        if (committing) { setFlash(true); setTimeout(() => setFlash(false), 1400); }
      } else {
        setPick(prev);
        setCrowd(initialCrowd);
      }
    } catch {
      setPick(prev);
    } finally {
      setBusy(false);
    }
  }, [gate, locked, busy, pick, fightSlug, initialCrowd]);

  /**
   * The ONE entry point every corner control calls. Holds the arm/commit rule so
   * neither variant can implement it slightly differently.
   */
  const tapCorner = useCallback((corner: Corner) => {
    if (locked || busy) return;
    // Re-tapping the corner you already hold is a no-op, not an un-pick. An
    // accidental second tap on your own call must never clear it.
    if (pick?.corner === corner) { setArmed(null); return; }
    if (pick && armed !== corner) {
      // Switching away from a locked call — arm, don't commit.
      haptic(8);
      setArmed(corner);
      return;
    }
    setArmed(null);
    void send(corner, pick?.method ?? null);
  }, [locked, busy, pick, armed, send]);

  // Replay a tap that beat the auth provider, the instant auth resolves.
  useEffect(() => {
    if (!gate.ready || !queued.current) return;
    const q = queued.current;
    queued.current = null;
    void send(q.corner, q.method);
  }, [gate.ready, send]);

  const redP = crowd.total ? crowd.red / crowd.total : 0.5;

  const redUnderdog = marketRedP != null && marketRedP <= UNDERDOG_THRESHOLD;
  const blueUnderdog = marketRedP != null && 1 - marketRedP <= UNDERDOG_THRESHOLD;
  const pickedUnderdog =
    (pick?.corner === "RED" && redUnderdog) || (pick?.corner === "BLUE" && blueUnderdog);

  const redPct = Math.round(redP * 100);
  const pickedName = pick?.corner === "RED" ? redName : blueName;

  /**
   * Props shared by both corners of both variants — described once, not twice.
   *
   * `onClick` is deliberately NOT in here and is spelled out at each call site:
   * building a handler inside a helper invoked during render makes the
   * react-hooks lint treat `send`'s internal `queued` ref as a render-time read.
   * The handler is one line at the point of use; the other nine props are the
   * ones worth centralising.
   */
  const cornerProps = (corner: Corner) => ({
    name: corner === "RED" ? redName : blueName,
    corner,
    fightSlug,
    picked: pick?.corner === corner,
    armed: armed === corner,
    dimmed: pick != null && pick.corner !== corner,
    underdog: corner === "RED" ? redUnderdog : blueUnderdog,
    crowdPct: crowd.total > 0 ? (corner === "RED" ? redPct : 100 - redPct) : null,
    disabled: locked,
    busy,
    flash: flash && pick?.corner === corner,
  });

  // ── COMPACT ─────────────────────────────────────────────────────────────
  //
  // Two lock buttons, the crowd hairline, and — once a call exists — the
  // confirmation. Nothing else. The crowd bar is absent entirely at zero rather
  // than sitting at 50/50, which would claim a consensus that does not exist.
  if (variant === "compact") {
    return (
      <div className="rounded-lg border border-ink-800 bg-ink-950/40 p-2.5">
        <div className="grid grid-cols-2 gap-2">
          <LockButton size="sm" {...cornerProps("RED")} onClick={() => tapCorner("RED")} />
          <LockButton size="sm" {...cornerProps("BLUE")} onClick={() => tapCorner("BLUE")} />
        </div>

        {armed && !locked && <ArmedHint corner={armed} name={armed === "RED" ? redName : blueName} />}

        {/* The crowd — percentages either side of a two-tone bar, so the split
            reads in the SAME red/blue vocabulary as the buttons above it. */}
        {crowd.total > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <span className="w-8 shrink-0 text-3xs font-bold tabular-nums text-blood-400">{redPct}%</span>
            <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-ink-800">
              <div className="h-full bg-blood-500 transition-all duration-500" style={{ width: `${redPct}%` }} />
              <div className="h-full flex-1 bg-volt-500 transition-all duration-500" />
            </div>
            <span className="w-8 shrink-0 text-right text-3xs font-bold tabular-nums text-volt-400">{100 - redPct}%</span>
          </div>
        )}

        {friendPicks && <div className="mt-2">{friendPicks}</div>}

        {/* Locked in — the reward, and the receipt. */}
        {pick && !locked && (
          <div
            className={cn(
              "qp-reveal mt-2 flex items-center gap-1.5 rounded-md border px-2 py-1.5 transition-all duration-300 ease-out-back",
              CORNER_THEME[pick.corner].border,
              CORNER_THEME[pick.corner].bg,
              flash && cn("scale-[1.02] ring-1", CORNER_THEME[pick.corner].ring, CORNER_THEME[pick.corner].glow),
            )}
          >
            <Check className={cn("size-4 shrink-0", CORNER_THEME[pick.corner].text, flash && "cr-crown-pop")} />
            <span className="min-w-0 truncate font-display text-3xs font-black uppercase tracking-wider text-chalk">
              Pick locked · {pickedName}
            </span>
          </div>
        )}

        {/* Picks closed: the call stays legible, every affordance goes. */}
        {pick && locked && (
          <p className="mt-2 flex items-center gap-1.5 text-3xs text-fog">
            <Lock className="size-3.5 shrink-0 text-up" />
            <span className="text-mist">{pickedName}</span>
            {pick.method && <span>· {METHODS.find((m) => m.value === pick.method)?.short}</span>}
            <span className="ml-auto">{lockedNote ?? "awaiting result"}</span>
          </p>
        )}

        {pickedUnderdog && !locked && (
          <p className="mt-1.5 flex items-center gap-1 text-3xs font-semibold text-gold-400">
            <Flame className="size-3" /> Upset call — worth more.
          </p>
        )}

        {challenge && pick && !locked && <div className="mt-2">{challenge}</div>}
      </div>
    );
  }

  return (
    <div className="card-surface divide-y divide-ink-800 p-0">
      {/* ── SYSTEM 1 · Community Prediction — "what does the community think?" ──
          Crowd consensus only. Never shows finish method. */}
      <section className="p-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 font-display text-sm font-bold uppercase tracking-wide text-chalk">
            <Users className="size-4 text-volt-400" /> Community Prediction
          </span>
          <span className="text-3xs uppercase tracking-wider text-fog tabular-nums">
            {crowd.total.toLocaleString()} prediction{crowd.total === 1 ? "" : "s"}
          </span>
        </div>
        {crowd.total > 0 ? (
          <>
            <ProbabilityBar redLabel={redName} blueLabel={blueName} redProbability={redP} />
            <p className="mt-2 text-2xs leading-relaxed text-fog">
              {crowd.total.toLocaleString()} members predict{" "}
              <span className="font-semibold text-mist">{redPct >= 50 ? `${redName} (${redPct}%)` : `${blueName} (${100 - redPct}%)`}</span> wins.
            </p>
          </>
        ) : (
          <p className="rounded-lg bg-ink-800 px-3 py-2.5 text-center text-xs text-fog">
            Be the first community prediction.
          </p>
        )}
      </section>

      {/* ── SYSTEM 2 · Your Challenge — "what do YOU think happens?" ──
          Personal, scored game: lock a corner. Skill, not betting. */}
      <section className="p-5">
        <div className="mb-1 flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 font-display text-sm font-bold uppercase tracking-wide text-chalk">
            <Swords className="size-4 text-blood-400" /> Your Challenge
          </span>
          {busy && <Loader2 className="size-4 animate-spin text-fog" />}
        </div>
        <p className="mb-3 text-2xs leading-relaxed text-fog">
          {locked
            ? (lockedNote ?? "Picks are closed — the card has started.")
            : pick
              ? "Locked in. Call how it ends for more points — or switch corners while you still can."
              : "Lock your call — earn points if it lands. Skill, not betting."}
        </p>

        {/* THE decision. Two buttons, thumb-sized, unmistakable. */}
        <div className="grid grid-cols-2 gap-3">
          <LockButton size="lg" {...cornerProps("RED")} onClick={() => tapCorner("RED")} />
          <LockButton size="lg" {...cornerProps("BLUE")} onClick={() => tapCorner("BLUE")} />
        </div>

        {armed && !locked && <ArmedHint corner={armed} name={armed === "RED" ? redName : blueName} />}

        {/* Upset nudge — calling against the crowd scores higher. */}
        {pickedUnderdog && (
          <p className="mt-3 flex items-center justify-center gap-1.5 text-2xs font-semibold text-gold-400">
            <Flame className="size-3.5" /> You&apos;re calling the upset — worth more if you nail it.
          </p>
        )}

        {friendPicks && <div className="mt-3">{friendPicks}</div>}

        {/* Finish method — optional, and only here. It is a refinement made
            AFTER the decision, on a page showing one bout; down a fight card it
            was twelve more rows of secondary controls between the reader and
            the next fight. */}
        {pick && !locked && (
          <div className="qp-reveal mt-4 flex flex-wrap items-center justify-center gap-2">
            <span className="w-full text-center text-3xs uppercase tracking-wider text-fog">{t("How it ends (optional)")}</span>
            {METHODS.map((m) => (
              <button
                key={m.value}
                type="button"
                aria-pressed={pick.method === m.value}
                onClick={() => send(pick.corner, pick.method === m.value ? null : m.value)}
                className={cn(
                  "tap rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                  pick.method === m.value ? "border-blood-500 bg-blood-500/15 text-chalk" : "border-ink-700 text-mist hover:border-ink-600 hover:bg-ink-800",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}

        {/* Locked-in confirmation — the reward. A pick used to save silently;
            committing a call now lands with a visible, satisfying "locked in"
            state. The flash marks the moment; the banner persists. */}
        {pick && (
          <div
            aria-live="polite"
            className={cn(
              // `ease-out-back` + the scale is the press payoff. 300ms is long
              // enough to register as a moment and short enough not to block
              // the next pick on a fourteen-bout card.
              "mt-4 flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 transition-all duration-300 ease-out-back",
              flash
                ? cn("scale-[1.02] ring-1", CORNER_THEME[pick.corner].border, CORNER_THEME[pick.corner].bg,
                     CORNER_THEME[pick.corner].glow, CORNER_THEME[pick.corner].ring)
                : cn("border-ink-700 bg-ink-950/40"),
            )}
          >
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full border",
                CORNER_THEME[pick.corner].border,
                CORNER_THEME[pick.corner].bg,
                CORNER_THEME[pick.corner].text,
                flash && "cr-crown-pop",
              )}
            >
              <Check className="size-5" strokeWidth={3} />
            </span>
            <div className="min-w-0">
              <p className="font-display text-sm font-black uppercase tracking-wide text-chalk">
                Pick locked — {pick.corner === "RED" ? redName : blueName}
              </p>
              <p className="text-2xs leading-snug text-fog">
                {pick.method ? `By ${METHODS.find((m) => m.value === pick.method)?.label} · ` : ""}
                {/* Locked: say what it is waiting for. "points if it lands" on a bout
                    that finished two days ago is the sentence that made an unsettled
                    prediction look like a live one. */}
                <span className="text-mist">{locked ? (lockedNote ?? "awaiting result") : "points if it lands"}</span>
              </p>
            </div>
          </div>
        )}

        {challenge && pick && !locked && <div className="mt-3">{challenge}</div>}
      </section>
    </div>
  );
}

/**
 * "Tap again to switch" — the second half of the overwrite guard, said out loud.
 *
 * An armed button that merely looked different would leave the reader tapping a
 * control that visibly did nothing, which is worse than the mis-tap it prevents.
 * `role="status"` so it is announced rather than only seen.
 */
function ArmedHint({ corner, name }: { corner: Corner; name: string }) {
  return (
    <p
      role="status"
      className={cn(
        "qp-reveal mt-2 flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-3xs font-bold uppercase tracking-wider",
        CORNER_THEME[corner].border,
        CORNER_THEME[corner].bg,
        CORNER_THEME[corner].text,
      )}
    >
      <Lock className="size-3" /> Tap again to switch to {name}
    </p>
  );
}

/**
 * THE control. One button, one decision: LOCK RED or LOCK BLUE.
 *
 * This replaced a pair of quiet tinted pills whose only verb was implied. The
 * complaint they answered was real — the card told you who was fighting and
 * then offered nothing that looked like an action. A lock button says what it
 * does, in the corner's own colour, at a size a thumb finds without aiming.
 *
 * Three states, each visually unambiguous:
 *   at rest   — tinted, "LOCK RED", crowd % underneath
 *   armed     — outlined in the corner colour, "TAP AGAIN", pulsing lock icon
 *   picked    — solid corner colour, white on colour, "PICK LOCKED", lifted
 *
 * `scale` is a compositor-only transform, so the dominance change between
 * picked and dimmed costs no reflow and no CLS on a fourteen-bout card. The
 * reduced-motion backstop in globals.css neutralises all of it for anyone who
 * asked for that.
 */
function LockButton({
  name, corner, fightSlug, picked, armed, dimmed, underdog, crowdPct, disabled, busy, flash, size, onClick,
}: {
  name: string;
  corner: Corner;
  /** Stamped onto the control so a test can target one exact bout. */
  fightSlug: string;
  picked: boolean;
  /** Arming state for the overwrite guard — one more tap commits. */
  armed: boolean;
  /** A call was made and it was not this corner — recede, do not vanish. */
  dimmed: boolean;
  underdog: boolean;
  /** This corner's share of the room, or null when nobody has called it. */
  crowdPct: number | null;
  disabled: boolean;
  busy: boolean;
  /** This corner was just committed — play the press payoff once. */
  flash: boolean;
  size: "sm" | "lg";
  onClick: () => void;
}) {
  const t = useT();
  const red = corner === "RED";
  const big = size === "lg";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      aria-pressed={picked}
      aria-label={
        picked ? `Pick locked: ${name}`
        : armed ? `Tap again to switch your pick to ${name}`
        : `Lock ${red ? "red" : "blue"} corner — ${name}`
      }
      // Testability is a product feature. Selecting this control by nth() or by
      // aria-pressed also matched the method pills, which produced a browser test
      // that could not tell "the replay failed" from "the harness clicked the
      // wrong thing".
      data-testid="corner-pick"
      data-corner={corner}
      data-fight={fightSlug}
      data-picked={picked ? "true" : "false"}
      data-armed={armed ? "true" : "false"}
      className={cn(
        // min-h-14 (56px) large / min-h-12 (48px) compact. Both clear the 44px
        // WCAG 2.5.5 floor with room to spare — this is the single most-tapped
        // control in the product and the previous 44px pill was the minimum, not
        // the right answer, for a primary CTA.
        "tap relative flex w-full flex-col items-center justify-center gap-0.5 overflow-hidden rounded-xl border-2 text-center transition-all duration-[250ms] ease-out-back will-change-transform",
        big ? "min-h-14 px-3 py-2.5" : "min-h-12 px-2 py-2",
        disabled ? "cursor-default" : "active:scale-[0.96]",
        flash && "cr-lock-pop cr-lock-sheen",
        picked
          // Chosen: solid corner colour, white text, lifted forward. AA-safe —
          // white on blood-600 and on volt-600 both clear 4.5:1 at this weight.
          ? cn(
              "z-10 scale-[1.03] text-white",
              red ? "border-blood-400 bg-blood-600 shadow-glow-red" : "border-volt-400 bg-volt-600 shadow-glow-volt",
            )
          : armed
            // Armed: the corner's colour as an OUTLINE, not a fill. It must not
            // look committed — nothing has been written yet.
            ? cn(
                "scale-100 opacity-100 saturate-100 animate-pulse",
                red ? "border-blood-400 bg-blood-500/20 text-blood-200" : "border-volt-400 bg-volt-500/20 text-volt-200",
              )
            : dimmed
              // The corner NOT chosen. Recedes rather than disappearing — it is
              // still the way to change your mind, so it stays legible and
              // tappable, just quieter than the call actually made.
              ? cn(
                  "scale-[0.97] text-fog opacity-55 saturate-50 hover:scale-100 hover:opacity-100 hover:saturate-100",
                  red ? "border-blood-500/25 bg-blood-500/[0.05]" : "border-volt-500/25 bg-volt-500/[0.05]",
                )
              : disabled
                ? "border-ink-800 text-fog"
                : red
                  ? "border-blood-500/45 bg-blood-500/10 text-chalk hover:border-blood-500 hover:bg-blood-500/20"
                  : "border-volt-500/45 bg-volt-500/10 text-chalk hover:border-volt-500 hover:bg-volt-500/20",
      )}
    >
      {/* THE VERB, in the corner's own word. Uppercase and black-weight so it
          reads as a button at arm's length on a phone. */}
      <span
        className={cn(
          "flex items-center gap-1 font-display font-black uppercase leading-none tracking-[0.08em]",
          big ? "text-sm" : "text-3xs",
        )}
      >
        {picked ? (
          <>
            <Check className={big ? "size-4" : "size-3"} strokeWidth={3} /> {t("Pick locked")}
          </>
        ) : armed ? (
          <>
            <Lock className={big ? "size-4" : "size-3"} /> {t("Tap again")}
          </>
        ) : (
          <>
            <Lock className={big ? "size-4" : "size-3"} /> Lock {CORNER_THEME[corner].word}
          </>
        )}
      </span>

      {/* truncate + min-w-0 — a long Thai or Brazilian name must ellipsis, never
          wrap the button to three lines and break the row's rhythm. */}
      <span
        className={cn(
          "min-w-0 max-w-full truncate font-display font-bold leading-tight",
          big ? "text-sm" : "text-xs",
          picked ? "text-white" : "",
        )}
      >
        {name}
      </span>

      {/* The room, per corner — "current room %" without a second glance at a
          separate bar. Hidden when nobody has called the bout: 0% is a claim,
          and an empty room has not made one. */}
      {(crowdPct !== null || underdog) && (
        <span className="flex items-center gap-1 text-4xs font-bold uppercase tracking-wider opacity-80">
          {crowdPct !== null && <span className="tabular-nums">{crowdPct}% of room</span>}
          {underdog && <Flame className="size-3 text-gold-400" aria-label="Underdog" />}
        </span>
      )}
    </button>
  );
}
