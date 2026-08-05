"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Loader2, Search, Swords, UserRound } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { ForumAvatar } from "@/components/forums/user-identity";
import { useAuthGate } from "@/lib/auth-client";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface Person { username: string; name: string; image: string | null }

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
export function ChallengeFriend({ fightSlug }: { fightSlug: string }) {
  const gate = useAuthGate();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [suggested, setSuggested] = useState(true);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [sent, setSent] = useState<Person | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /**
   * Every keystroke starts a request and they do not come back in order — a
   * two-character query issued first can land after the five-character one and
   * overwrite the right list with a stale one. The counter is the guard: only
   * the newest request is allowed to write state.
   */
  const seq = useRef(0);

  const run = useCallback(async (value: string) => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(value.trim())}`);
      if (mine !== seq.current) return;
      if (!res.ok) { setPeople([]); return; }
      const data = await res.json();
      setPeople(Array.isArray(data.people) ? data.people : []);
      setSuggested(Boolean(data.suggested));
    } catch {
      if (mine === seq.current) setPeople([]);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  // Autocomplete WHILE TYPING. 180ms matches the site-wide search overlay, so
  // the two typeaheads feel like one feature rather than two.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void run(q), 180);
    return () => clearTimeout(t);
  }, [q, open, run]);

  function launch() {
    // PENDING = auth still resolving. Do NOT redirect a signed-in user off the
    // page mid-tap; the gate returns OK the moment it knows. Same rule as
    // FollowButton and BoutPick.
    if (gate.requireSignIn() !== "OK") return;
    setQ("");
    setPeople([]);
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
      setSent(person);
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
        className="tap inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-blood-500/40 bg-blood-500/10 px-3 py-2 font-display text-xs font-black uppercase tracking-wider text-blood-200 transition-colors hover:border-blood-500 hover:bg-blood-500/20 active:scale-[0.98]"
      >
        <Swords className="size-4" /> {t("Challenge a friend")}
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
            <p className="text-sm text-fog">
              <span className="text-mist">{sent.name}</span> is your rival on this bout. Settle it in the room.
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
            <div className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-950/60 px-3">
              <Search className="size-4 shrink-0 text-fog" aria-hidden />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                // `search` so mobile keyboards offer a sensible action key, and
                // autocomplete off so the browser does not paste an email in.
                type="search"
                autoComplete="off"
                aria-label={t("Search people by name or @username")}
                placeholder={t("Search @username or name…")}
                className="h-12 flex-1 bg-transparent text-sm text-chalk outline-none placeholder:text-fog"
              />
              {loading && <Loader2 className="size-4 shrink-0 animate-spin text-fog" aria-hidden />}
            </div>

            {error && (
              <p role="alert" className="rounded-lg border border-blood-500/40 bg-blood-500/10 px-3 py-2 text-xs text-blood-200">
                {error}
              </p>
            )}

            {/* Say WHICH list this is. Without the label a follow-list and a
                search-result list are indistinguishable, and a reader who types
                nothing cannot tell whether the app found these people or they
                are simply who they follow. */}
            {people.length > 0 && (
              <p className="px-1 pt-1 font-display text-3xs font-bold uppercase tracking-widest text-fog">
                {suggested ? "People you follow" : "Results"}
              </p>
            )}

            <ul className="max-h-[46vh] space-y-1 overflow-y-auto">
              {people.map((p) => (
                <li key={p.username}>
                  <button
                    type="button"
                    onClick={() => void send(p)}
                    disabled={sending !== null}
                    className={cn(
                      "tap flex min-h-14 w-full items-center gap-3 rounded-lg border border-transparent px-2 py-2 text-left transition-colors hover:border-ink-700 hover:bg-ink-800/70",
                      sending === p.username && "opacity-60",
                    )}
                  >
                    <ForumAvatar name={p.name} image={p.image} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-display text-sm font-bold text-chalk">{p.name}</span>
                      <span className="block truncate text-xs text-fog">@{p.username}</span>
                    </span>
                    {sending === p.username
                      ? <Loader2 className="size-4 shrink-0 animate-spin text-fog" />
                      : <Swords className="size-4 shrink-0 text-blood-400" />}
                  </button>
                </li>
              ))}
            </ul>

            {/* Three different empty states, because they need three different
                next actions: nobody followed yet, nothing matched, or still
                typing. One generic "no results" would be wrong twice. */}
            {!loading && people.length === 0 && (
              <p className="flex items-center justify-center gap-2 px-3 py-8 text-center text-sm text-fog">
                <UserRound className="size-4 shrink-0" />
                {q.trim()
                  ? `No one matches “${q.trim()}”.`
                  : "Follow a few people and they'll show up here — or search for a handle."}
              </p>
            )}

            <p className="px-1 pb-1 text-3xs leading-relaxed text-fog">
              They need a call on this bout too, on the other corner — that&apos;s what
              there is to settle.
            </p>
          </div>
        )}
      </Sheet>
    </>
  );
}
