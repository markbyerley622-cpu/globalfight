import { test } from "node:test";
import assert from "node:assert/strict";
import { gymVerificationState, gymCapabilities } from "@/lib/gyms/verification";

// ════════════════════════════════════════════════════════════════════════════
//  The rule these lock down: A PENDING CLAIM GRANTS NOTHING.
//
//  The tempting shortcut is to let a claimant start filling the page in while
//  review happens. That is exactly how an unverified stranger publishes to a
//  real business's page, and it is the failure this state machine exists to
//  make impossible.
// ════════════════════════════════════════════════════════════════════════════

const at = (over: Partial<Parameters<typeof gymVerificationState>[0]> = {}) =>
  gymVerificationState({ ownerId: null, verified: false, claimStatuses: [], ...over });

test("an imported listing with no claim is UNCLAIMED", () => {
  assert.equal(at(), "UNCLAIMED");
});

test("a pending claim is under review, not verified", () => {
  assert.equal(at({ claimStatuses: ["pending"] }), "CLAIM_PENDING");
});

test("info_requested is still an OPEN claim", () => {
  // Staff asked a question; they did not say no.
  assert.equal(at({ claimStatuses: ["info_requested"] }), "CLAIM_PENDING");
});

test("a rejected claim returns to unclaimed-with-history, and can be re-claimed", () => {
  assert.equal(at({ claimStatuses: ["rejected"] }), "CLAIM_REJECTED");
  // A fresh claim after a rejection outranks the old refusal.
  assert.equal(at({ claimStatuses: ["rejected", "pending"] }), "CLAIM_PENDING");
});

test("VERIFIED requires BOTH an owner and the staff flag", () => {
  assert.equal(at({ ownerId: "u1", verified: true }), "VERIFIED");
  // Either alone is a half-finished state and must not publish.
  assert.equal(at({ ownerId: "u1", verified: false }), "UNCLAIMED");
  assert.equal(at({ ownerId: null, verified: true }), "UNCLAIMED");
});

test("an owner set by import or an admin fix does NOT confer publishing rights", () => {
  // The exact hole this closes: ownerId used to be the only gate, so a row
  // whose owner was set outside the claim flow could publish unreviewed.
  const state = at({ ownerId: "u1", verified: false });
  assert.equal(state, "UNCLAIMED");
  assert.equal(gymCapabilities(state).publishPosts, false);
});

test("an APPROVED claim that never got flagged fails CLOSED", () => {
  assert.equal(at({ ownerId: "u1", claimStatuses: ["approved"] }), "CLAIM_PENDING");
  assert.equal(gymCapabilities("CLAIM_PENDING").publishPosts, false);
});

test("no state except VERIFIED can publish, edit or show a badge", () => {
  for (const s of ["UNCLAIMED", "CLAIM_PENDING", "CLAIM_REJECTED"] as const) {
    const c = gymCapabilities(s);
    assert.equal(c.publishPosts, false, s);
    assert.equal(c.publishEvents, false, s);
    assert.equal(c.editProfile, false, s);
    assert.equal(c.manageMedia, false, s);
    assert.equal(c.manageRoster, false, s);
    assert.equal(c.showBadge, false, s);
  }
});

test("VERIFIED unlocks the whole dashboard", () => {
  const c = gymCapabilities("VERIFIED");
  assert.deepEqual(c, {
    editProfile: true, manageMedia: true, publishPosts: true,
    publishEvents: true, manageRoster: true, showBadge: true,
  });
});

test("claim status casing from the database cannot change the answer", () => {
  assert.equal(at({ claimStatuses: ["PENDING"] }), "CLAIM_PENDING");
  assert.equal(at({ claimStatuses: ["Rejected"] }), "CLAIM_REJECTED");
});
