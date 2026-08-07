"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Swords, Loader2, ChevronRight, Check, AlertCircle } from "lucide-react";
import { useCountdown, spokenRemaining } from "@/lib/use-countdown";
import type { DmChallenge } from "@/lib/messages/types";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  The challenge card, inside a conversation.
//
//  ── Why it is interactive here rather than linking out ────────────────────
//  The whole reason a challenge is delivered as a message is to remove the
//  jump. A card that says "you have been challenged — open the fight page to
//  respond" would have moved the dead end rather than closed it. Accepting
//  happens on the card, in the thread, next to the person who sent it.
//
//  ── Why it reads its state from the thread, not from itself ───────────────
//  Everything shown here arrives on the message DTO, joined live when the
//  thread loads and refreshed by the thread's existing 3s poll. So when the
//  other person answers, the card updates with the conversation — no second
//  poller, no socket, and no way for the card to disagree with the messages
//  around it.
// ════════════════════════════════════════════════════════════════════════════

/** Accepting IS picking. One endpoint, the same one the fight page uses. */
async function pickCorner(fightSlug: string, corner: "RED" | "BLUE"): Promise<void> {
  const res = await fetch(`/api/fights/${encodeURIComponent(fightSlug)}/pick`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ corner }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(typeof data.error === "string" ? data.error : "Could not save that pick.");
  }
}

function Countdown({ iso }: { iso: string }) {
  const { remaining, started } = useCountdown(iso);
  if (started === null) return null;
  if (!remaining) {
    return <span className="font-display text-2xs font-bold uppercase tracking-wide text-blood-300">Under way</span>;
  }
  const { days, hours, minutes } = remaining;
  const text = days > 0 ? `${days}d ${hours}h` : `${hours}h ${minutes}m`;
  return (
    <span
      className="font-display text-2xs font-bold uppercase tracking-wide tabular-nums text-mist"
      title={`${spokenRemaining(remaining)} to first bell`}
    >
      {text} to go
    </span>
  );
}

export function ChallengeCard({
  challenge,
  /** The sentence stored on the message — the accessible name and the fallback. */
  body,
  fromMe,
  /** Lets the thread re-poll the moment a corner is taken. */
  onAnswered,
}: {
  challenge: DmChallenge;
  body: string;
  fromMe: boolean;
  onAnswered?: () => void;
}) {
  const [busy, setBusy] = useState<"RED" | "BLUE" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const c = challenge;

  // The invitee takes the OTHER corner — that is what there is to settle. The
  // card offers exactly that one, rather than a free choice that could resolve
  // to "we agree" and settle nothing.
  const myCorner: "RED" | "BLUE" = c.challengerCorner === "RED" ? "BLUE" : "RED";
  const myFighter = myCorner === "RED" ? c.red : c.blue;
  const theirFighter = c.challengerCorner === "RED" ? c.red : c.blue;

  const live = c.state === "ACTIVE";
  const settled = c.state === "RESOLVED";
  const dead = c.state === "CANCELLED" || c.state === "EXPIRED";

  async function accept() {
    setBusy(myCorner);
    setError(null);
    try {
      await pickCorner(c.fightSlug, myCorner);
      // The battle is activated server-side by pairBattle → acceptPendingInvite
      // on the back of the pick, so the card just needs the thread re-read.
      onAnswered?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that pick.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <article
      aria-label={body}
      className={cn(
        "w-[min(20rem,80vw)] overflow-hidden rounded-2xl border bg-ink-950",
        dead ? "border-ink-800 opacity-70" : "border-blood-500/40",
      )}
    >
      {/* Poster strip — the event this is about, recognisable at a glance. */}
      <div className="relative aspect-[16/7] w-full bg-ink-900">
        {c.posterUrl ? (
          <Image src={c.posterUrl} alt="" fill sizes="320px" className={cn("object-cover", dead && "saturate-50")} unoptimized />
        ) : (
          <div className="size-full bg-gradient-to-br from-blood-900/50 to-ink-950" />
        )}
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/50 to-transparent" />

        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-blood-500 px-1.5 py-0.5 font-display text-3xs font-black uppercase tracking-wider text-white">
          <Swords className="size-3" aria-hidden /> Challenge
        </span>

        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2">
          <p className="min-w-0 truncate font-display text-xs font-black text-chalk">
            {c.red} <span className="text-blood-400">vs</span> {c.blue}
          </p>
          {c.eventDate && !dead && !settled && <Countdown iso={c.eventDate} />}
        </div>
      </div>

      <div className="flex flex-col gap-2 p-3">
        {c.eventName && (
          <p className="truncate text-2xs uppercase tracking-wider text-fog">{c.eventName}</p>
        )}

        {/* ── The state line ────────────────────────────────────────────────
            One sentence that always answers "what now?". The brief's rule: no
            screen should leave somebody wondering what they are meant to do. */}
        {live ? (
          <p className="flex items-center gap-1.5 text-xs font-semibold text-up">
            <Check className="size-3.5 shrink-0" aria-hidden />
            Battle on — {theirFighter} vs {myFighter}.
          </p>
        ) : settled ? (
          <p className="text-xs text-mist">This battle has been settled.</p>
        ) : dead ? (
          <p className="text-xs text-fog">This challenge is no longer open.</p>
        ) : fromMe ? (
          <p className="text-xs text-mist">
            You took <span className="font-semibold text-chalk">{theirFighter}</span>. Waiting for
            their call on {myFighter}.
          </p>
        ) : (
          <p className="text-xs text-mist">
            They took <span className="font-semibold text-chalk">{theirFighter}</span>. Take{" "}
            <span className="font-semibold text-chalk">{myFighter}</span> to make it a battle.
          </p>
        )}

        {/* ── Actions ──────────────────────────────────────────────────────
            Accept is the ONE primary action and it names the fighter rather
            than saying "Accept" — the decision is which fighter you back, and a
            generic verb hides the thing being decided. */}
        <div className="flex items-center gap-1.5">
          {c.awaitingViewer && c.open && (
            <button
              type="button"
              onClick={() => void accept()}
              disabled={busy !== null}
              className="tap inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-blood-500 px-3 font-display text-2xs font-black uppercase tracking-wider text-white transition-colors hover:bg-blood-400 disabled:opacity-60"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Swords className="size-3.5" aria-hidden />}
              Take {myFighter}
            </button>
          )}

          {/* Deliberately NO "Decline". Ignoring a challenge already declines it
              — the invite expires with the bout — and a decline button turns a
              non-event into a notification telling somebody they were refused.
              The quiet path is the kinder default and needs no code. */}

          <Link
            href={c.eventSlug ? `/events/${c.eventSlug}#fight-${c.fightSlug}` : `/fights/${c.fightSlug}`}
            className={cn(
              "tap inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-ink-600 bg-ink-800 px-3 font-display text-2xs font-bold uppercase tracking-wide text-chalk transition-colors hover:border-ink-500",
              c.awaitingViewer && c.open ? "shrink-0" : "flex-1",
            )}
          >
            {c.awaitingViewer && c.open ? "Event" : "Open event"}
            <ChevronRight className="size-3.5" aria-hidden />
          </Link>
        </div>

        {!c.open && !live && !settled && !dead && (
          <p className="text-3xs leading-relaxed text-fog">
            This bout is locked — picks closed before it was answered.
          </p>
        )}

        {error && (
          <p role="alert" className="flex items-center gap-1 text-3xs text-blood-300">
            <AlertCircle className="size-3 shrink-0" aria-hidden /> {error}
          </p>
        )}
      </div>
    </article>
  );
}
