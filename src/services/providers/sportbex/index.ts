// Sportbex — sportbex.com
// MMA (UFC, Bellator, ONE, PFL) + Boxing. Results, profiles, schedules, odds.
// Set SPORTBEX_API_KEY to activate.
import { BaseProvider } from "../base";
import type { Sport } from "@/lib/types";

export class SportbexProvider extends BaseProvider {
  readonly key = "sportbex";
  readonly label = "Sportbex";
  readonly sports: readonly Sport[] = ["MMA", "BOXING", "KICKBOXING", "MUAY_THAI"];
  protected readonly envKeys = ["SPORTBEX_API_KEY"] as const;
}
