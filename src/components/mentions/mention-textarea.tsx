"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { ForumAvatar } from "@/components/forums/user-identity";
import { applyMention, readMentionToken, type MentionToken } from "@/lib/mentions";
import { cn } from "@/lib/utils";

interface Person { username: string; name: string; image: string | null }

/**
 * A textarea that completes @handles.
 *
 * ── Why this is a component and not a hook bolted onto each composer ───────
 * The interesting part of a mention control is not the fetch, it is the
 * KEYBOARD CONTRACT, and that contract has to be owned in one place:
 *
 *   • Enter SENDS the message — except while the menu is open, where it picks
 *     the highlighted person. Get this wrong and typing "@da" then Enter fires
 *     off a half-written message addressed to nobody.
 *   • Escape closes the menu — except when the menu is already closed, where it
 *     must fall through to whatever owns the surface (a sheet, a dialog).
 *   • Arrow keys move the highlight — except when the menu is closed, where
 *     they must move the caret like a normal textarea.
 *
 * Every one of those is "the same key means two things depending on state", so
 * each composer that re-implemented it would get a different subset right. The
 * component therefore owns `onKeyDown` and only forwards the event to the host
 * when the menu is closed — the host writes its Enter-to-send handler exactly
 * as if mentions did not exist.
 *
 * Fed by /api/users/search, the same endpoint behind the challenge picker, so
 * the two typeaheads rank and display people identically.
 */

/** Matches the challenge picker and the site-wide search overlay. */
const DEBOUNCE_MS = 180;

export function MentionTextarea({
  value,
  onChange,
  onSubmit,
  className,
  disabled,
  ...rest
}: {
  value: string;
  onChange: (next: string) => void;
  /** Enter (without Shift) when the mention menu is CLOSED. */
  onSubmit?: () => void;
  className?: string;
  disabled?: boolean;
} & Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange" | "onSubmit" | "className" | "disabled"
>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  /**
   * The handle fragment being typed, and where it starts.
   *
   * Computed in the CHANGE HANDLER, not in an effect and not during render.
   * Both alternatives are wrong here for the same reason: the token depends on
   * the CARET, and the caret only exists on the DOM node. Reading it during
   * render is a ref access during render (and can be stale by a frame); reading
   * it in an effect costs an extra render per keystroke on the app's most
   * latency-sensitive input. The change event carries both the new value and
   * the new caret, which is exactly and only what this needs.
   */
  const [token, setToken] = useState<MentionToken | null>(null);
  const query = token?.text ?? null;
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  /**
   * Only the newest request may write state. Keystrokes issue overlapping
   * requests and they do not come back in order — a two-character query can
   * land after the five-character one and overwrite the right list with a stale
   * one. Same guard as the challenge picker.
   */
  const seq = useRef(0);

  const open = query !== null && people.length > 0;

  /**
   * Read the in-progress handle from a change event.
   *
   * Deliberately NOT recomputed on selection changes: moving the caret into the
   * middle of an @handle the reader already finished writing should not reopen
   * a picker over it.
   */
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    onChange(next);

    // A selection (rather than a caret) is not a position to complete at.
    if (e.target.selectionStart !== e.target.selectionEnd) { setToken(null); return; }
    setToken(readMentionToken(next, e.target.selectionStart ?? next.length));
    setActive(0);
  };

  useEffect(() => {
    if (query === null) { setPeople([]); return; }
    const timer = setTimeout(async () => {
      const mine = ++seq.current;
      setLoading(true);
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`);
        if (mine !== seq.current) return;
        const data = res.ok ? await res.json() : null;
        setPeople(Array.isArray(data?.people) ? data.people : []);
      } catch {
        if (mine === seq.current) setPeople([]);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const choose = useCallback((person: Person) => {
    const el = ref.current;
    if (!el || !token) return;

    const { text: next, caret } = applyMention(value, token, person.username);
    onChange(next);
    setToken(null);
    setPeople([]);

    // The caret has to be restored AFTER React has written the new value, or
    // the browser puts it at the end of the whole textarea — which is wrong for
    // anyone mentioning somebody mid-sentence.
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }, [token, value, onChange]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % people.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i - 1 + people.length) % people.length); return; }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        // `active` can point past the end: a debounced response can replace the
        // list with a shorter one between the keypress being aimed and being
        // handled. Falling back to the first row beats calling choose(undefined).
        const person = people[active] ?? people[0];
        if (person) choose(person);
        return;
      }
      if (e.key === "Escape") {
        // stopPropagation, so closing the menu does not ALSO close the sheet or
        // dialog this composer is sitting in. Two dismissals from one press is
        // the classic nested-overlay bug.
        e.preventDefault();
        e.stopPropagation();
        setToken(null);
        setPeople([]);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey && onSubmit) {
      e.preventDefault();
      onSubmit();
      return;
    }
    rest.onKeyDown?.(e);
  };

  // useId, not Math.random(): stable across renders, unique per instance, and
  // identical on the server and the client so it cannot trip a hydration
  // mismatch on an aria-controls attribute.
  const listId = `mentions-${useId()}`;

  return (
    <div className="relative flex-1">
      {open && (
        /* ABOVE the input. Every composer using this sits at the BOTTOM of its
           surface — a DM thread, a reply box — so a menu dropped downward would
           open into the keyboard on a phone and off-screen on a laptop. */
        <ul
          id={listId}
          role="listbox"
          aria-label="People"
          className="cr-overscroll-contain absolute bottom-full left-0 z-30 mb-2 max-h-56 w-full min-w-56 overflow-y-auto rounded-xl border border-ink-700 bg-ink-900/98 p-1 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.85)] backdrop-blur-xl"
        >
          {people.map((p, i) => (
            <li key={p.username}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                // pointerDown, not click: `click` fires after `blur`, and the
                // blur would have already torn the menu down.
                onPointerDown={(e) => { e.preventDefault(); choose(p); }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "tap flex min-h-12 w-full items-center gap-2.5 rounded-lg px-2 text-left transition-colors",
                  i === active ? "bg-blood-500/15 text-chalk" : "text-mist hover:bg-ink-800",
                )}
              >
                <ForumAvatar name={p.name} image={p.image} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-sm font-bold text-chalk">{p.name}</span>
                  <span className="block truncate text-xs text-fog">@{p.username}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <textarea
        {...rest}
        ref={ref}
        value={value}
        disabled={disabled}
        onChange={handleChange}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        className={className}
      />

      {loading && query !== null && (
        <Loader2 aria-hidden className="pointer-events-none absolute right-2.5 top-3 size-3.5 animate-spin text-fog" />
      )}
    </div>
  );
}
