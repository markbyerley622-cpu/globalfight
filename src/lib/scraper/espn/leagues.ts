// ════════════════════════════════════════════════════════════════════════
//  Which ESPN MMA leagues we read, and what each one is to us.
//
//  ESPN exposes 48 league slugs under /sports/mma. Most are defunct regional
//  promotions with a handful of cards; these are the ones worth the requests.
//
//  The slug is NOT guessable from the promotion's name — ONE Championship is
//  `ofc` ("One Fighting Championship", their pre-2015 name), and `one` returns
//  HTTP 400. That single fact is most of why this file exists.
// ════════════════════════════════════════════════════════════════════════

import type { Sport } from "@/lib/types";

export interface EspnLeague {
  /** ESPN's league slug — the path segment in the scoreboard URL. */
  slug: string;
  /** CLI key and report label. */
  key: string;
  /** Stored as Event.promotion; must match the promotions registry where possible. */
  promotion: string;
  sport: Sport;
  note?: string;
}

export const ESPN_LEAGUES: EspnLeague[] = [
  { slug: "ufc", key: "ufc", promotion: "UFC", sport: "MMA" },
  { slug: "pfl", key: "pfl", promotion: "PFL", sport: "MMA" },
  { slug: "bellator", key: "bellator", promotion: "Bellator", sport: "MMA" },
  {
    slug: "ofc",
    key: "one",
    promotion: "ONE Championship",
    sport: "MMA",
    note: "ESPN files ONE under its former name, One Fighting Championship. The slug " +
      "`one` is a 400. ESPN carries ONE's MMA bouts; their Muay Thai/kickboxing cards " +
      "come from the onefc.com provider instead.",
  },
  { slug: "rizin", key: "rizin", promotion: "RIZIN", sport: "MMA" },
  { slug: "ksw", key: "ksw", promotion: "KSW", sport: "MMA" },
  { slug: "cage-warriors", key: "cage-warriors", promotion: "Cage Warriors", sport: "MMA" },
  { slug: "ifc", key: "invicta", promotion: "Invicta FC", sport: "MMA" },
  { slug: "lfa", key: "lfa", promotion: "LFA", sport: "MMA" },
  {
    slug: "k1",
    key: "k1",
    promotion: "K-1",
    sport: "K1",
    note: "Kickboxing rules, so it lands in the K1 sport rather than MMA.",
  },
  // Defunct, but their history is real and fans care about it.
  { slug: "strikeforce", key: "strikeforce", promotion: "Strikeforce", sport: "MMA" },
  { slug: "pride", key: "pride", promotion: "PRIDE", sport: "MMA" },
  { slug: "wec", key: "wec", promotion: "WEC", sport: "MMA" },
];

/**
 * The default backfill set.
 *
 * `k1` is in it so KICKBOXING is actually ingested rather than sitting wired-but-
 * unused. Note the limit that comes with it: ESPN's bout payload carries only a
 * weight class, never a ruleset, so a ONE card's kickboxing and Muay Thai bouts
 * are indistinguishable from its MMA bouts here and the whole `ofc` card is filed
 * as MMA. ONE's kickboxing/Muay Thai events reach us with the right sport from the
 * onefc.com provider instead, which maps the "Friday Fights" series per event.
 * GLORY has no ESPN league at all (verified: HTTP 400 on every slug tried).
 */
export const DEFAULT_LEAGUE_KEYS = ["ufc", "pfl", "bellator", "one", "rizin", "k1"];

export const leagueFor = (key: string): EspnLeague | undefined =>
  ESPN_LEAGUES.find((l) => l.key === key.toLowerCase() || l.slug === key.toLowerCase());
