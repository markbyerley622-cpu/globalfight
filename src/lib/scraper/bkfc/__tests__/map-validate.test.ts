// Canonical mapping (Bkfc* → Normalized*) + data-quality validation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEvent, validateFighter, validateRanking, validateArticle } from "../validate";
import { toNormalizedEvent, toNormalizedFighter, BKFC_SOURCE, BKFC_DEFAULT_ROUNDS } from "../map";
import type { BkfcEvent, BkfcFighter } from "../types";

const NOW = "2026-07-16T00:00:00.000Z";

const fighter = (over: Partial<BkfcFighter> = {}): BkfcFighter => ({
  slug: "aaron-chalmers",
  url: "https://www.bkfc.com/fighters/aaron-chalmers",
  name: "Aaron Chalmers",
  nickname: "Chalmers",
  imageUrl: "https://img/x.png",
  record: { wins: 2, losses: 1, draws: 0, noContests: 0 },
  division: "Middleweight",
  heightCm: 183,
  reachCm: 190,
  stance: null,
  nationality: null,
  socials: [],
  ...over,
});

const event = (over: Partial<BkfcEvent> = {}): BkfcEvent => ({
  slug: "bkfc-10",
  url: "https://www.bkfc.com/events/bkfc-10",
  name: "BKFC 10",
  number: 10,
  posterUrl: "https://img/poster.jpg",
  venue: "Some Arena",
  city: null,
  country: null,
  date: "2020-02-15T00:00:00.000Z",
  status: "COMPLETED",
  ticketsUrl: null,
  watchUrl: null,
  bouts: [
    {
      orderOnCard: 0, redName: "A", blueName: "B", redSlug: "a", blueSlug: "b",
      weightClass: "Heavyweight", titleFight: true, mainEvent: true, coMain: false,
      scheduledRounds: null, redResult: null, blueResult: null, winnerCorner: null,
      method: null, roundEnded: null, timeEnded: null,
    },
  ],
  ...over,
});

// ── Mapping ──────────────────────────────────────────────────────────────

test("toNormalizedFighter maps identity, record and provenance", () => {
  const n = toNormalizedFighter(fighter(), NOW);
  assert.equal(n.externalId, "aaron-chalmers");
  assert.equal(n.sport, "BARE_KNUCKLE");
  assert.equal(n.wins, 2);
  assert.equal(n.reachCm, 190);
  assert.equal(n._meta.source, BKFC_SOURCE);
  assert.equal(n._meta.externalId, "aaron-chalmers");
  assert.equal(n._meta.lastUpdated, NOW);
  assert.ok(n._meta.confidence > 0 && n._meta.confidence <= 1);
});

test("toNormalizedEvent maps meta, poster and fight stubs", () => {
  const n = toNormalizedEvent(event(), NOW);
  assert.equal(n.externalId, "bkfc-10");
  assert.equal(n.sport, "BARE_KNUCKLE");
  assert.equal(n.promotion, "BKFC");
  assert.equal(n.posterUrl, "https://img/poster.jpg");
  assert.equal(n.fights?.length, 1);
  const stub = n.fights![0];
  assert.equal(stub.redExternalId, "a");
  assert.equal(stub.titleFight, true);
  assert.equal(stub.mainEvent, true);
  assert.equal(stub.scheduledRounds, BKFC_DEFAULT_ROUNDS); // provider default, not scraped
  assert.equal(stub.result, undefined); // no static result → left for the pipeline
});

test("toNormalizedEvent supplies an epoch sentinel for a missing date", () => {
  const n = toNormalizedEvent(event({ date: null }), NOW);
  assert.equal(n.date, new Date(0).toISOString());
});

// ── Validation ─────────────────────────────────────────────────────────────

test("validateFighter rejects impossible records, flags implausible bio", () => {
  assert.equal(validateFighter(fighter()).ok, true);
  assert.equal(validateFighter(fighter({ record: { wins: 9999, losses: 0, draws: 0, noContests: 0 } })).ok, false);
  const tall = validateFighter(fighter({ heightCm: 400 }));
  assert.equal(tall.ok, true);
  assert.ok(tall.warnings.some((w) => w.includes("implausible height")));
  assert.equal(validateFighter(fighter({ name: "" })).ok, false);
});

test("validateEvent warns on missing venue and duplicate bouts", () => {
  const b = event().bouts[0];
  const res = validateEvent(event({ venue: null, bouts: [b, { ...b, orderOnCard: 1 }] }));
  assert.equal(res.ok, true);
  assert.ok(res.warnings.some((w) => w.includes("missing venue")));
  assert.ok(res.warnings.some((w) => w.includes("duplicate bout")));
});

test("validateEvent rejects an absurd date", () => {
  assert.equal(validateEvent(event({ date: "1200-01-01T00:00:00.000Z" })).ok, false);
});

test("validateRanking / validateArticle gates", () => {
  assert.equal(validateRanking({ division: "Heavyweight", rank: 1, isChampion: false, fighterName: "X", fighterSlug: null }).ok, true);
  assert.equal(validateRanking({ division: "", rank: -1, isChampion: false, fighterName: "", fighterSlug: null }).ok, false);
  assert.equal(
    validateArticle({ slug: "s", url: "u", title: "T", excerpt: null, content: "body", category: null, author: null, coverImageUrl: null, publishedAt: NOW }).ok,
    true,
  );
  assert.equal(
    validateArticle({ slug: "", url: "u", title: "", excerpt: null, content: null, category: null, author: null, coverImageUrl: null, publishedAt: null }).ok,
    false,
  );
});
