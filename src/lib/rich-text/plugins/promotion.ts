import { registerEntity } from "../registry";

// ════════════════════════════════════════════════════════════════════════════
//  A promotion — UFC, ONE, Matchroom.
//
//  ── Why the href is a filtered list and not a profile page ────────────────
//  There is no `/promotions/<slug>` route. A promotion is not a row in the
//  database at all: it is an entry in the in-code registry (lib/promotions),
//  which is the single source of truth for org identity across ingest, artwork
//  and search. What the product DOES have is the filtered schedule, and that is
//  genuinely the useful destination — "show me UFC events" is the question
//  somebody clicking a promotion is asking.
//
//  If a promotion page ever lands, this one line changes and every promotion
//  chip already written follows it. That is the point of the registry owning
//  navigation rather than each renderer building its own URL.
// ════════════════════════════════════════════════════════════════════════════

registerEntity({
  kind: "promotion",
  label: "promotion",
  tone: "org",

  href: (e) => (e.hint?.slug ? `/events?promotion=${encodeURIComponent(e.hint.slug)}` : null),
  unavailable: "We don't have a page for this promotion yet",

  previewable: true,

  analytics: () => ({ entity: "promotion" }),
});
