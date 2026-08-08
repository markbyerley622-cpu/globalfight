// ════════════════════════════════════════════════════════════════════════
//  What each ingestion source is LIKE — specifically, whether revisiting an
//  event after it happened can ever tell us anything new.
//
//  This exists because "re-check every past event with an undecided bout" is
//  only correct for sources whose pages keep changing. A promotion's event page
//  gains results in the hours after the bell; a Wikipedia tournament bracket is
//  finished the moment it is imported. Re-reading the second kind, hourly,
//  forever, is guaranteed-fruitless traffic against someone else's server.
//
//  It is a CAPABILITY rather than a hard-coded exclusion list so that the next
//  static importer is excluded by declaring what it is, not by someone
//  remembering to add its name to a query in another file.
// ════════════════════════════════════════════════════════════════════════

export interface SourcePolicy {
  /** Matches EventExternalId.source / FightImport.source. */
  source: string;
  label: string;
  /**
   * Can a later visit to this source add a result we did not already have?
   *
   * TRUE  — a live promotion/feed. Its page is updated after the event, so the
   *         results cron should keep coming back until the card is complete.
   * FALSE — a one-shot import of an already-finished record. Whatever it was
   *         going to say, it said at import time. Coming back learns nothing.
   */
  supportsLiveResultUpdates: boolean;
  note: string;
}

export const SOURCE_POLICIES: SourcePolicy[] = [
  // ── Live: worth revisiting until the card is complete ────────────────────
  {
    source: "wikipedia",
    label: "Wikipedia event articles (wikicard)",
    supportsLiveResultUpdates: true,
    note: "An article is edited in the hours and days after a card — usually the only place " +
      "BKFC/ONE bout winners ever appear. Revisiting is the whole point of the results cron.",
  },
  {
    source: "bkfc",
    label: "BKFC (bkfc.com + official scored feed)",
    supportsLiveResultUpdates: true,
    note: "Event pages gain detail after the card. Winners are client-side in the HTML, but the page " +
      "declares its official scored feed in an inline script — the provider reads that, so a card " +
      "re-visited after the bell now gains real results rather than only detail.",
  },
  {
    source: "one",
    label: "ONE Championship (onefc.com)",
    supportsLiveResultUpdates: true,
    note: "Schedule pages update; results are rendered client-side and not scraped.",
  },
  {
    source: "wikipedia-index",
    label: "Wikipedia promotion event index (Misfits Boxing)",
    supportsLiveResultUpdates: true,
    note: "Both the index and each card's article are edited after the event — a card " +
      "listed as upcoming gains its results table days later. Revisitable, unlike the " +
      "tournament brackets, which are complete at import.",
  },
  {
    source: "adcc",
    label: "ADCC (adcombat.com)",
    supportsLiveResultUpdates: true,
    note: "WordPress event listing, edited over time.",
  },
  {
    // Literal, not the provider's exported constant: this table is imported by
    // the results queue, and pulling provider modules into it would be the first
    // link of an import cycle. The keys are covered by a test instead.
    source: "espn",
    label: "ESPN MMA (site.api.espn.com)",
    supportsLiveResultUpdates: true,
    note: "Scoreboard JSON flips each bout to STATUS_FINAL with a winner as the card unfolds. " +
      "The most valuable source to revisit, because it settles same-night.",
  },
  {
    source: "the-odds-api",
    label: "The Odds API",
    supportsLiveResultUpdates: true,
    note: "Lines move continuously before the card.",
  },

  // ── Static: imported once, immutable thereafter ──────────────────────────
  {
    source: "wikipedia-tournament",
    label: "Wikipedia tournament brackets",
    supportsLiveResultUpdates: false,
    note: "A completed elimination bracket is a finished record — it is imported whole, " +
      "results included, in one pass. It is also structurally unreadable to the wikicard " +
      "extractor (a bracket has no 'A def. B' results table), so every revisit returns " +
      "no_card. ~30 events were doing exactly that, hourly, before this flag existed. " +
      "A bout the bracket left undecided (walkover, withdrawal) is undecided upstream too.",
  },
];

const BY_SOURCE = new Map(SOURCE_POLICIES.map((p) => [p.source, p]));

export const policyFor = (source: string): SourcePolicy | undefined => BY_SOURCE.get(source);

/**
 * Unknown sources default to TRUE — fail OPEN.
 *
 * The cost of the two mistakes is not symmetric. Treating a live source as
 * static means a real result never lands and a card says "Result pending"
 * forever, silently. Treating a static source as live means some wasted
 * requests, visibly, in the run report. So an unregistered source keeps getting
 * chased, and a static importer must say so.
 */
export function supportsLiveResultUpdates(source: string): boolean {
  return BY_SOURCE.get(source)?.supportsLiveResultUpdates ?? true;
}

/** Sources whose events must never be re-queued for result harvesting. */
export const STATIC_IMPORT_SOURCES: string[] = SOURCE_POLICIES.filter(
  (p) => !p.supportsLiveResultUpdates,
).map((p) => p.source);
