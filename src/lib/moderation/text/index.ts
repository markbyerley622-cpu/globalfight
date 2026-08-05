import { RULES, buildContext, type ModerationCategory, type ModerationRule } from "./rules";

export type { ModerationCategory, ModerationRule };
export { RULES };

// ════════════════════════════════════════════════════════════════════════════
//  THE MODERATION SERVICE — one entry point for every piece of user text.
//
//  ── The rule this exists to enforce ───────────────────────────────────────
//  Swearing is fine. Slurs are not.
//
//  This audience talks like a fight crowd, and a filter that flags "he's
//  getting knocked the fuck out" is a filter that gets switched off within a
//  week. What it blocks is the small set of things that make a room unusable
//  for the people being targeted: slurs, incitement against a group, telling
//  someone to kill themselves, real-world threats, and obvious spam.
//
//  ── Where it is enforced ──────────────────────────────────────────────────
//  In the SERVICE layer (lib/forum/repo::createPost / createThread), not in a
//  route handler. Comments reach the database through those two functions from
//  five different surfaces — the forum, an event's general room, a fight's
//  community room, a battle room and the fight-module thread — and a check
//  bolted onto one API route would leave the other four open. Same reasoning as
//  the ownership rules in CLAUDE.md: enforce where every caller passes.
//
//  ── Extending it ──────────────────────────────────────────────────────────
//  `moderateText` is synchronous and pure — it is the fast local pass. The
//  async `moderateContent` wrapper is the seam for everything that comes next:
//  an AI classifier, a per-category severity that routes to a moderator queue
//  instead of a hard block, an appeals flow, or remotely-updated keywords. None
//  of those require touching a caller, because every caller already awaits this.
// ════════════════════════════════════════════════════════════════════════════

export interface ModerationBlock {
  ok: false;
  /** Which rule fired. Stable id — safe to store, count and appeal against. */
  ruleId: string;
  category: ModerationCategory;
  /** The sentence to show the author. Already user-facing; do not rewrap. */
  message: string;
}
export type ModerationResult = { ok: true } | ModerationBlock;

const PASS: ModerationResult = { ok: true };

export interface ModerateOptions {
  /**
   * Override the rule set. Used by tests and by any future per-surface policy
   * (a battle room between two consenting rivals could reasonably run a
   * narrower set than a public category).
   */
  rules?: ModerationRule[];
}

/**
 * The synchronous local pass. Returns the FIRST rule that fires.
 *
 * First-match rather than collect-all on purpose: the author needs one sentence
 * telling them what to change, not an itemised report of everything wrong with
 * their post. Rule order in RULES is therefore meaningful — hate speech is
 * listed before spam so a slur-laden link dump is reported as the slur.
 */
export function moderateText(input: string, opts: ModerateOptions = {}): ModerationResult {
  const raw = (input ?? "").trim();
  if (!raw) return PASS;

  const ctx = buildContext(raw);
  for (const rule of opts.rules ?? RULES) {
    if (rule.test(ctx)) {
      return { ok: false, ruleId: rule.id, category: rule.category, message: rule.message };
    }
  }
  return PASS;
}

/**
 * The async entry point every writer calls.
 *
 * Today it is only the local pass. It is async so that adding a network-backed
 * classifier later is a change to THIS function and nothing else — the
 * alternative is discovering that thirty call sites are synchronous on the day
 * you need one of them not to be.
 */
export async function moderateContent(input: string, opts: ModerateOptions = {}): Promise<ModerationResult> {
  return moderateText(input, opts);
}

/**
 * Throws the user-facing sentence when content is blocked.
 *
 * The forum service layer already signals refusals by throwing an `Error` whose
 * message is shown to the client (see CLAUDE.md rule 5 — these are OUR strings,
 * never a raw ORM error), so this matches the convention its callers already
 * handle rather than introducing a second failure shape.
 */
export async function assertPublishable(input: string, opts: ModerateOptions = {}): Promise<void> {
  const verdict = await moderateContent(input, opts);
  if (!verdict.ok) throw new Error(verdict.message);
}
