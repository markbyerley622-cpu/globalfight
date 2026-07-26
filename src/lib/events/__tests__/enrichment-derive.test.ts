import { test } from "node:test";
import assert from "node:assert/strict";
import {
  officialResultFrom,
  selectHeroVideo,
  enrichmentConfidence,
  coverageTerms,
  coverageTermsFor,
  videoMatchTerms,
  eventStats,
  enrichmentNavigation,
  MAX_COVERAGE_TERMS,
  MAX_VIDEO_TERMS,
} from "../enrichment-derive";
import { candidate, type EventEntities } from "@/lib/entities/resolve";
import type { Fight } from "@/lib/types";
import type { VideoRec } from "@/lib/feed/recommend";

// Everything the enrichment engine derives is read from stored data — these
// tests pin that: a decided fight yields the recorded winner, an undecided one
// yields nothing (never a guess).

const fighter = (id: string, name: string) => ({ id, slug: id, name });
const fight = (over: Partial<Fight>): Fight =>
  ({
    id: "f1",
    slug: "f1",
    red: fighter("red", "Tyson Fury"),
    blue: fighter("blue", "Mariusz Wach"),
    titleFight: false,
    mainEvent: true,
    result: "SCHEDULED",
    scheduledRounds: 12,
    ...over,
  }) as unknown as Fight;

const vid = (title: string): VideoRec => ({
  id: title,
  title,
  channel: "c",
  publishedAt: null,
  promotion: null,
  promotionName: null,
  reason: "x",
});

test("officialResultFrom reads a decided win from stored fields — no inference", () => {
  const r = officialResultFrom(
    fight({ result: "WIN", winnerId: "red", method: "KO", roundEnded: 3, timeEnded: "1:24" }),
  );
  assert.equal(r?.outcome, "win");
  assert.equal(r?.winnerName, "Tyson Fury");
  assert.equal(r?.loserName, "Mariusz Wach");
  assert.equal(r?.method, "KO");
  assert.equal(r?.round, 3);
  assert.equal(r?.time, "1:24");
});

test("officialResultFrom surfaces draw and no-contest without naming a winner", () => {
  assert.deepEqual(
    { o: officialResultFrom(fight({ result: "DRAW" }))?.outcome, w: officialResultFrom(fight({ result: "DRAW" }))?.winnerName },
    { o: "draw", w: null },
  );
  assert.equal(officialResultFrom(fight({ result: "NO_CONTEST" }))?.outcome, "no-contest");
});

test("officialResultFrom returns null when nothing is decided (no fabricated result)", () => {
  assert.equal(officialResultFrom(fight({ result: "SCHEDULED" })), null);
  assert.equal(officialResultFrom(fight({ result: "WIN" })), null); // WIN but no winnerId → undetermined
  assert.equal(officialResultFrom(undefined), null);
});

test("selectHeroVideo features the top highlight post-fight, nothing pre-fight", () => {
  const videos = [vid("Fury fight-week vlog"), vid("Fury vs Wach HIGHLIGHTS"), vid("Fury interview")];
  assert.equal(selectHeroVideo(videos, "post")?.title, "Fury vs Wach HIGHLIGHTS");
  assert.equal(selectHeroVideo(videos, "pre"), null);
  assert.equal(selectHeroVideo([vid("Fury interview")], "post"), null); // no highlight → no hero
});

test("enrichmentConfidence scores completeness; a fully-enriched card outscores a bare one", () => {
  const rich = enrichmentConfidence({
    phase: "post",
    officialResult: { winnerName: "A", loserName: "B", titleFight: true, outcome: "win" },
    heroVideo: vid("A vs B HIGHLIGHTS"),
    featuredCoverage: { id: "a" } as never,
    coverageCount: 5,
    videoCount: 3,
  });
  const bare = enrichmentConfidence({
    phase: "post",
    officialResult: null,
    heroVideo: null,
    featuredCoverage: null,
    coverageCount: 0,
    videoCount: 0,
  });
  assert.equal(rich, 100);
  assert.equal(bare, 0);
  assert.ok(rich > bare);
});

test("coverageTerms = surnames + promotion aliases + event name; 'various' excluded", () => {
  const terms = coverageTerms("bkfc", [fight({})], "BKFC 91");
  assert.ok(terms.includes("fury"));
  assert.ok(terms.includes("wach"));
  assert.ok(terms.includes("bkfc"));
  assert.ok(terms.includes("bare knuckle"), "promotion alias is expanded");
  assert.ok(terms.includes("bkfc 91"), "event name is a term");
  assert.ok(!coverageTerms("various", [fight({})], "Card").includes("various"));
});

// ── Registry-first derivations ─────────────────────────────────────────────
// The engine now derives from RESOLVED entities, not from the name string on the
// fight row. These pin that the widened surface reaches the query, that the query
// stays bounded, and that the honest pending-result count is honest.

const entity = (
  id: string,
  name: string,
  extra: { nickname?: string; aliases?: string[] } = {},
) => candidate("fighter", { id, slug: id, name, ...extra });

const entities = (over: Partial<EventEntities> = {}): EventEntities => {
  const red = entity("f_aj", "Anthony Joshua", { aliases: ["Anthony Oluwafemi Joshua"] });
  const blue = entity("f_pr", "Kristian Prenga");
  return {
    fighters: [red, blue],
    main: { red, blue },
    promotion: null,
    venue: null,
    canonicalFighterCount: 2,
    ...over,
  };
};

test("coverageTermsFor carries the MAIN EVENT's registry aliases into the query", () => {
  const terms = coverageTermsFor(entities(), "Joshua vs Prenga");
  assert.ok(terms.includes("anthony joshua"));
  assert.ok(terms.includes("joshua"), "surname is how a headline names a fighter");
  assert.ok(terms.includes("anthony oluwafemi joshua"), "registry alias reaches the query");
  assert.ok(terms.includes("joshua vs prenga"), "event name is a term");
});

test("coverageTermsFor NEVER emits a weak form — '%aj%' would scan the news table", () => {
  const terms = coverageTermsFor(entities(), "Joshua vs Prenga");
  assert.ok(!terms.includes("aj"));
  assert.ok(!terms.includes("a joshua"));
});

test("coverageTermsFor spends its budget on the main event, one form per undercard", () => {
  const main = entities();
  const undercard = Array.from({ length: 20 }, (_, i) =>
    entity(`u${i}`, `Undercard Fighter${i}`, { aliases: [`Alias ${i}`, `Other ${i}`] }),
  );
  const terms = coverageTermsFor(
    entities({ fighters: [...main.fighters, ...undercard] }),
    "Big Card",
  );
  assert.ok(terms.length <= MAX_COVERAGE_TERMS, `bounded, got ${terms.length}`);
  // The main event's alias survived the bound; an undercard fighter's did not.
  assert.ok(terms.includes("anthony oluwafemi joshua"));
  assert.ok(!terms.includes("alias 0"));
  assert.ok(terms.includes("fighter0"), "each undercard fighter is still findable");
});

test("coverageTermsFor adds a real promotion's aliases and nothing for 'Various'", () => {
  const withPromo = coverageTermsFor(
    entities({
      promotion: candidate("promotion", {
        id: "bkfc",
        slug: "bkfc",
        name: "BKFC",
        aliases: ["bkfc", "bare knuckle"],
      }),
    }),
    "BKFC 91",
  );
  assert.ok(withPromo.includes("bare knuckle"));
  // An unattributed card resolves to promotion: null — there is no org to search.
  assert.ok(!coverageTermsFor(entities(), "Card Night").some((t) => t === "various"));
});

test("videoMatchTerms is bounded and leads with the main event", () => {
  const undercard = Array.from({ length: 30 }, (_, i) => entity(`u${i}`, `Under Card${i}`));
  const terms = videoMatchTerms(entities({ fighters: [...entities().fighters, ...undercard] }));
  assert.ok(terms.length <= MAX_VIDEO_TERMS, `bounded, got ${terms.length}`);
  assert.ok(terms.includes("anthony joshua"));
});

test("eventStats counts pending bouts only AFTER the card has happened", () => {
  const card = [
    fight({ id: "a", result: "WIN", winnerId: "red" }),
    fight({ id: "b", result: "SCHEDULED" }),
    fight({ id: "c", result: "SCHEDULED", titleFight: true }),
  ];
  const post = eventStats(card, "post", { coverage: 2, videos: 1 });
  assert.equal(post.boutCount, 3);
  assert.equal(post.resolvedBoutCount, 1);
  assert.equal(post.pendingBoutCount, 2, "two bouts happened with no recorded outcome");
  assert.equal(post.titleFightCount, 1);
  assert.equal(post.coverageCount, 2);

  // Before the bell every bout is SCHEDULED because it hasn't happened — that is
  // not a pending RESULT, and calling it one would put "results aren't in yet" on
  // every upcoming card.
  assert.equal(eventStats(card, "pre", { coverage: 0, videos: 0 }).pendingBoutCount, 0);
});

test("enrichmentNavigation only offers a Coverage anchor when there is coverage", () => {
  const bare = enrichmentNavigation({ slug: "x", boutCount: 5, coverageCount: 0, videoCount: 0 });
  assert.deepEqual(bare.sections.map((s) => s.id), ["card", "card-talk"]);
  assert.equal(bare.href, "/events/x");
  assert.equal(bare.sections[0].badge, 5);

  const rich = enrichmentNavigation({ slug: "x", boutCount: 5, coverageCount: 3, videoCount: 2 });
  assert.deepEqual(rich.sections.map((s) => s.id), ["card", "card-talk", "coverage"]);
  assert.equal(rich.sections[2].badge, 5, "badge is coverage + videos");
});
