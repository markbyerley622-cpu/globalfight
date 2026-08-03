"use client";

import { useState } from "react";
import { Star, Loader2, Flame, Users, Swords, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-client";
import { ProbabilityBar } from "@/components/probability-bar";

type Corner = "RED" | "BLUE";
type Method = "KO" | "SUB" | "UD";
interface Crowd { red: number; blue: number; total: number }
interface Pick { corner: Corner; confidence: number | null; method: Method | null }

// The plan's Phase-1 pick: winner + method + confidence. Three plain choices map
// to FightMethod enum values (UD stands in for any decision).
// `short` is for the compact variant, where three finish pills sit on one row
// beside five confidence stars. "Submission" wraps that row on a 360px phone;
// "Sub" does not, and nobody has ever been confused by it.
const METHODS: { value: Method; label: string; short: string }[] = [
  { value: "KO", label: "KO/TKO", short: "KO" },
  { value: "SUB", label: "Submission", short: "Sub" },
  { value: "UD", label: "Decision", short: "Dec" },
];

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
  locked = false,
  lockedNote,
  variant = "full",
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
   * `full`    — the dedicated bout page. One bout on screen, so the control can
   *             afford section headings and explanatory copy.
   * `compact` — inline on an event card, where this repeats once per bout.
   *
   * The two exist because the same control that reads as generous on a single
   * bout reads as noise twelve times down a card. The full variant costs about
   * eleven lines of chrome per bout — two section headings, an explainer
   * sentence, "Red corner"/"Blue corner" labels, two "Tap to choose" hints, a
   * "Be the first community prediction" placeholder and a locked-in banner —
   * which on a 12-bout card is ~130 lines of furniture wrapped around 24 taps.
   * The reader scrolls past the thing they came to do.
   *
   * Compact keeps every FUNCTION (corner, method, confidence, crowd, underdog,
   * locked state) and removes only the labelling that repetition already makes
   * obvious. Nothing is hidden behind a second tap.
   */
  variant?: "full" | "compact";
}) {
  const { user } = useAuth();
  const [crowd, setCrowd] = useState<Crowd>(initialCrowd);
  const [pick, setPick] = useState<Pick | null>(initialPick);
  const [busy, setBusy] = useState(false);
  // Transient "just locked it" celebration — the moment a call is committed,
  // fired only when the CORNER changes (not on every confidence/method tweak),
  // so the reward marks the decision, not each adjustment.
  const [flash, setFlash] = useState(false);

  async function send(corner: Corner, confidence: number | null, method: Method | null) {
    if (!user) { window.location.href = "/account"; return; }
    // Belt and braces: the buttons are disabled when locked, and the write is
    // refused here too, so no code path optimistically moves the crowd bar for a
    // pick the server is going to reject.
    if (locked || busy) return;
    setBusy(true);

    // Optimistic crowd move.
    const prev = pick;
    const committing = !prev || prev.corner !== corner;
    setPick({ corner, confidence, method });
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
        body: JSON.stringify({ corner, confidence, method }),
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
  }

  const redP = crowd.total ? crowd.red / crowd.total : 0.5;

  const redUnderdog = marketRedP != null && marketRedP <= UNDERDOG_THRESHOLD;
  const blueUnderdog = marketRedP != null && 1 - marketRedP <= UNDERDOG_THRESHOLD;
  const pickedUnderdog =
    (pick?.corner === "RED" && redUnderdog) || (pick?.corner === "BLUE" && blueUnderdog);

  const redPct = Math.round(redP * 100);

  // ── COMPACT ─────────────────────────────────────────────────────────────
  //
  // Everything on at most two rows. Row one is the decision (two corner pills,
  // one tap each). Row two only exists once a call is made, and carries the two
  // things that raise the score: method and confidence.
  //
  // The crowd is a hairline bar, not a section — with zero predictions it is
  // simply absent rather than a paragraph explaining its own emptiness. "Be the
  // first community prediction" is a true sentence that no one needs read to
  // them twelve times.
  if (variant === "compact") {
    const pickedName = pick?.corner === "RED" ? redName : blueName;
    return (
      <div className="rounded-xl border border-ink-800 bg-ink-950/40 p-2.5">
        <div className="grid grid-cols-2 gap-2">
          <CompactCorner
            name={redName} picked={pick?.corner === "RED"} tone="red"
            underdog={redUnderdog} disabled={locked} busy={busy}
            dimmed={pick != null && pick.corner !== "RED"}
            onClick={() => send("RED", pick?.corner === "RED" ? pick.confidence : null, pick?.corner === "RED" ? pick.method : null)}
          />
          <CompactCorner
            name={blueName} picked={pick?.corner === "BLUE"} tone="blue"
            underdog={blueUnderdog} disabled={locked} busy={busy}
            dimmed={pick != null && pick.corner !== "BLUE"}
            onClick={() => send("BLUE", pick?.corner === "BLUE" ? pick.confidence : null, pick?.corner === "BLUE" ? pick.method : null)}
          />
        </div>

        {/* The crowd — percentages either side of a two-tone bar, so the split
            reads in the SAME red/blue vocabulary as the pills above it.
            Absent entirely at zero rather than a bar at 50/50, which would
            claim a consensus that does not exist. */}
        {crowd.total > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <span className="w-8 shrink-0 text-[0.65rem] font-bold tabular-nums text-blood-400">{redPct}%</span>
            <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-ink-800">
              <div className="h-full bg-blood-500 transition-all duration-500" style={{ width: `${redPct}%` }} />
              <div className="h-full flex-1 bg-volt-500 transition-all duration-500" />
            </div>
            <span className="w-8 shrink-0 text-right text-[0.65rem] font-bold tabular-nums text-volt-400">{100 - redPct}%</span>
          </div>
        )}

        {/* Second row: only after a call, and only when it can still change. */}
        {pick && !locked && (
          <div className={cn("qp-reveal mt-2 flex flex-wrap items-center gap-1.5 transition-all", flash && "scale-[1.01]")}>
            <CheckCircle2 className={cn("size-3.5 shrink-0 text-up", flash && "animate-pulse")} />
            {METHODS.map((m) => (
              <button
                key={m.value}
                type="button"
                aria-label={`${m.label} finish`}
                aria-pressed={pick.method === m.value}
                onClick={() => send(pick.corner, pick.confidence, pick.method === m.value ? null : m.value)}
                // min-h-6 = 24px, WCAG 2.2 AA (2.5.8). The corner pills above are
                // the primary control and get the full 44px; method and
                // confidence are secondary refinements made AFTER the decision,
                // and giving them 44px too would undo the compression this
                // variant exists for. 24px is the floor, not a rounding.
                className={cn(
                  "tap inline-flex min-h-6 items-center rounded-full border px-2.5 py-1 text-[0.65rem] font-semibold transition-colors",
                  pick.method === m.value
                    ? "border-blood-500 bg-blood-500/20 text-chalk"
                    : "border-ink-700 text-fog hover:border-ink-600 hover:text-mist",
                )}
              >
                {m.short}
              </button>
            ))}
            <div className="ml-auto flex items-center">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-label={`Confidence ${n} of 5`}
                  aria-pressed={(pick.confidence ?? 0) >= n}
                  onClick={() => send(pick.corner, n, pick.method)}
                  className="tap inline-flex min-h-6 min-w-6 items-center justify-center p-1"
                >
                  <Star className={cn("size-3.5 transition-colors", (pick.confidence ?? 0) >= n ? "fill-gold-400 text-gold-400" : "text-ink-600")} />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Locked: the call stays legible, every affordance goes. */}
        {pick && locked && (
          <p className="mt-2 flex items-center gap-1.5 text-[0.65rem] text-fog">
            <CheckCircle2 className="size-3.5 shrink-0 text-up" />
            <span className="text-mist">{pickedName}</span>
            {pick.method && <span>· {METHODS.find((m) => m.value === pick.method)?.short}</span>}
            {pick.confidence && <span>· {pick.confidence}/5</span>}
            <span className="ml-auto">{lockedNote ?? "awaiting result"}</span>
          </p>
        )}

        {pickedUnderdog && !locked && (
          <p className="mt-1.5 flex items-center gap-1 text-[0.65rem] font-semibold text-gold-400">
            <Flame className="size-3" /> Upset call — worth more.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="card-surface divide-y divide-ink-800 p-0">
      {/* ── SYSTEM 1 · Community Prediction — "what does the community think?" ──
          Crowd consensus only. Never shows confidence or finish method. */}
      <section className="p-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 font-display text-sm font-bold uppercase tracking-wide text-chalk">
            <Users className="size-4 text-volt-400" /> Community Prediction
          </span>
          <span className="text-[0.65rem] uppercase tracking-wider text-fog tabular-nums">
            {crowd.total.toLocaleString()} prediction{crowd.total === 1 ? "" : "s"}
          </span>
        </div>
        {crowd.total > 0 ? (
          <>
            <ProbabilityBar redLabel={redName} blueLabel={blueName} redProbability={redP} />
            <p className="mt-2 text-[0.7rem] leading-relaxed text-fog">
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
          Personal, scored game: pick + confidence + finish. Skill, not betting. */}
      <section className="p-5">
        <div className="mb-1 flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 font-display text-sm font-bold uppercase tracking-wide text-chalk">
            <Swords className="size-4 text-blood-400" /> Your Challenge
          </span>
          {busy && <Loader2 className="size-4 animate-spin text-fog" />}
        </div>
        <p className="mb-3 text-[0.7rem] leading-relaxed text-fog">
          {locked
            ? (lockedNote ?? "Picks are closed — the card has started.")
            : pick
              ? "Set your confidence and how it ends — correct calls earn points."
              : "Make your call — earn points if it lands. Skill, not betting."}
        </p>

        {/* Choose a fighter */}
        <div className="grid grid-cols-2 gap-3">
          <CornerButton
            name={redName}
            picked={pick?.corner === "RED"}
            tone="red"
            underdog={redUnderdog}
            disabled={locked}
            onClick={() => send("RED", pick?.corner === "RED" ? pick.confidence : null, pick?.corner === "RED" ? pick.method : null)}
          />
          <CornerButton
            name={blueName}
            picked={pick?.corner === "BLUE"}
            tone="blue"
            underdog={blueUnderdog}
            disabled={locked}
            onClick={() => send("BLUE", pick?.corner === "BLUE" ? pick.confidence : null, pick?.corner === "BLUE" ? pick.method : null)}
          />
        </div>

        {/* Upset nudge — calling against the crowd scores higher. */}
        {pickedUnderdog && (
          <p className="mt-3 flex items-center justify-center gap-1.5 text-[0.7rem] font-semibold text-gold-400">
            <Flame className="size-3.5" /> You&apos;re calling the upset — worth more if you nail it.
          </p>
        )}

        {/* Confidence — appears once a fighter is chosen */}
        {pick && !locked && (
          <div className="mt-4 flex items-center justify-center gap-2">
            <span className="text-[0.65rem] uppercase tracking-wider text-fog">Confidence</span>
            <div className="-my-1 flex items-center">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-label={`Confidence ${n} of 5`}
                  aria-pressed={(pick.confidence ?? 0) >= n}
                  onClick={() => send(pick.corner, n, pick.method)}
                  className="tap p-2"
                >
                  <Star className={cn("size-4 transition-colors", (pick.confidence ?? 0) >= n ? "fill-gold-400 text-gold-400" : "text-ink-600")} />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Finish method — optional, appears with a fighter. */}
        {pick && !locked && (
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <span className="w-full text-center text-[0.65rem] uppercase tracking-wider text-fog">How it ends</span>
            {METHODS.map((m) => (
              <button
                key={m.value}
                type="button"
                aria-pressed={pick.method === m.value}
                onClick={() => send(pick.corner, pick.confidence, pick.method === m.value ? null : m.value)}
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
            now committing a call lands with a visible, satisfying "locked in"
            state that also tells you how to score more (add confidence / a
            finish). The flash marks the moment; the banner persists. */}
        {pick && (
          <div
            className={cn(
              "mt-4 flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 transition-all duration-300",
              flash ? "scale-[1.015] border-up/60 bg-up/10 shadow-glow-red" : "border-ink-700 bg-ink-950/40",
            )}
          >
            <CheckCircle2 className={cn("size-5 shrink-0 text-up", flash && "animate-pulse")} />
            <div className="min-w-0">
              <p className="font-display text-sm font-bold text-chalk">
                Locked in — you&apos;re calling {pick.corner === "RED" ? redName : blueName}
              </p>
              <p className="text-[0.7rem] leading-snug text-fog">
                {pick.confidence ? `${pick.confidence}/5 confidence` : locked ? "No confidence set" : "Tap the stars to set your confidence"}
                {pick.method ? ` · by ${METHODS.find((m) => m.value === pick.method)?.label}` : ""}
                {" · "}
                {/* Locked: say what it is waiting for. "points if it lands" on a bout
                    that finished two days ago is the sentence that made an unsettled
                    prediction look like a live one. */}
                <span className="text-mist">{locked ? (lockedNote ?? "awaiting result") : "points if it lands"}</span>
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * One tap, one decision. The whole compact interaction lives here.
 *
 * No "Red corner" label and no "Tap to choose" hint: on a card this repeats
 * beside eleven identical siblings, and by the second bout the reader has
 * learned the affordance. The tint carries the corner, the name carries the
 * fighter, and the crowd percentage sits inside the pill rather than in a
 * separate section — so choosing and seeing what everyone else chose is one
 * glance instead of two.
 *
 * `active:scale-95` is kept and `transition-all` is deliberate: the pill
 * physically responds and then settles into its picked state. That half-second
 * IS the reward — a pick that saved silently felt like nothing had happened.
 */
function CompactCorner({
  name, picked, tone, underdog = false, disabled = false, busy = false, dimmed = false, onClick,
}: {
  name: string;
  picked: boolean;
  tone: "red" | "blue";
  underdog?: boolean;
  disabled?: boolean;
  busy?: boolean;
  /** A call was made and it was not this corner — recede, do not vanish. */
  dimmed?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      aria-pressed={picked}
      aria-label={`Pick ${name}`}
      className={cn(
        // min-h-11 = 44px. MEASURED at 33px before this: `py-2` on a single
        // line of 12px text gives a 33px box, which is under every published
        // minimum touch target (WCAG 2.5.5 / Apple HIG / Material all land at
        // 44–48px) and this is the single most-tapped control on the page.
        //
        // COLOUR CARRIES THE CORNER. Combat sports already has this vocabulary —
        // red corner, blue corner — so the pills used to be two identical
        // neutral rectangles that made a fan read two names to work out which
        // was which. Tinted at rest, solid when chosen; no "Red corner" /
        // "Blue corner" label needed, which is what buys the vertical space
        // this variant runs on.
        "tap relative flex min-h-11 w-full items-center justify-between gap-1.5 rounded-lg border px-2.5 py-2 text-left transition-all duration-200",
        disabled ? "cursor-default" : "active:scale-[0.98]",
        picked
          // Chosen: solid corner colour, white text. AA-safe — white on
          // blood-600 and on volt-600 both clear 4.5:1 at this weight.
          ? tone === "red"
            ? "border-blood-500 bg-blood-600 font-bold text-white shadow-glow-red"
            : "border-volt-500 bg-volt-600 font-bold text-white"
          : dimmed
            // The corner NOT chosen. Recedes rather than disappearing — it is
            // still the way to change your mind, so it must stay legible and
            // tappable, just quieter than the call you actually made.
            ? tone === "red"
              ? "border-blood-500/20 bg-blood-500/[0.04] text-fog opacity-60 hover:opacity-100"
              : "border-volt-500/20 bg-volt-500/[0.04] text-fog opacity-60 hover:opacity-100"
            : disabled
              ? "border-ink-800 text-fog"
              // At rest: lightly tinted so the corner is readable at a glance.
              : tone === "red"
                ? "border-blood-500/35 bg-blood-500/10 text-chalk hover:border-blood-500/70 hover:bg-blood-500/20"
                : "border-volt-500/35 bg-volt-500/10 text-chalk hover:border-volt-500/70 hover:bg-volt-500/20",
      )}
    >
      {/* truncate + min-w-0 — a long Thai or Brazilian name must ellipsis, never
          wrap the pill to two lines and break the row's rhythm. */}
      <span className="min-w-0 truncate font-display text-xs font-bold leading-tight">{name}</span>
      <span className="flex shrink-0 items-center gap-1">
        {underdog && <Flame className="size-3 text-gold-400" aria-label="Underdog" />}
        {picked && <CheckCircle2 className="size-4" />}
      </span>
    </button>
  );
}

function CornerButton({
  name,
  picked,
  tone,
  underdog = false,
  disabled = false,
  onClick,
}: {
  name: string;
  picked: boolean;
  tone: "red" | "blue";
  underdog?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={picked}
      className={cn(
        "relative flex flex-col items-center gap-1 rounded-xl border px-3 py-3 text-center transition-all",
        // A locked corner keeps the CALL legible (that is the whole point of showing
        // it) but drops every affordance that promises it can still be changed.
        disabled ? "cursor-default" : "active:scale-95",
        picked
          ? tone === "red"
            ? "border-blood-500 bg-blood-500/15 text-chalk shadow-glow-red"
            : "border-volt-500 bg-volt-500/15 text-chalk"
          : disabled
            ? "border-ink-800 text-fog"
            : "border-ink-700 text-mist hover:border-ink-600 hover:bg-ink-800",
      )}
    >
      {underdog && (
        <span className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-gold-400/30 bg-ink-900 px-2 py-0.5 text-[0.55rem] font-bold uppercase tracking-wide text-gold-400 shadow-sm">
          Underdog
        </span>
      )}
      <span className={cn("text-[0.6rem] font-bold uppercase tracking-wider", tone === "red" ? "text-blood-400" : "text-volt-400")}>
        {tone === "red" ? "Red corner" : "Blue corner"}
      </span>
      <span className="font-display text-sm font-bold leading-tight">{name}</span>
      <span className="text-[0.65rem] text-fog">
        {picked ? "Your call ✓" : disabled ? "—" : "Tap to choose"}
      </span>
    </button>
  );
}
