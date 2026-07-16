// ════════════════════════════════════════════════════════════════════════
//  Event-adapter registry.
//
//  Adapters are configured by env so an official calendar feed can be connected
//  without a code change (and none are hardcoded/guessed). For each discipline:
//
//     EVENTS_ICS_JUDO="https://…/calendar.ics|IJF World Judo Tour|IJF"
//                       ^ feed URL              ^ source label     ^ promotion
//
//  Only the URL is required; label/promotion are optional. Sports left unset
//  simply have no adapter (the UI shows the honest empty state) until a feed is
//  confirmed. This keeps us to published feeds we can point at.
// ════════════════════════════════════════════════════════════════════════

import { icsAdapter } from "./adapters/ics";
import { wikidataAdapter, SPORT_WIKIDATA_QID } from "./adapters/wikidata";
import type { EventAdapter, SportEnum } from "./adapters/types";

// Disciplines not covered by the licensed Odds API (Boxing/MMA), keyed to the
// env var that supplies their calendar feed.
const ICS_SPORTS: { sport: SportEnum; env: string; defaultLabel: string }[] = [
  { sport: "MUAY_THAI", env: "EVENTS_ICS_MUAY_THAI", defaultLabel: "Muay Thai calendar" },
  { sport: "KICKBOXING", env: "EVENTS_ICS_KICKBOXING", defaultLabel: "Kickboxing calendar" },
  { sport: "BJJ", env: "EVENTS_ICS_BJJ", defaultLabel: "BJJ calendar" },
  { sport: "BARE_KNUCKLE", env: "EVENTS_ICS_BARE_KNUCKLE", defaultLabel: "Bare-knuckle calendar" },
  { sport: "WRESTLING", env: "EVENTS_ICS_WRESTLING", defaultLabel: "Wrestling calendar" },
  { sport: "JUDO", env: "EVENTS_ICS_JUDO", defaultLabel: "Judo calendar" },
  { sport: "TAEKWONDO", env: "EVENTS_ICS_TAEKWONDO", defaultLabel: "Taekwondo calendar" },
  { sport: "SAMBO", env: "EVENTS_ICS_SAMBO", defaultLabel: "Sambo calendar" },
];

export function getEventAdapters(env: NodeJS.ProcessEnv = process.env): EventAdapter[] {
  const adapters: EventAdapter[] = [];
  for (const { sport, env: key, defaultLabel } of ICS_SPORTS) {
    const raw = env[key]?.trim();
    if (raw) {
      // A confirmed official/promotion .ics feed wins — richest, most complete.
      const [url, label, promotion] = raw.split("|").map((s) => s.trim());
      if (/^https?:\/\//i.test(url)) {
        adapters.push(
          icsAdapter({ key: `${sport.toLowerCase()}-ics`, sport, label: label || defaultLabel, url, promotion: promotion || label || undefined }),
        );
        continue;
      }
    }
    // Default: Wikidata (CC0) so every discipline populates its major events out
    // of the box, until a promotion-specific feed is supplied. Disable with
    // EVENTS_WIKIDATA="off".
    if (env.EVENTS_WIKIDATA !== "off" && SPORT_WIKIDATA_QID[sport]) {
      const { qid, label } = SPORT_WIKIDATA_QID[sport];
      adapters.push(wikidataAdapter({ sport, qid, label }));
    }
  }
  return adapters;
}

/** Which disciplines currently have a feed connected (for status/reporting). */
export function connectedEventSports(env: NodeJS.ProcessEnv = process.env): SportEnum[] {
  return getEventAdapters(env).map((a) => a.sport);
}
