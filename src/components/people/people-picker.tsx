"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Search, UserRound } from "lucide-react";
import { ForumAvatar } from "@/components/forums/user-identity";
import { cn } from "@/lib/utils";

export interface Person { username: string; name: string; image: string | null }

/**
 * FIND A PERSON — the search box, the list, and the three empty states.
 *
 * Extracted from ChallengeFriend, which had the only working copy. Starting a
 * DM needed exactly the same control, and the second copy would have been the
 * point at which the two drifted: the debounce, the out-of-order-response guard
 * and the "is this a search result or the people I follow?" label are all easy
 * to get subtly differently wrong, and a user cannot tell WHICH picker they are
 * looking at, so any difference reads as a bug.
 *
 * The caller supplies only what it does with a chosen person.
 *
 * Fed by /api/users/search, which returns the people you FOLLOW when the box is
 * empty. That is the "suggested friends" step: the person you want is nearly
 * always someone you already follow, so a useful list is on screen before a key
 * is pressed.
 */
export function PeoplePicker({
  onPick,
  busy = null,
  error = null,
  autoFocus = false,
  emptyHint = "Follow a few people and they'll show up here — or search for a handle.",
  action,
}: {
  onPick: (person: Person) => void;
  /** Username currently being acted on — shows a spinner and locks the list. */
  busy?: string | null;
  error?: string | null;
  autoFocus?: boolean;
  /** What to say when the viewer follows nobody and has typed nothing. */
  emptyHint?: string;
  /** Trailing icon per row, naming the action (swords, message…). */
  action?: React.ReactNode;
}) {
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [suggested, setSuggested] = useState(true);
  const [loading, setLoading] = useState(false);
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

  // Autocomplete WHILE TYPING. 180ms matches the site-wide search overlay and
  // the mention menu, so every typeahead in the product feels like one feature.
  useEffect(() => {
    const t = setTimeout(() => void run(q), 180);
    return () => clearTimeout(t);
  }, [q, run]);

  useEffect(() => {
    // Desktop only. Focusing on a phone throws the keyboard up over the list the
    // reader is trying to read, before they have decided to search at all.
    if (autoFocus && window.matchMedia("(hover: hover)").matches) inputRef.current?.focus();
  }, [autoFocus]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-950/60 px-3 focus-within:border-blood-500/60">
        <Search className="size-4 shrink-0 text-fog" aria-hidden />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          // `search` so mobile keyboards offer a sensible action key, and
          // autocomplete off so the browser does not paste an email in.
          type="search"
          autoComplete="off"
          aria-label="Search people by name or @username"
          placeholder="Search @username or name…"
          className="h-12 flex-1 bg-transparent text-sm text-chalk outline-none placeholder:text-fog"
        />
        {loading && <Loader2 className="size-4 shrink-0 animate-spin text-fog" aria-hidden />}
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-blood-500/40 bg-blood-500/10 px-3 py-2 text-xs text-blood-200">
          {error}
        </p>
      )}

      {/* Say WHICH list this is. Without the label a follow-list and a search
          result list are indistinguishable, and a reader who types nothing
          cannot tell whether the app found these people or they are simply who
          they follow. */}
      {people.length > 0 && (
        <p className="px-1 pt-1 font-display text-3xs font-bold uppercase tracking-widest text-fog">
          {suggested ? "People you follow" : "Results"}
        </p>
      )}

      <ul className="cr-overscroll-contain max-h-[46vh] space-y-1 overflow-y-auto">
        {people.map((p) => (
          <li key={p.username}>
            <button
              type="button"
              onClick={() => onPick(p)}
              disabled={busy !== null}
              className={cn(
                "tap flex min-h-14 w-full items-center gap-3 rounded-lg border border-transparent px-2 py-2 text-left transition-colors hover:border-ink-700 hover:bg-ink-800/70 disabled:cursor-not-allowed",
                busy === p.username && "opacity-60",
              )}
            >
              <ForumAvatar name={p.name} image={p.image} size="md" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-sm font-bold text-chalk">{p.name}</span>
                <span className="block truncate text-xs text-fog">@{p.username}</span>
              </span>
              {busy === p.username
                ? <Loader2 className="size-4 shrink-0 animate-spin text-fog" />
                : action}
            </button>
          </li>
        ))}
      </ul>

      {/* Two different empty states, because they need two different next
          actions: nothing matched what was typed, or nobody is followed yet.
          One generic "no results" would be wrong in the second case. */}
      {!loading && people.length === 0 && (
        <p className="flex items-center justify-center gap-2 px-3 py-8 text-center text-sm text-fog">
          <UserRound className="size-4 shrink-0" />
          {q.trim() ? `No one matches “${q.trim()}”.` : emptyHint}
        </p>
      )}
    </div>
  );
}
