// Types for the Wikipedia fight-card provider.
import type { NormalizedEvent } from "@/services/providers/types";
import type { Sport } from "@/lib/types";

/** An event we want a card for (driven from our own DB rows). */
export interface WikiTarget {
  name: string;
  /** ISO date — passed straight through so persist resolves the same event. */
  date: string;
  sport: Sport;
}

export interface WikiHarvestReport {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  targets: number;
  /** Targets with a plausible Wikipedia page. */
  matched: number;
  /** Targets whose page actually yielded a card. */
  withCard: number;
  bouts: number;
  warnings: string[];
}

export interface WikiHarvest {
  report: WikiHarvestReport;
  events: NormalizedEvent[];
}
