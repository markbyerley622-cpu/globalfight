import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  promoterState,
  promoterCapabilities,
  assertPromoterCan,
  type PromoterStateInput,
} from "@/lib/promoter/verification";

const input = (over: Partial<PromoterStateInput> = {}): PromoterStateInput => ({
  verified: false,
  ownerId: null,
  suspendedAt: null,
  claimStatuses: [],
  ...over,
});

describe("promoterState", () => {
  test("nobody is a promoter by default", () => {
    assert.equal(promoterState(input()), "NONE");
  });

  test("an open application grants the state, not the rights", () => {
    assert.equal(promoterState(input({ claimStatuses: ["pending"] })), "CLAIM_PENDING");
    assert.equal(promoterState(input({ claimStatuses: ["info_requested"] })), "CLAIM_PENDING");
  });

  test("verified requires BOTH the flag and an owner", () => {
    // Either alone is half-finished. A flag with no owner has nobody to
    // exercise the right; an owner with no flag is the import/admin-fix case
    // that must not grant publishing silently.
    assert.equal(promoterState(input({ verified: true })), "NONE");
    assert.equal(promoterState(input({ ownerId: "u1" })), "NONE");
    assert.equal(promoterState(input({ verified: true, ownerId: "u1" })), "VERIFIED");
  });

  test("approved but not yet flagged reports as still pending", () => {
    // Fails CLOSED. The approval landed and the flag did not, and the only safe
    // direction for a publishing right is "not yet".
    assert.equal(promoterState(input({ claimStatuses: ["approved"] })), "CLAIM_PENDING");
  });

  test("a re-application outranks the old rejection", () => {
    assert.equal(promoterState(input({ claimStatuses: ["rejected", "pending"] })), "CLAIM_PENDING");
  });

  test("suspension beats a stale verified flag", () => {
    // The important precedence. If `verified` won, withdrawing the right would
    // mean remembering to clear two columns — and the failure mode of
    // forgetting one is that a suspended promoter keeps publishing.
    const state = promoterState(input({
      verified: true, ownerId: "u1", suspendedAt: new Date(),
    }));
    assert.equal(state, "SUSPENDED");
  });
});

describe("promoterCapabilities", () => {
  test("a pending application grants NOTHING", () => {
    // The tempting shortcut is to let an applicant build their card while
    // review happens. That is how an unreviewed stranger ends up one button
    // from publishing to the whole product.
    const caps = promoterCapabilities("CLAIM_PENDING");
    assert.deepEqual(Object.values(caps).filter(Boolean), []);
  });

  test("only VERIFIED may publish", () => {
    for (const s of ["NONE", "CLAIM_PENDING", "CLAIM_REJECTED", "SUSPENDED"] as const) {
      assert.equal(promoterCapabilities(s).publishEvents, false, `${s} must not publish`);
    }
    assert.equal(promoterCapabilities("VERIFIED").publishEvents, true);
  });

  test("SUSPENDED keeps result entry and loses everything else", () => {
    // Not a kindness to the promoter — a duty to the fans. Predictions on an
    // already-published card cannot settle without a result, and an unsettled
    // card leaves every pick on it permanently pending.
    const caps = promoterCapabilities("SUSPENDED");
    assert.equal(caps.recordResults, true);
    assert.equal(caps.publishEvents, false);
    assert.equal(caps.draftEvents, false);
    assert.equal(caps.buildCard, false);
    assert.equal(caps.showBadge, false);
  });

  test("only VERIFIED shows the badge", () => {
    // A badge that appears before review is decoration, not a trust signal.
    for (const s of ["NONE", "CLAIM_PENDING", "CLAIM_REJECTED", "SUSPENDED"] as const) {
      assert.equal(promoterCapabilities(s).showBadge, false);
    }
    assert.equal(promoterCapabilities("VERIFIED").showBadge, true);
  });
});

describe("assertPromoterCan", () => {
  test("allows a verified promoter", () => {
    assert.deepEqual(assertPromoterCan("VERIFIED", "publishEvents"), { allowed: true });
  });

  test("refuses with wording the caller can show", () => {
    // A bare false makes every surface invent its own message, and they will
    // each invent a different one.
    const out = assertPromoterCan("CLAIM_PENDING", "publishEvents");
    assert.equal(out.allowed, false);
    assert.ok(!out.allowed && out.reason.length > 0);
  });

  test("every state has non-empty refusal copy", () => {
    for (const s of ["NONE", "CLAIM_PENDING", "CLAIM_REJECTED", "SUSPENDED"] as const) {
      const out = assertPromoterCan(s, "publishEvents");
      assert.ok(!out.allowed && out.reason.trim().length > 10, `${s} needs real copy`);
    }
  });
});
