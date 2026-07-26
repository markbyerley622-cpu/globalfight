import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreArticleRelevance, rankCoverage, sourceAuthority, freshnessScore, groupCoverage, type CoverageContext } from "../event-format";
import { candidate } from "@/lib/entities/resolve";
import type { Article } from "@/lib/types";

// Coverage ranking decides which stories a completed event surfaces. The bug it
// fixes is concrete: a Tyson Fury card must NOT lead with Anthony Joshua stories
// just because they share a promotion. Every rule here is deterministic and
// name-based — no model, no fabrication.

const art = (over: Partial<Article> & { title: string }): Article => ({
  id: over.title, slug: over.title.toLowerCase().replace(/\s+/g, "-"),
  category: "News", featured: false, views: 0, publishedAt: "2026-07-25T00:00:00Z",
  ...over,
});

// A real card: Fury vs Wach headlines; an undercard bout too.
const EVENT_DATE = "2026-07-25T22:00:00Z";
const ctx: CoverageContext = {
  fighters: ["Tyson Fury", "Mariusz Wach", "Derek Chisora", "Joe Joyce"],
  mainFighters: ["Tyson Fury", "Mariusz Wach"],
  eventName: "Fury vs Wach",
  eventDate: EVENT_DATE,
};

test("both main fighters in the headline scores highest", () => {
  const s = scoreArticleRelevance(art({ title: "Tyson Fury knocks out Mariusz Wach in four" }), ctx);
  const oneMain = scoreArticleRelevance(art({ title: "Tyson Fury eyes Usyk next" }), ctx);
  assert.ok(s > oneMain, "both-fighters story outranks a one-fighter story");
});

test("a story naming NO fighter on the card scores zero (cross-promotion noise)", () => {
  assert.equal(scoreArticleRelevance(art({ title: "Anthony Joshua resumes training camp" }), ctx), 0);
  assert.equal(scoreArticleRelevance(art({ title: "Canelo Alvarez plots next move" }), ctx), 0);
});

test("a card fighter named only in the body still counts, but less than the headline", () => {
  const bodyOnly = scoreArticleRelevance(art({ title: "Boxing weekend preview", content: "…including Tyson Fury on Saturday." }), ctx);
  const inTitle = scoreArticleRelevance(art({ title: "Tyson Fury ready for Saturday" }), ctx);
  assert.ok(bodyOnly > 0 && bodyOnly < inTitle);
});

test("the event's own name in the headline adds relevance", () => {
  assert.ok(scoreArticleRelevance(art({ title: "Fury vs Wach: official result" }), ctx) > 0);
});

test("whole-word matching: 'Fury' matches, 'furious' does not", () => {
  assert.ok(scoreArticleRelevance(art({ title: "Fury lands the finish" }), ctx) > 0);
  assert.equal(scoreArticleRelevance(art({ title: "A furious crowd in Manchester" }), ctx), 0);
});

test("rankCoverage drops zero-relevance stories and ranks the bout first", () => {
  const pool: Article[] = [
    art({ title: "Anthony Joshua training footage" }),            // 0 → dropped
    art({ title: "Could Fury fight Usyk?" }),                     // one main
    art({ title: "Tyson Fury stops Mariusz Wach in round four" }),// both main → top
    art({ title: "Canelo news roundup" }),                        // 0 → dropped
  ];
  const ranked = rankCoverage(pool, ctx, 8);
  assert.equal(ranked[0].title, "Tyson Fury stops Mariusz Wach in round four", "the bout leads");
  assert.ok(!ranked.some((a) => /Joshua|Canelo/.test(a.title)), "cross-promotion noise is gone");
  assert.equal(ranked.length, 2);
});

test("rankCoverage dedupes near-duplicate headlines", () => {
  const pool: Article[] = [
    art({ title: "Tyson Fury beats Mariusz Wach by KO" }),
    art({ title: "Tyson Fury beats Mariusz Wach by knockout, sources say" }),
  ];
  assert.equal(rankCoverage(pool, ctx, 8).length, 1);
});

// ── Source authority ──────────────────────────────────────────────────────

test("source authority: promotions/broadcasters tier 1, press tier 2, rest tier 3", () => {
  assert.equal(sourceAuthority("https://www.dazn.com/news/fury-wach"), 1);
  assert.equal(sourceAuthority("https://www.espn.com/boxing/story"), 1);
  assert.equal(sourceAuthority("https://www.mmafighting.com/2026/report"), 2);
  assert.equal(sourceAuthority("https://someblog.wordpress.com/post"), 3);
  assert.equal(sourceAuthority(undefined), 3);
});

test("authority is a tiebreak: it never lifts an off-card story over an on-card one", () => {
  const pool: Article[] = [
    art({ title: "Anthony Joshua on DAZN", sourceUrl: "https://dazn.com/joshua" }), // tier 1 but 0 relevance → dropped
    art({ title: "Tyson Fury vs Mariusz Wach recap", sourceUrl: "https://smallblog.com/x" }), // tier 3 but on-card
  ];
  const ranked = rankCoverage(pool, ctx, 8);
  assert.equal(ranked.length, 1);
  assert.match(ranked[0].title, /Fury vs Mariusz Wach/);
});

test("among two on-card stories, the more authoritative source wins", () => {
  const pool: Article[] = [
    art({ title: "Tyson Fury beats Mariusz Wach — report", sourceUrl: "https://randomblog.net/a", publishedAt: EVENT_DATE }),
    art({ title: "Tyson Fury defeats Mariusz Wach in style", sourceUrl: "https://dazn.com/b", publishedAt: EVENT_DATE }),
  ];
  assert.match(rankCoverage(pool, ctx, 8)[0].title, /in style/, "the DAZN story ranks first");
});

// ── Freshness ─────────────────────────────────────────────────────────────

test("freshness: a post-fight report beats an equally-relevant three-week preview", () => {
  const postFight = freshnessScore("2026-07-25T23:00:00Z", EVENT_DATE); // 1h after
  const oldPreview = freshnessScore("2026-07-04T00:00:00Z", EVENT_DATE); // 3 weeks before
  assert.ok(postFight > oldPreview);
});

test("freshness decays: a recap two weeks later scores ~zero", () => {
  assert.ok(freshnessScore("2026-08-09T00:00:00Z", EVENT_DATE) <= 1);
});

test("rankCoverage dedupes the SAME story by canonical URL (query/hash ignored)", () => {
  const pool: Article[] = [
    art({ title: "Fury stops Wach", slug: "a", sourceUrl: "https://dazn.com/news/fury-wach?utm=rss" }),
    art({ title: "Fury stops Wach — different rewrite entirely", slug: "b", sourceUrl: "https://dazn.com/news/fury-wach#top" }),
  ];
  assert.equal(rankCoverage(pool, ctx, 8).length, 1, "same URL → one story");
});

// ── Grouping into post-fight sections ────────────────────────────────────────

test("groupCoverage routes post-fight stories into the right sections", () => {
  const g = groupCoverage([
    art({ title: "WATCH: Highlights of Fury vs Wach" }),
    art({ title: "Fury vs Wach — full results and recap" }),
    art({ title: "Tyson Fury post-fight interview" }),
    art({ title: "Fury calls out Anthony Joshua next" }),
  ]);
  const byKey = Object.fromEntries(g.map((x) => [x.key, x.articles.length]));
  assert.ok(byKey.highlights >= 1, "a highlights story lands in Highlights");
  assert.ok(byKey.result >= 1, "a recap lands in Official result");
  assert.ok(byKey.interview >= 1, "an interview lands in Interviews");
  assert.ok(byKey.next >= 1, "a callout lands in What's next");
});

// ── Registry-first relevance ───────────────────────────────────────────────
// With ctx.entities present, relevance is scored against each fighter's RESOLVED
// registry surface instead of the single name string on the fight row. These pin
// the accuracy the entity layer buys — and pin that it is still deterministic.

const FURY = candidate("fighter", {
  id: "f_fury", slug: "tyson-fury", name: "Tyson Fury", nickname: "The Gypsy King",
});
const WACH = candidate("fighter", { id: "f_wach", slug: "mariusz-wach", name: "Mariusz Wach" });
const CHISORA = candidate("fighter", { id: "f_chi", slug: "derek-chisora", name: "Derek Chisora" });

const registryCtx: CoverageContext = {
  ...ctx,
  entities: { fighters: [FURY, WACH, CHISORA], main: [FURY, WACH] },
};

test("a NICKNAME headline is coverage — the string path misses it entirely", () => {
  const headline = art({ title: "The Gypsy King is ready for Saturday" });
  assert.equal(
    scoreArticleRelevance(headline, ctx),
    0,
    "string-first scoring cannot know Fury is the Gypsy King",
  );
  assert.ok(
    scoreArticleRelevance(headline, registryCtx) > 0,
    "registry-first scoring resolves the nickname to the fighter",
  );
});

test("registry-first still refuses a story about a different card", () => {
  assert.equal(scoreArticleRelevance(art({ title: "Canelo Alvarez plots next move" }), registryCtx), 0);
});

test("registry-first keeps the main-event hierarchy", () => {
  const bothMain = scoreArticleRelevance(art({ title: "Tyson Fury stops Mariusz Wach" }), registryCtx);
  const undercard = scoreArticleRelevance(art({ title: "Derek Chisora wins on the undercard" }), registryCtx);
  assert.ok(bothMain > undercard);
});

test("registry-first holds word boundaries — 'furious' is not Fury", () => {
  assert.equal(scoreArticleRelevance(art({ title: "A furious finish in Manchester" }), registryCtx), 0);
});

test("rankCoverage drops the off-card story under registry-first scoring too", () => {
  const ranked = rankCoverage(
    [
      art({ title: "Anthony Joshua resumes training camp" }),
      art({ title: "The Gypsy King stops Mariusz Wach" }),
    ],
    registryCtx,
    8,
  );
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].title, "The Gypsy King stops Mariusz Wach");
});
