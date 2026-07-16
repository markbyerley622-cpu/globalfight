// ════════════════════════════════════════════════════════════════════════
//  Event-adapter contract.
//
//  The licensed Odds API covers Boxing + MMA. For the other disciplines
//  (Muay Thai, Kickboxing, BJJ, Bare Knuckle, Wrestling, Judo, Taekwondo,
//  Sambo) upcoming events come from adapters — each wraps ONE official,
//  publicly-published source (a governing body's / promotion's calendar feed)
//  and normalises it to AdapterEvent. Schedules are facts; we read published
//  feeds (e.g. iCalendar), we do not bypass-scrape ToS-protected pages.
// ════════════════════════════════════════════════════════════════════════

export type SportEnum =
  | "BOXING" | "MMA" | "MUAY_THAI" | "KICKBOXING" | "K1" | "BARE_KNUCKLE"
  | "BJJ" | "BJJ_NOGI" | "WRESTLING" | "JUDO" | "TAEKWONDO" | "SAMBO" | "COMBAT_SAMBO";

export interface AdapterBout {
  red: string;
  blue: string;
  weightClass?: string;
}

/** One normalised event from a source, ready to upsert into Event/Fight. */
export interface AdapterEvent {
  externalId: string;      // stable id from the source (UID); dedupes re-runs
  name: string;
  sport: SportEnum;
  promotion?: string;      // org / promotion running it
  date: string;            // ISO 8601
  venue?: string;
  city?: string;
  country?: string;
  url?: string;            // official event page
  bouts?: AdapterBout[];   // often empty in calendar feeds — the card fills later
}

export interface EventAdapter {
  key: string;             // stable identifier, e.g. "ijf-judo"
  sport: SportEnum;
  label: string;           // human name of the source
  fetch(): Promise<AdapterEvent[]>;
}
