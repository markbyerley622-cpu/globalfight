"use client";

import { useCallback, useRef } from "react";
import { MAX_ENTITIES } from "@/lib/rich-text/types";

// ════════════════════════════════════════════════════════════════════════════
//  Turning what somebody PICKED into entities on what they finally WROTE.
//
//  ── The design decision, and why it is not offset tracking ────────────────
//  The obvious approach is to record (start, end) when a pick is inserted and
//  then maintain those offsets through every subsequent edit. That means
//  diffing every keystroke, and getting it wrong is not cosmetic: a
//  one-character drift makes an entity cover "@Ale" and the "x" beside it, or
//  point at the wrong row entirely. Paste, undo, select-all-replace, autocorrect
//  and IME composition each break it in their own way, and the damage is silent
//  — the text still reads correctly.
//
//  So identity and position are separated. The picker records WHAT was chosen,
//  keyed by the text it inserted, and nothing else. Offsets are computed ONCE,
//  from the final text, at submit. There is no state to keep in sync, so there
//  is nothing to drift: however the text was edited, the entities describe what
//  is actually there.
//
//  ── Why this is kind-agnostic ─────────────────────────────────────────────
//  It was mention-only, and every field was called `username`. Fighters and
//  events insert their NAME ("@Alex Pereira") rather than a handle, so the
//  scan below had to stop assuming the inserted text was a single word from the
//  handle alphabet. It now scans for whatever string was inserted and carries
//  the KIND alongside it — so a new kind needs nothing here at all.
//
//  ── What this deliberately does not do ────────────────────────────────────
//  Text somebody TYPED by hand, without picking from the menu, produces no
//  entity. That is correct rather than a gap: the composer does not know which
//  row they meant, and guessing by name is exactly the string-matching this
//  architecture removes. Those spans stay legacy — for handles, still resolved
//  by the old parser, still highlighted, still notified — so nothing regresses.
// ════════════════════════════════════════════════════════════════════════════

/** One thing chosen from the menu. */
export interface EntityPick {
  /** The registry kind — "mention", "fighter", "event", … */
  kind: string;
  /**
   * The PUBLIC key: a handle, a slug. Never a primary key — see the entity
   * source registry for why the browser is never given one.
   */
  key: string;
  /** The text that was inserted after the "@", e.g. "alex" or "Alex Pereira". */
  insert: string;
}

/** What the client sends at submit. The server attaches the id. */
export interface DraftEntity {
  type: string;
  key: string;
  start: number;
  end: number;
}

export interface EntityPickRegistry {
  /** Called by the Composer when something is chosen from the menu. */
  record: (pick: EntityPick) => void;
  /**
   * Build draft entities for the text as it now stands.
   *
   * Called at SUBMIT. Scans for the text that was actually inserted, so a pick
   * the author deleted produces nothing and one they duplicated produces two.
   */
  build: (text: string) => DraftEntity[];
  /** Forget everything — after a successful send. */
  reset: () => void;
}

/**
 * Characters that continue a token.
 *
 * Used only to test the CHARACTER either side of a match, never to define the
 * match itself — the inserted text may contain spaces, apostrophes and dots
 * (a fighter is "Alex Pereira", an event is "UFC 322"). What matters is that
 * the "@" begins a word and the match is not merely a prefix of a longer word.
 */
const WORD_CHAR = /[a-zA-Z0-9_]/;

/**
 * Every occurrence of `@<insert>` in `text`, as [start, end) pairs.
 *
 * Hand-rolled rather than a regex: the inserted text is arbitrary user-facing
 * content and would have to be escaped to go in a pattern, and this runs on
 * every submit on every surface. The scan is linear.
 */
function findInsertion(text: string, insert: string): [number, number][] {
  const needle = `@${insert}`;
  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const out: [number, number][] = [];
  let from = 0;
  for (;;) {
    const at = lowerText.indexOf(lowerNeedle, from);
    if (at === -1) break;
    from = at + needle.length;

    // The "@" must start a word, or "bob@alex" inside an email address becomes
    // a mention of alex.
    const before = at > 0 ? text[at - 1] : "";
    if (before && WORD_CHAR.test(before)) continue;
    // The match must END here, or picking "@Alex" would also match "@Alexander".
    const after = text[from] ?? "";
    if (after && WORD_CHAR.test(after)) continue;

    out.push([at, from]);
  }
  return out;
}

export function useEntityPicks(): EntityPickRegistry {
  // A ref, not state: recording a pick must not re-render the composer
  // mid-keystroke, and nothing renders from this.
  const picked = useRef(new Map<string, EntityPick>());

  const record = useCallback((pick: EntityPick) => {
    // Keyed by kind AND inserted text. Two kinds can legitimately insert the
    // same words — a fighter named "Alex" and a person handled "alex" — and
    // collapsing them would silently drop whichever was picked second.
    picked.current.set(`${pick.kind}:${pick.insert.toLowerCase()}`, pick);
  }, []);

  const build = useCallback((text: string): DraftEntity[] => {
    const out: DraftEntity[] = [];
    for (const pick of picked.current.values()) {
      for (const [start, end] of findInsertion(text, pick.insert)) {
        out.push({ type: pick.kind, key: pick.key, start, end });
      }
    }
    // Sorted and capped here as well as in sanitizeEntities — the server does
    // not trust this, but sending a well-formed payload means the cap drops the
    // LAST picks rather than an arbitrary set after re-sorting.
    //
    // Longer spans first at the same start, so a fighter "@Alex Pereira" beats a
    // person "@Alex" that begins at the same character: the sanitiser resolves
    // overlaps by keeping the earlier one, and "earlier and longer" is the span
    // the author actually inserted.
    return out
      .sort((a, b) => (a.start - b.start) || (b.end - a.end))
      .slice(0, MAX_ENTITIES);
  }, []);

  const reset = useCallback(() => { picked.current.clear(); }, []);

  return { record, build, reset };
}
