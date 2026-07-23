import { test } from "node:test";
import assert from "node:assert/strict";
import { pickEventArtwork } from "../event-artwork";

const base = { heroUrl: null, posterUrl: null, mainEvent: null };
const fighters = (redImage: string | null, blueImage: string | null) => ({
  red: "R", blue: "B", titleFight: false, redImage, blueImage,
});

test("hero artwork wins over everything", () => {
  const a = pickEventArtwork({ heroUrl: "/hero.jpg", posterUrl: "/p.jpg", mainEvent: fighters("/r.jpg", "/b.jpg") });
  assert.deepEqual(a, { kind: "hero", src: "/hero.jpg" });
});

test("poster is used when there is no hero", () => {
  const a = pickEventArtwork({ ...base, posterUrl: "/p.jpg", mainEvent: fighters("/r.jpg", "/b.jpg") });
  assert.deepEqual(a, { kind: "poster", src: "/p.jpg" });
});

test("both fighters compose when no event artwork", () => {
  const a = pickEventArtwork({ ...base, mainEvent: fighters("/r.jpg", "/b.jpg") });
  assert.deepEqual(a, { kind: "fighters", red: "/r.jpg", blue: "/b.jpg" });
});

test("a single fighter photo still beats the gradient", () => {
  assert.deepEqual(pickEventArtwork({ ...base, mainEvent: fighters("/r.jpg", null) }), { kind: "fighters", red: "/r.jpg", blue: null });
  assert.deepEqual(pickEventArtwork({ ...base, mainEvent: fighters(null, "/b.jpg") }), { kind: "fighters", red: null, blue: "/b.jpg" });
});

test("gradient is the LAST resort — no artwork, no fighter photos", () => {
  assert.deepEqual(pickEventArtwork(base), { kind: "gradient" });
  assert.deepEqual(pickEventArtwork({ ...base, mainEvent: fighters(null, null) }), { kind: "gradient" });
});

test("selection is deterministic (same input → same output)", () => {
  const input = { heroUrl: null, posterUrl: null, mainEvent: fighters("/r.jpg", "/b.jpg") };
  assert.deepEqual(pickEventArtwork(input), pickEventArtwork(input));
});
