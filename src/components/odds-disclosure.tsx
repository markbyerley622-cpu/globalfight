import Link from "next/link";

// ════════════════════════════════════════════════════════════════════════════
//  The obligation that comes attached to bookmaker data.
//
//  src/lib/ingestion-registry.ts records the terms under which The Odds API data
//  may be used, and they are not optional:
//
//    attribution: "Odds data by The Odds API. 18+ / responsible-gambling messaging
//                  required wherever the data is displayed."
//    enabled: false — "INGESTED BUT NOT DISPLAYED. … stays disabled until the
//                  18+/RG messaging obligation is implemented on every surface
//                  that would show it."
//
//  The audit found that surfaces WERE displaying it — "Market implied probability
//  · 11 books" on the live event page — with neither the attribution nor the 18+
//  notice anywhere on the page. The registry's own condition for enabling the
//  source had been bypassed in practice.
//
//  So this exists as ONE component rather than a line of copy repeated per
//  surface: an obligation that has to hold on EVERY surface cannot be re-typed by
//  whoever adds the next one. Anywhere odds are rendered, this goes with them.
// ════════════════════════════════════════════════════════════════════════════

export function OddsDisclosure({ className }: { className?: string }) {
  return (
    <p className={className ?? "mt-1.5 text-[0.6rem] leading-snug text-fog"}>
      <span className="font-semibold text-mist">18+</span>
      {" · Odds data by The Odds API. Shown for information only — GlobalFight does not "}
      {"accept bets or facilitate gambling. "}
      <Link
        href="/responsible-gambling"
        className="underline underline-offset-2 transition-colors hover:text-mist"
      >
        Gamble responsibly
      </Link>
      .
    </p>
  );
}
