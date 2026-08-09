import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyCard, cardStateCopy, completenessScore, promotionCoveredBySlug,
} from "@/lib/events/card-completeness";

// The point of this module is that "no bouts" is several different truths. These
// tests pin that we never tell the reader the WRONG one — specifically that we never
// blame the promotion for our own gap, and never claim to be importing a card for a
// promotion we do not cover.

const base = {
  boutCount: 0,
  status: "SCHEDULED",
  date: new Date("2026-08-20T00:00:00Z"),
  promotionSlug: "adcc",
  covered: true,
  hasProviderProvenance: false,
  now: new Date("2026-08-01T00:00:00Z"),
};

test("bouts present is COMPLETE, whatever else is true", () => {
  assert.equal(classifyCard({ ...base, boutCount: 1 }), "COMPLETE");
  assert.equal(classifyCard({ ...base, boutCount: 12, covered: false }), "COMPLETE");
});

test("cancellation wins over every other explanation", () => {
  // Telling someone we are "still importing" a cancelled card is a lie.
  assert.equal(classifyCard({ ...base, status: "CANCELLED" }), "CANCELLED");
  assert.equal(
    classifyCard({ ...base, status: "CANCELLED", hasProviderProvenance: true }),
    "CANCELLED",
  );
});

test("provider provenance on an IMMINENT event with no bouts is OUR failure", () => {
  // A source handed us this event, the event is upon us, and there is still no
  // card: that is a mapping failure on our side and the copy must not say
  // "not announced yet".
  const state = classifyCard({
    ...base,
    date: new Date("2026-08-01T12:00:00Z"), // today
    hasProviderProvenance: true,
  });
  assert.equal(state, "EXTRACTION_FAILED");
  const copy = cardStateCopy(state);
  assert.equal(copy.ourFault, true);
  assert.doesNotMatch(copy.title, /announced/i, "must not blame the promotion");
});

test("provenance on a FUTURE event does NOT make an unannounced card our fault", () => {
  // THIS TEST PREVIOUSLY ASSERTED THE OPPOSITE, and production proved it wrong.
  //
  // Discovering an event early — which the ONE announcement cron does by design —
  // gives it provenance while the promotion has still announced nothing. On
  // 2026-08-09 every upcoming ONE Friday Fights therefore read "We couldn't load
  // this card — we're on it", with onefc.com showing 0 bouts for all of them.
  // Importing an event page is not a claim that a card exists.
  const state = classifyCard({ ...base, hasProviderProvenance: true }); // 19 days away
  assert.equal(state, "CARD_NOT_RELEASED");
  const copy = cardStateCopy(state);
  assert.equal(copy.ourFault, false, "the promotion simply has not announced it");
  assert.match(copy.title, /announced/i);
});

test("the announcement window is not a cliff — provenance stays innocent far out", () => {
  for (const days of [3, 19, 60, 240]) {
    const state = classifyCard({
      ...base,
      hasProviderProvenance: true,
      date: new Date(+base.now + days * 86_400_000),
    });
    assert.equal(state, "CARD_NOT_RELEASED", `${days} days away`);
  }
});

test("an uncovered promotion says so rather than implying the card is late", () => {
  const state = classifyCard({ ...base, covered: false, promotionSlug: "some-regional-org" });
  assert.equal(state, "PROVIDER_MISSING");
  const copy = cardStateCopy(state);
  assert.match(copy.title, /isn't fully supported/i);
  assert.equal(copy.ourFault, true);
});

test("a covered event that has already started is INGESTION_PENDING", () => {
  const state = classifyCard({
    ...base,
    date: new Date("2026-07-31T00:00:00Z"), // yesterday
  });
  assert.equal(state, "INGESTION_PENDING");
  assert.equal(cardStateCopy(state).ourFault, true, "past its date and still empty is on us");
});

test("a covered event comfortably in the future is CARD_NOT_RELEASED", () => {
  const state = classifyCard(base); // 19 days away
  assert.equal(state, "CARD_NOT_RELEASED");
  const copy = cardStateCopy(state);
  assert.equal(copy.ourFault, false, "the promotion simply has not announced it");
  assert.equal(copy.offerFollow, true);
});

test("a cancelled card does not invite a follow", () => {
  // There is nothing coming, so offering to notify them is a dead promise.
  assert.equal(cardStateCopy("CANCELLED").offerFollow, false);
});

test("every non-complete state has real copy", () => {
  for (const s of ["CARD_NOT_RELEASED", "INGESTION_PENDING", "EXTRACTION_FAILED", "PROVIDER_MISSING", "CANCELLED"] as const) {
    const c = cardStateCopy(s);
    assert.ok(c.title.length > 5, s);
    assert.ok(c.body.length > 20, s);
  }
});

// ── coverage allow-list ─────────────────────────────────────────────────────

test("coverage is an allow-list, not a guess", () => {
  assert.equal(promotionCoveredBySlug("adcc"), true);
  assert.equal(promotionCoveredBySlug("bkfc"), true);
  assert.equal(promotionCoveredBySlug("one"), true);
  // Not covered at bout level — must not claim we are importing it.
  assert.equal(promotionCoveredBySlug("some-regional-org"), false);
  assert.equal(promotionCoveredBySlug(null), false);
  assert.equal(promotionCoveredBySlug(undefined), false);
  // "combat" is the neutral fallback for an unknown promotion, never a real org.
  assert.equal(promotionCoveredBySlug("combat"), false);
});

// ── completeness score ──────────────────────────────────────────────────────

test("the CARD dominates the score — a venue does not compensate for no bouts", () => {
  const noCard = completenessScore({
    boutCount: 0, hasVenue: true, hasBroadcast: true, hasPoster: true,
    hasResults: false, hasOdds: true, isPast: false,
  });
  const cardOnly = completenessScore({
    boutCount: 8, hasVenue: false, hasBroadcast: false, hasPoster: false,
    hasResults: false, hasOdds: false, isPast: false,
  });
  assert.ok(cardOnly > noCard, `card-only ${cardOnly} should beat everything-but-card ${noCard}`);
});

test("a full past event scores 100 and a placeholder scores low", () => {
  assert.equal(
    completenessScore({
      boutCount: 10, hasVenue: true, hasBroadcast: true, hasPoster: true,
      hasResults: true, hasOdds: true, isPast: true,
    }),
    100,
  );
  const placeholder = completenessScore({
    boutCount: 0, hasVenue: false, hasBroadcast: false, hasPoster: false,
    hasResults: false, hasOdds: false, isPast: false,
  });
  assert.ok(placeholder <= 15, `a placeholder should score low, got ${placeholder}`);
});

test("a FUTURE event is not penalised for having no results", () => {
  const future = completenessScore({
    boutCount: 10, hasVenue: true, hasBroadcast: true, hasPoster: true,
    hasResults: false, hasOdds: true, isPast: false,
  });
  assert.equal(future, 100, "an upcoming card is not incomplete for lacking results");
});
