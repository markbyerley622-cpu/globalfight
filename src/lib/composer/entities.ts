"use client";

import { useCallback, useRef } from "react";
import { MAX_ENTITIES } from "@/lib/rich-text/types";

// ════════════════════════════════════════════════════════════════════════════
//  Turning what somebody PICKED into entities on what they finally WROTE.
//
//  ── The design decision, and why it is not offset tracking ────────────────
//  The obvious approach is to record (start, end) when a mention is inserted
//  and then maintain those offsets through every subsequent edit. That means
//  diffing every keystroke, and getting it wrong is not cosmetic: a
//  one-character drift makes an entity cover "@ale" and the "x" beside it, or
//  point at the wrong person entirely. Paste, undo, select-all-replace,
//  autocorrect and IME composition each break it in their own way, and the
//  damage is silent — the text still reads correctly.
//
//  So identity and position are separated. The picker records WHO was chosen,
//  keyed by handle, and nothing else. Offsets are computed ONCE, from the final
//  text, at submit. There is no state to keep in sync, so there is nothing to
//  drift: however the text was edited, the entities describe what is actually
//  there.
//
//  ── What this deliberately does not do ────────────────────────────────────
//  A handle somebody TYPED by hand, without picking from the menu, produces no
//  entity. That is correct rather than a gap: the composer does not know which
//  account they meant, and guessing by handle is exactly the string-matching
//  this architecture removes. Those spans stay legacy — resolved by the old
//  parser, still highlighted, still notified — so nothing regresses.
// ════════════════════════════════════════════════════════════════════════════

export interface PickedPerson {
  username: string;
  name: string;
}

/**
 * What the CLIENT sends: a span plus the handle that was picked.
 *
 * Deliberately NOT a user id. /api/users/search withholds primary keys on
 * purpose — a typeahead open to any signed-in user is the last surface that
 * should hand them out — and that decision is worth more than the convenience
 * of resolving on the client.
 *
 * The id is attached ONCE, server-side, by resolveDraftEntities. Everything
 * stored and everything downstream is id-based from that point on, which is
 * what makes a rename harmless. The handle here is only how the server knows
 * which account was picked.
 */
export interface DraftEntity {
  type: "mention";
  username: string;
  start: number;
  end: number;
}

export interface MentionRegistry {
  /** Called by the Composer when a person is chosen from the menu. */
  record: (person: PickedPerson) => void;
  /**
   * Build draft entities for the text as it now stands.
   *
   * Called at SUBMIT. Scans for the handles that were actually picked, so a
   * mention the author deleted produces nothing and one they duplicated
   * produces two.
   */
  build: (text: string) => DraftEntity[];
  /** Forget everything — after a successful send. */
  reset: () => void;
}

/** Usernames are [a-zA-Z0-9_] — the signup validator's alphabet. */
const HANDLE_BOUNDARY = /[a-zA-Z0-9_]/;

/**
 * Every occurrence of `@handle` in `text`, as [start, end) pairs.
 *
 * Hand-rolled rather than a regex with lookbehind: Safari only gained
 * lookbehind recently and this runs on every submit on every surface. The scan
 * is linear and the rules are the ones lib/mentions already encodes — the "@"
 * must begin a word, and the handle ends at the first character outside the
 * alphabet.
 */
function findHandle(text: string, handle: string): [number, number][] {
  const needle = `@${handle}`;
  const out: [number, number][] = [];
  let from = 0;
  for (;;) {
    const at = text.toLowerCase().indexOf(needle.toLowerCase(), from);
    if (at === -1) break;
    from = at + needle.length;

    // The "@" must start a word, or "bob@alex" inside an email address becomes
    // a mention of alex.
    const before = at > 0 ? text[at - 1] : "";
    if (before && HANDLE_BOUNDARY.test(before)) continue;
    // The handle must END here, or picking "@al" would also match "@alex".
    const after = text[from] ?? "";
    if (after && HANDLE_BOUNDARY.test(after)) continue;

    out.push([at, from]);
  }
  return out;
}

export function useMentionRegistry(): MentionRegistry {
  // A ref, not state: recording a pick must not re-render the composer
  // mid-keystroke, and nothing renders from this.
  const picked = useRef(new Map<string, PickedPerson>());

  const record = useCallback((person: PickedPerson) => {
    picked.current.set(person.username.toLowerCase(), person);
  }, []);

  const build = useCallback((text: string): DraftEntity[] => {
    const out: DraftEntity[] = [];
    for (const person of picked.current.values()) {
      for (const [start, end] of findHandle(text, person.username)) {
        out.push({ type: "mention", username: person.username, start, end });
      }
    }
    // Sorted and capped here as well as in sanitizeEntities — the server does
    // not trust this, but sending a well-formed payload means the cap drops the
    // LAST mentions rather than an arbitrary set after re-sorting.
    return out.sort((a, b) => a.start - b.start).slice(0, MAX_ENTITIES);
  }, []);

  const reset = useCallback(() => { picked.current.clear(); }, []);

  return { record, build, reset };
}
