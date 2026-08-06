// ════════════════════════════════════════════════════════════════════════════
//  Boxing's weight-class taxonomy. REFERENCE CONFIG, not data about anybody.
//
//  ── Why this file exists separately ──────────────────────────────────────
//  It used to live in `lib/data/rankings.ts`, alongside three hardcoded exports
//  of FAKE RANKING DATA — a pound-for-pound board, a set of division rankings
//  and a champion list, all invented, all dated `2026-05-28`, all sitting in the
//  tree ready for anything that imported them.
//
//  Nothing did, by the time this sprint looked: `usedFallback` had already been
//  pinned to `false` and every read went to Postgres. But dead fake data is not
//  harmless — it is one accidental import away from being served as fact, and it
//  makes the honest answer to "does this product ever show invented rankings?"
//  a paragraph instead of a word.
//
//  So the fake rows are deleted and the one genuine thing in that file — the
//  list of divisions boxing actually has — moved here, under a name that says
//  what it is. A division is not a claim about a person; it is the vocabulary
//  rankings are expressed in, and it belongs in config.
// ════════════════════════════════════════════════════════════════════════════

export const WEIGHT_CLASSES = [
  { name: "Heavyweight", slug: "heavyweight", limitLbs: null },
  { name: "Cruiserweight", slug: "cruiserweight", limitLbs: 200 },
  { name: "Light Heavyweight", slug: "light-heavyweight", limitLbs: 175 },
  { name: "Super Middleweight", slug: "super-middleweight", limitLbs: 168 },
  { name: "Middleweight", slug: "middleweight", limitLbs: 160 },
  { name: "Super Welterweight", slug: "super-welterweight", limitLbs: 154 },
  { name: "Welterweight", slug: "welterweight", limitLbs: 147 },
  { name: "Super Lightweight", slug: "super-lightweight", limitLbs: 140 },
  { name: "Lightweight", slug: "lightweight", limitLbs: 135 },
  { name: "Super Featherweight", slug: "super-featherweight", limitLbs: 130 },
  { name: "Featherweight", slug: "featherweight", limitLbs: 126 },
  { name: "Super Bantamweight", slug: "super-bantamweight", limitLbs: 122 },
  { name: "Bantamweight", slug: "bantamweight", limitLbs: 118 },
  { name: "Super Flyweight", slug: "super-flyweight", limitLbs: 115 },
  { name: "Flyweight", slug: "flyweight", limitLbs: 112 },
  { name: "Minimumweight", slug: "minimumweight", limitLbs: 105 },
] as const;
