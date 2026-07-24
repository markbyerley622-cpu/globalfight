import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveEventMedia } from "../media-resolver";

const base = {
  slug: "ufc-300", sport: "MMA", promotion: "UFC", posterUrl: null, heroUrl: null,
  mainEvent: null as null | { redImage: string | null; blueImage: string | null; red: string; blue: string; titleFight: boolean; redRank: null; blueRank: null },
};

test("official hero wins over everything", () => {
  const m = resolveEventMedia({ ...base, heroUrl: "/h.jpg", posterUrl: "/p.jpg" });
  assert.deepEqual(m, { kind: "image", src: "/h.jpg", source: "hero", position: "center" });
});

test("poster beats owned art, cropped from the top", () => {
  const m = resolveEventMedia({ ...base, posterUrl: "/p.jpg" });
  assert.equal(m.kind, "image");
  assert.equal((m as { source: string }).source, "poster");
  assert.equal((m as { position: string }).position, "top");
});

test("fighter faceoff when a real photo exists (before owned art)", () => {
  const m = resolveEventMedia({ ...base, mainEvent: { red: "A", blue: "B", titleFight: false, redImage: "/a.jpg", blueImage: null, redRank: null, blueRank: null } });
  assert.deepEqual(m, { kind: "faceoff", red: "/a.jpg", blue: null });
});

test("no photos, no owned art shipped → generated backdrop (the current default)", () => {
  // Owned promotion/sport image banks are empty, so every image-less card falls
  // to the generated backdrop rather than a photo. (When banks are populated,
  // "promotion"/"sport" tiers slot in ahead of this — see event-card-image.ts.)
  assert.deepEqual(resolveEventMedia({ ...base, sport: "MUAY_THAI", promotion: "ONE Championship" }), { kind: "generated" });
  assert.deepEqual(resolveEventMedia({ ...base, sport: "MMA", promotion: "UFC" }), { kind: "generated" });
  assert.deepEqual(resolveEventMedia({ ...base, sport: "SAMBO", promotion: null }), { kind: "generated" });
});
