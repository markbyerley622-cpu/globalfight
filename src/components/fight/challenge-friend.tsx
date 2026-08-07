"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Swords } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { PeoplePicker, type Person } from "@/components/people/people-picker";
import { useAuthGate } from "@/lib/auth-client";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * CHALLENGE A FRIEND — the whole flow, in one control.
 *
 *   lock a pick → tap Challenge → picker opens → type @handle (or take a
 *   suggestion) → tap them → challenge sent
 *
 * ── What this replaced ─────────────────────────────────────────────────────
 * There was no way to challenge a specific person. A battle could only start
 * from the community room: you read the thread, found somebody who had already
 * argued the opposite corner, and challenged that message. That works for a
 * stranger and is useless for the case people actually want — challenging the
 * friend who is texting them about this exact fight. The room also has to be
 * populated first, so on a quiet bout there was nobody to challenge at all.
 *
 * The picker is fed by /api/users/search, which returns the people you FOLLOW
 * when the box is empty. That is the "suggested friends" step: the friend you
 * want is nearly always someone you already follow, so the useful list is on
 * screen before a key is pressed.
 *
 * ── Why the button appears only after a pick ───────────────────────────────
 * challengeUser (lib/battles) refuses a challenge from anyone without a call on
 * the bout — the prediction is the price of entry. Rendering the button before
 * the lock would be a control whose only possible outcome is an error message,
 * so BoutPick passes this in its `challenge` slot and shows it only once a pick
 * exists.
 */
export function ChallengeFriend({
  fightSlug,
  tone = "outline",
  label,
  onSent,
}: {
  fightSlug: string;
  /**
   * `solid` is for the one place this is the PRIMARY action on screen — the
   * rival layer with no rival in it. `outline` is the quieter form that sits
   * under a locked pick, where the pick itself is the main event.
   */
  tone?: "outline" | "solid";
  label?: string;
  /**
   * Fired after a challenge lands, so a surface that renders battle state (the
   * fight room) can refetch instead of showing a stale "no rival yet" behind
   * the confirmation.
   */
  onSent?: () => void;
}) {
  const gate = useAuthGate();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [sent, setSent] = useState<Person | null>(null);
  /** True when the challenge is an unanswered INVITE rather than a live battle. */
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function launch() {
    // PENDING = auth still resolving. Do NOT redirect a signed-in user off the
    // page mid-tap; the gate returns OK the moment it knows. Same rule as
    // FollowButton and BoutPick.
    if (gate.requireSignIn() !== "OK") return;
    setSent(null);
    setError(null);
    setOpen(true);
  }

  async function send(person: Person) {
    setSending(person.username);
    setError(null);
    try {
      const res = await fetch(`/api/fights/${encodeURIComponent(fightSlug)}/challenge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // By HANDLE, not by internal id — see the challenge route. The picker
        // never receives a primary key.
        body: JSON.stringify({ username: person.username }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The server's own words. "They haven't picked this bout yet" and
        // "You both picked the same corner" are the two common refusals, and
        // both are things the user can act on — flattening them to "something
        // went wrong" would leave them tapping the same name again.
        setError(typeof data.error === "string" ? data.error : "Could not send that challenge.");
        return;
      }
      setPending(data.pending === true);
      setSent(person);
      onSent?.();
    } catch {
      setError("Could not send that challenge.");
    } finally {
      setSending(null);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={launch}
        className={cn(
          "tap inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-3 py-2 font-display text-xs font-black uppercase tracking-wider transition-colors active:scale-[0.98]",
          tone === "solid"
            ? "bg-blood-500 text-white shadow-[0_8px_24px_-10px_rgba(225,29,42,0.85)] hover:bg-blood-400"
            : "border border-blood-500/40 bg-blood-500/10 text-blood-200 hover:border-blood-500 hover:bg-blood-500/20",
        )}
      >
        <Swords className="size-4" /> {label ?? t("Challenge a friend")}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={t("Challenge a friend")}>
        {sent ? (
          // Done. One clear outcome and one route onward — not a dead panel the
          // user has to work out how to leave.
          <div className="flex flex-col items-center gap-3 px-1 py-6 text-center">
            <span className="flex size-12 items-center justify-center rounded-full border border-blood-500/50 bg-blood-500/15 text-blood-300">
              <Check className="size-6" strokeWidth={3} />
            </span>
            <p className="font-display text-base font-black uppercase tracking-wide text-chalk">{t("Challenge sent")}</p>
            {/* Two different outcomes, told apart. Sending somebody to "the
                room" for an invite nobody has answered would land them in an
                empty one. */}
            <p className="text-sm text-fog">
              {pending ? (
                <>
                  <span className="text-mist">{sent.name}</span> has been notified. It becomes a
                  battle the moment they take the other corner.
                </>
              ) : (
                <>
                  <span className="text-mist">{sent.name}</span> is your rival on this bout. Settle it in the room.
                </>
              )}
            </p>
            <Link
              href={`/u/${sent.username}`}
              className="text-xs font-semibold text-blood-300 underline-offset-2 hover:underline"
            >
              View @{sent.username} →
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            <PeoplePicker
              onPick={(p) => void send(p)}
              busy={sending}
              error={error}
              autoFocus
              action={<Swords className="size-4 shrink-0 text-blood-400" />}
            />
            {/* They do NOT need to have picked. The invite lands in their
                notifications and taking the other corner is how they accept —
                that is the whole point of challenging someone by name. */}
            <p className="px-1 pb-1 text-3xs leading-relaxed text-fog">
              They&apos;ll get a notification. Taking the other corner is how they accept —
              they don&apos;t need to have picked yet.
            </p>
          </div>
        )}
      </Sheet>
    </>
  );
}
