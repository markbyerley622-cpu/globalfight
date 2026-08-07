"use client";

// ════════════════════════════════════════════════════════════════════════════
//  Composer drafts.
//
//  ── Why localStorage and not the server ───────────────────────────────────
//  A draft is not content. It is half a thought that its author has not decided
//  to publish, and syncing it to a server means an unfinished sentence about
//  somebody is stored, backed up and subpoenable before the writer chose to say
//  it. It is also the wrong reliability trade: the failure this protects
//  against is a tab closing or a route change, both of which are local.
//
//  ── Why keys are namespaced and versioned ─────────────────────────────────
//  Two composers on one screen (a reply box and an edit box on the same post)
//  must not share a slot, and a future change to what a draft CONTAINS must not
//  restore a stale shape into a new composer. The version prefix makes that a
//  one-character change rather than a migration.
// ════════════════════════════════════════════════════════════════════════════

const PREFIX = "cr.draft.v1:";

/** Drafts older than this are somebody's abandoned thought, not their work. */
const MAX_AGE_MS = 7 * 86_400_000;

interface StoredDraft {
  text: string;
  at: number;
}

const keyOf = (draftKey: string) => `${PREFIX}${draftKey}`;

/**
 * Read a saved draft.
 *
 * Returns null on anything unexpected — a quota-disabled browser, private mode,
 * a corrupted value, or a draft old enough that restoring it would be a
 * surprise rather than a convenience. A draft that cannot be read is not an
 * error worth telling anybody about.
 */
export function readDraft(draftKey: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(keyOf(draftKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft;
    if (typeof parsed?.text !== "string" || !parsed.text.trim()) return null;
    if (typeof parsed.at !== "number" || Date.now() - parsed.at > MAX_AGE_MS) {
      window.localStorage.removeItem(keyOf(draftKey));
      return null;
    }
    return parsed.text;
  } catch {
    return null;
  }
}

/** Save, or clear when the text is empty. Never throws. */
export function writeDraft(draftKey: string, text: string): void {
  if (typeof window === "undefined") return;
  try {
    if (!text.trim()) {
      window.localStorage.removeItem(keyOf(draftKey));
      return;
    }
    window.localStorage.setItem(keyOf(draftKey), JSON.stringify({ text, at: Date.now() } satisfies StoredDraft));
  } catch {
    // Quota exceeded or storage disabled. A lost draft is a small regret; a
    // thrown exception in an onChange handler breaks the whole composer.
  }
}

export function clearDraft(draftKey: string): void {
  writeDraft(draftKey, "");
}
