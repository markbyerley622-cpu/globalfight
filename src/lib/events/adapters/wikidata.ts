// ════════════════════════════════════════════════════════════════════════
//  Wikidata event adapter (CC0 / public-domain, openly queryable).
//
//  The governing bodies for the non-Boxing/MMA disciplines don't publish clean,
//  openly-accessible calendar feeds (most are bot-protected or feed-less), and
//  third-party aggregators bar redistribution. Wikidata is the compliant gap-
//  filler: its data is CC0 (public domain), its SPARQL endpoint is built for
//  programmatic queries, and it lists upcoming championships/competitions with
//  date + location. We surface those major events per sport; local promotion
//  cards still need a promotion-supplied feed (drop-in via EVENTS_ICS_*).
// ════════════════════════════════════════════════════════════════════════

import { log } from "@/lib/scraper/logger";
import type { AdapterEvent, EventAdapter, SportEnum } from "./types";

const SPARQL = "https://query.wikidata.org/sparql";
const UA = "CombatRegisterBot/2.0 (+https://combat-register.vercel.app/bot)";
const TIMEOUT_MS = 20000;
const MAX_YEARS_AHEAD = 3;

interface SparqlBinding {
  e?: { value: string };
  eLabel?: { value: string };
  date?: { value: string };
  locLabel?: { value: string };
  countryLabel?: { value: string };
}

// Event whose sport (P641) IS the QID or a subclass of it (e.g. freestyle →
// wrestling), with a point-in-time (P585) or start-time (P580) in the future.
function query(qid: string): string {
  return `SELECT ?e ?eLabel ?date ?locLabel ?countryLabel WHERE {
    ?e wdt:P641/wdt:P279* wd:${qid} .
    { ?e wdt:P585 ?date } UNION { ?e wdt:P580 ?date }
    FILTER(?date >= NOW())
    OPTIONAL { ?e wdt:P276 ?loc . ?loc rdfs:label ?locLabel . FILTER(LANG(?locLabel)="en") }
    OPTIONAL { ?e wdt:P17 ?country . ?country rdfs:label ?countryLabel . FILTER(LANG(?countryLabel)="en") }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  } ORDER BY ?date LIMIT 80`;
}

/** Build a Wikidata-backed adapter for a sport + its Wikidata QID. */
export function wikidataAdapter(opts: { sport: SportEnum; qid: string; label: string; promotion?: string }): EventAdapter {
  return {
    key: `${opts.sport.toLowerCase()}-wikidata`,
    sport: opts.sport,
    label: opts.label,
    async fetch(): Promise<AdapterEvent[]> {
      const url = `${SPARQL}?format=json&query=${encodeURIComponent(query(opts.qid))}`;
      try {
        const res = await fetch(url, {
          headers: { "user-agent": UA, accept: "application/sparql-results+json" },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) {
          log.warn({ adapter: opts.sport, status: res.status }, "events:wikidata-fetch-failed");
          return [];
        }
        const json = (await res.json()) as { results?: { bindings?: SparqlBinding[] } };
        const rows = json.results?.bindings ?? [];
        const horizon = Date.now() + MAX_YEARS_AHEAD * 365 * 864e5;
        const seen = new Set<string>();
        const out: AdapterEvent[] = [];

        for (const b of rows) {
          const qid = b.e?.value.split("/").pop() ?? "";
          const name = b.eLabel?.value?.trim();
          const iso = b.date?.value;
          // Skip rows with no English label (Wikidata returns the Q-id as label).
          if (!qid || !name || /^Q\d+$/.test(name) || !iso) continue;
          const when = new Date(iso);
          if (Number.isNaN(+when) || +when > horizon) continue;
          if (seen.has(qid)) continue; // P585/P580 UNION can duplicate
          seen.add(qid);
          out.push({
            externalId: `wd-${qid}`,
            name,
            sport: opts.sport,
            promotion: opts.promotion,
            date: when.toISOString(),
            city: b.locLabel?.value || undefined,
            country: b.countryLabel?.value || undefined,
            url: `https://www.wikidata.org/wiki/${qid}`,
          });
        }
        log.info({ adapter: opts.sport, events: out.length }, "events:wikidata-parsed");
        return out;
      } catch (err) {
        log.warn({ adapter: opts.sport, err: (err as Error).message }, "events:wikidata-error");
        return [];
      }
    },
  };
}

// Verified sport QIDs (see wbsearchentities). Kept here so the registry can wire
// every discipline out of the box.
export const SPORT_WIKIDATA_QID: Record<string, { qid: string; label: string }> = {
  MUAY_THAI: { qid: "Q120931", label: "Muay Thai (Wikidata)" },
  KICKBOXING: { qid: "Q178678", label: "Kickboxing (Wikidata)" },
  BJJ: { qid: "Q189336", label: "BJJ (Wikidata)" },
  BARE_KNUCKLE: { qid: "Q1424950", label: "Bare-knuckle (Wikidata)" },
  WRESTLING: { qid: "Q42486", label: "Wrestling (Wikidata)" },
  JUDO: { qid: "Q11420", label: "Judo (Wikidata)" },
  TAEKWONDO: { qid: "Q36389", label: "Taekwondo (Wikidata)" },
  SAMBO: { qid: "Q106500", label: "Sambo (Wikidata)" },
};
