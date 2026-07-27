import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  notificationIconKey, iconTone, NOTIFICATION_ICON_KEYS,
} from "@/lib/notification-icons";

// ── resolution ──────────────────────────────────────────────────────────────

test("a semantic key resolves to itself", () => {
  assert.equal(notificationIconKey({ icon: "victory", type: "PICK_RESULT" }), "victory");
  assert.equal(notificationIconKey({ icon: "rankingUp" }), "rankingUp");
});

test("a legacy emoji from the database still renders an icon", () => {
  // Production holds months of rows written before keys existed. They must not
  // silently degrade to a generic bell.
  assert.equal(notificationIconKey({ icon: "🏆" }), "victory");
  assert.equal(notificationIconKey({ icon: "▶️" }), "video");
  assert.equal(notificationIconKey({ icon: "⭐" }), "review");
  assert.equal(notificationIconKey({ icon: "@" }), "mention");
});

test("a null or unknown icon falls back to the notification TYPE", () => {
  assert.equal(notificationIconKey({ icon: null, type: "GYM_REVIEW" }), "review");
  assert.equal(notificationIconKey({ icon: "", type: "EVENT_LIVE" }), "live");
  assert.equal(notificationIconKey({ icon: "🦄", type: "FIGHT_ANNOUNCED" }), "fight");
});

test("a row with nothing usable still resolves — the list never has holes", () => {
  assert.equal(notificationIconKey({}), "bell");
  assert.equal(notificationIconKey({ icon: null, type: "SOMETHING_NEW" }), "bell");
});

test("whitespace around a stored key is tolerated", () => {
  assert.equal(notificationIconKey({ icon: "  streak  " }), "streak");
});

// ── tone ────────────────────────────────────────────────────────────────────

test("tone is assigned, and every key has one", () => {
  assert.equal(iconTone("victory"), "positive");
  assert.equal(iconTone("cancelled"), "negative");
  assert.equal(iconTone("fight"), "neutral");
  for (const k of NOTIFICATION_ICON_KEYS) {
    assert.ok(["positive", "negative", "neutral"].includes(iconTone(k)), k);
  }
});

// ── the guarantee that matters: no producer emits an unknown key ─────────────

test("every icon a producer emits is a real key — no silent bell fallbacks", () => {
  // A typo ("victoy") would compile fine and quietly render a generic bell in
  // production, which is exactly the class of bug a key-based system introduces if
  // nothing checks it. This walks the source and asserts every literal is valid.
  const root = join(process.cwd(), "src");
  const files: string[] = [];
  (function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(entry)) files.push(p);
    }
  })(root);

  const known = new Set<string>(NOTIFICATION_ICON_KEYS);
  // Files that legitimately carry non-notification `icon:` fields.
  const EXEMPT = [
    "notification-icons.ts",     // the legacy emoji map itself
    "forum/types.ts",            // forum category icons — a different system
    "forum\\types.ts",
  ];

  const offenders: string[] = [];
  for (const file of files) {
    if (EXEMPT.some((e) => file.includes(e))) continue;
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/icon:\s*"([^"]+)"/g)) {
      const value = m[1];
      // Only judge values that LOOK like an attempt at a key. A slug or a glyph in
      // some unrelated structure is not this test's business.
      if (!/^[a-zA-Z]+$/.test(value)) continue;
      if (!known.has(value)) offenders.push(`${file.replace(process.cwd(), "")}: "${value}"`);
    }
  }

  assert.deepEqual(offenders, [], `unknown notification icon keys:\n${offenders.join("\n")}`);
});
