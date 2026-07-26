import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreArticleRelevance, rankCoverage, type CoverageContext } from "../event-format";
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
const ctx: CoverageContext = {
  fighters: ["Tyson Fury", "Mariusz Wach", "Derek Chisora", "Joe Joyce"],
  mainFighters: ["Tyson Fury", "Mariusz Wach"],
  eventName: "Fury vs Wach",
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
