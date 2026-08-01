// ════════════════════════════════════════════════════════════════════════════
//  Search identity ≠ event identity.
//
//  PURE. No prisma, no network.
//
//  A synthetic card ("Boxing — 26 Jul 2026", promotion "Various") is an INTERNAL
//  CONTAINER. The odds pipeline invents one per sport per day to keep the schedule
//  tidy; no external source has ever heard of it. Wikipedia indexes the BOUT.
//
//  The old code used one field for both jobs — it searched Wikipedia for the string
//  it also used to identify the event in our database — so every synthetic card
//  searched for a name that cannot exist upstream and matched nothing. 1,754 bouts
//  sat unresolved behind that single conflation.
//
//  So the two responsibilities are now separate types:
//
//    eventIdentity  — how WE find the event row. Never sent to a source.
//    searchIdentity — an ORDERED ladder of queries to try upstream.
//
//  The ladder is tried in order and stops at the first VERIFIED match. Ordering is
//  by likelihood, not by classification, so a mis-guessed "is this synthetic?" only
//  ever costs one wasted request — it can never make an event unresolvable.
// ════════════════════════════════════════════════════════════════════════════

import type { ResolvedEntity } from "@/lib/entities/resolve";

export type SearchStrategyKind =
  /** The event's own title — right for a real promotion card ("BKFC 91"). */
  | "event_title"
  /** "Red vs Blue" — how Wikipedia titles a standalone fight article. */
  | "main_bout"
  /** "{Promotion} Red vs Blue" — the promotion as a disambiguating search term. */
  | "promotion_bout"
  /** Promotion + event, for a card whose bare number is ambiguous. */
  | "promotion_event"
  /** Both fighters' names with no separator — a looser sweep. */
  | "fighter_names"
  /** A registry ALIAS or nickname for either corner (Entity Resolution). */
  | "alias_bout"
  /** A fighter's OWN page — its career-record table carries bouts that have no article. */
  | "fighter_bio";

export interface SearchStrategy {
  kind: SearchStrategyKind;
  /** The literal query string sent upstream. */
  query: string;
}

/**
 * A synthetic daily card produced by the odds pipeline:
 *   `${sport} — ${DD Mon YYYY}`  e.g. "Boxing — 26 Jul 2026", "MMA — 25 Jul 2026"
 *
 * Matched with both an em dash and a hyphen because the separator is a formatting
 * detail, not a contract. Used ONLY to skip a query that cannot succeed — never to
 * decide whether an event is resolvable.
 */
export function isSyntheticEventName(name: string): boolean {
  return /^.+\s+[—-]\s+\d{1,2}\s+[A-Za-z]{3,}\s+\d{4}$/.test(name.trim());
}

/**
 * Broadcast/distribution suffixes a promotion appends to its own card name. The
 * platform is a marketing fact about how the card was carried, never part of how
 * an encyclopedia titles the article: Wikipedia has "ONE Fight Night 45", not
 * "ONE Fight Night 45: Lessei vs. Rabah on Prime Video".
 */
const BROADCAST_SUFFIX =
  /\s+(?:live\s+)?on\s+(?:amazon\s+)?prime\s+video$|\s+on\s+(?:tnt\s+sports|espn\+?|dazn|max)$|\s*[-–—]?\s*presented\s+by\s+.+$/i;

/** A trailing distribution note: "ONE Friday Fights 138 (YouTube / Watch ONE)". */
const BROADCAST_PAREN = /\s*\((?:[^()]*(?:youtube|prime video|watch one|dazn|espn|tnt)[^()]*)\)\s*$/i;

/**
 * A co-branded double card: "ONE Friday Fights 164 & The Inner Circle 24" is two
 * events sharing one night. Both sides are real, but only the numbered card is
 * written up, so the compound name matches nothing on either side.
 *
 * Separator is `&` in our rows and `/` upstream — the same fact, punctuated two
 * ways. Split only when the LEFT side still carries a digit, so a promotion whose
 * name merely contains an ampersand is never truncated to a different event.
 */
const CO_BRAND = /^(.*?\d.*?)\s+[&/]\s+\S.*$/;

/**
 * The event title reduced to its stable core — the numbered card, with billing
 * and distribution stripped — or null when the name is already in that form.
 *
 * NOT a search query. Probed 2026-08-02: reducing the title changes nothing about
 * what upstream returns for ONE. This exists so the YEAR-PAGE SPLITTER can match a
 * section heading against our stored event name when the two punctuate the same
 * card differently ("… & The Inner Circle 23" here, "… / The Inner Circle 23"
 * there). Comparison only — never written back as an event's name.
 */
export function coreEventTitle(name: string): string | null {
  const original = name.trim();
  let out = original.replace(BROADCAST_PAREN, "").replace(BROADCAST_SUFFIX, "").trim();
  const branded = CO_BRAND.exec(out);
  if (branded) out = branded[1].trim();
  out = out.replace(/[\s:–—/-]+$/, "").trim();
  if (out.length < 5) return null;
  return out === original ? null : out;
}

export interface LadderInput {
  eventName: string;
  /** The CANONICAL promotion name, or null when the event is unattributed. */
  promotionName: string | null;
  /** The unresolved bouts on this card, resolved to registry entities. */
  bouts: { red: ResolvedEntity; blue: ResolvedEntity }[];
}

/** How many bouts on a card contribute queries — the headline is what gets indexed. */
const MAX_BOUTS_QUERIED = 3;
/** Alias queries are the long tail; one per card is enough to be worth the request. */
const MAX_ALIAS_QUERIES = 2;

/**
 * The ordered, deterministic search ladder for one event.
 *
 * Deduped by query string, so a real event whose name already contains its
 * promotion doesn't ask the same question twice.
 */
export function buildSearchLadder(input: LadderInput): SearchStrategy[] {
  const out: SearchStrategy[] = [];
  const seen = new Set<string>();
  const add = (kind: SearchStrategyKind, query: string) => {
    const q = query.trim().replace(/\s+/g, " ");
    if (q.length < 5) return;
    const key = q.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, query: q });
  };

  const name = input.eventName.trim();

  // 1 — the event's own title. Skipped for a synthetic container: no upstream
  // source indexes "Boxing — 26 Jul 2026", so asking is a guaranteed miss and,
  // across 1,754 bouts, a meaningful amount of someone else's rate limit.
  if (name && !isSyntheticEventName(name)) add("event_title", name);

  // NOT a rung: the title with co-branding/broadcast suffix stripped. Probed
  // 2026-08-02 — "ONE Friday Fights 164 & The Inner Circle 24", the bare
  // "ONE Friday Fights 164", and both Prime Video forms ALL return the same
  // upstream hit, "2026 in ONE Championship". The title was never what blocked
  // these cards; upstream has no per-card article for ONE at all. Adding the rung
  // would spend a request per event against someone else's rate limit to ask a
  // question already answered. coreEventTitle stays — the year-page splitter
  // needs it to match a section back to our event row — but the ladder does not.

  // 2 — the bout itself. THE fix for synthetic cards, and a strong second try for a
  // real one (Wikipedia often has a standalone article for a marquee fight).
  const bouts = input.bouts.slice(0, MAX_BOUTS_QUERIED);
  for (const b of bouts) add("main_bout", `${b.red.name} vs ${b.blue.name}`);

  // 2b — promotion + bout. "UFC Fight Night Ankalaev vs Guskov" and "BKFC 91 Hunt vs
  // Pugliesi" are how these articles are actually titled, and the promotion word is
  // what separates a UFC card from a boxing bout between similarly-named fighters.
  if (input.promotionName) {
    for (const b of bouts) add("promotion_bout", `${input.promotionName} ${b.red.name} vs ${b.blue.name}`);
  }

  // 3 — promotion + event, for a card whose own name is a bare number ("91").
  // Skipped when the name already carries the promotion, or the query is the
  // literal "UFC UFC: Topuria vs Tsarukyan" — a wasted request against someone
  // else's rate limit, multiplied by every event in a historical repair.
  if (input.promotionName && name && !isSyntheticEventName(name)) {
    const promo = input.promotionName.toLowerCase();
    if (!name.toLowerCase().includes(promo)) add("promotion_event", `${input.promotionName} ${name}`);
  }

  // 3b — the fighters' own pages. Most bouts never get an article, but both corners
  // almost always have a biography, and a boxing/MMA bio carries the complete career
  // record — including the row for this bout, with its date. For the long tail this
  // is the ONLY source that exists.
  for (const b of bouts) {
    add("fighter_bio", b.red.name);
    add("fighter_bio", b.blue.name);
  }

  // 4 — both names, no separator. Catches an article titled some other way
  // ("Spence–Tszyu", a card page, a results round-up).
  for (const b of bouts) add("fighter_names", `${b.red.name} ${b.blue.name}`);

  // 5 — registry ALIASES and nicknames (Entity Resolution). A fighter indexed
  // upstream under a different spelling or their ring name is reachable here and
  // nowhere else. Strong forms only: an acronym query ("AJ vs Prenga") is noise.
  let aliasQueries = 0;
  for (const b of bouts) {
    if (aliasQueries >= MAX_ALIAS_QUERIES) break;
    for (const [self, other] of [
      [b.red, b.blue],
      [b.blue, b.red],
    ] as const) {
      const alt = alternateNameFor(self);
      if (!alt) continue;
      add("alias_bout", `${alt} vs ${other.name}`);
      aliasQueries += 1;
      break;
    }
  }

  return out;
}

/**
 * A human-readable alternate name for this fighter, or null.
 *
 * Registry aliases are recorded from whatever an upstream source supplied, so some
 * are SLUGS ("magomed-ankalaev"). A slug is a fine matching key and a useless search
 * query — no encyclopedia indexes a hyphenated identifier. So a slug-shaped alias is
 * de-slugified, and anything that then just restates the canonical name is dropped
 * rather than spent as a duplicate request.
 */
function alternateNameFor(entity: ResolvedEntity): string | null {
  const canonical = entity.keys.canonical;
  for (const form of entity.forms) {
    if (form.tier !== "strong") continue;
    if (form.origin !== "alias" && form.origin !== "nickname") continue;
    const readable = form.form.includes(" ") ? form.form : form.form.replace(/-+/g, " ").trim();
    if (!readable.includes(" ")) continue; // a single token is not a findable name
    if (readable === canonical) continue; // a slug of the same name — no new information
    return readable;
  }
  return null;
}
