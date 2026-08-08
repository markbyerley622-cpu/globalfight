import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { mentionedUserIds } from "../types";

// ════════════════════════════════════════════════════════════════════════════
//  WHO GETS PINGED — and, far more importantly, who does not.
//
//  ── The failure this prevents ─────────────────────────────────────────────
//  Naming a fighter or an event in a post is CONTENT, not an act aimed at a
//  person. The moment the composer could insert those kinds, the notifier
//  became the most dangerous thing in the platform: it reads a list of
//  entities, and if it had simply read "every entity's id" it would have tried
//  to notify a fighter row and an event row.
//
//  What makes that severe rather than merely wrong is that `Fighter.ownerId`
//  exists — a claimed fighter page belongs to a real account. A notifier that
//  did not discriminate by kind would eventually ping a real human every time
//  anybody mentioned them in any post on the platform, which is a
//  notification-spam vector with no opt-out.
//
//  So `mentionedUserIds` filters on kind, and this pins that behaviour.
// ════════════════════════════════════════════════════════════════════════════

const entity = (type: string, id: string) => ({ type, id, start: 0, end: 5 });

/** Every kind the product actually ships, read from the registry. */
async function registeredKinds(): Promise<string[]> {
  await import("../plugins");
  const { entityKinds } = await import("../registry");
  return entityKinds();
}

describe("only PEOPLE are notified", () => {
  test("a person mention yields their user id", () => {
    assert.deepEqual(mentionedUserIds([entity("mention", "usr_1")]), ["usr_1"]);
  });

  test("a FIGHTER mention notifies nobody", () => {
    // A fighter is a registry row. Even when claimed, being named in a post is
    // not an act aimed at its owner.
    assert.deepEqual(mentionedUserIds([entity("fighter", "ftr_1")]), []);
  });

  test("an EVENT mention notifies nobody", () => {
    // There is no subscription model that says "tell the promoter when anyone
    // mentions this card", and inventing one here would be inventing product.
    assert.deepEqual(mentionedUserIds([entity("event", "evt_1")]), []);
  });

  test("a gym or promotion mention notifies nobody", () => {
    assert.deepEqual(mentionedUserIds([entity("gym", "gym_1"), entity("promotion", "ufc")]), []);
  });

  test("a MIXED body notifies only the people in it", () => {
    // The realistic case: "@Alex Pereira fights at @UFC 322, thoughts @dave?"
    const ids = mentionedUserIds([
      entity("fighter", "ftr_1"),
      entity("event", "evt_1"),
      entity("mention", "usr_dave"),
    ]);
    assert.deepEqual(ids, ["usr_dave"]);
  });

  test("an UNKNOWN future kind notifies nobody by default", () => {
    // The important direction of the default. A kind nobody has thought about
    // yet must not be able to ping anyone just by carrying an id that happens
    // to look like a user id.
    assert.deepEqual(mentionedUserIds([entity("sponsor", "usr_1")]), []);
  });

  test("EVERY registered kind except the person one notifies nobody", async () => {
    // Asserted against the REGISTRY rather than a list written here, so a kind
    // added tomorrow is covered the day it is added. Gyms and promotions became
    // pickable in this pass, which is exactly when this needed to stop being a
    // hand-maintained list.
    const kinds = await registeredKinds();
    assert.ok(kinds.includes("gym") && kinds.includes("promotion"), "the registry looks empty");

    for (const kind of kinds) {
      if (kind === "mention") continue;
      assert.deepEqual(
        mentionedUserIds([entity(kind, "usr_looks_like_a_user_id")]),
        [],
        `"${kind}" produced a notification target. Only a PERSON mention may.`,
      );
    }
  });

  test("only ONE registered kind can produce a target at all", async () => {
    const kinds = await registeredKinds();
    const notifying = kinds.filter((k) => mentionedUserIds([entity(k, "x")]).length > 0);
    assert.deepEqual(
      notifying, ["mention"],
      "more than one kind can notify — the person kind must be the only one",
    );
  });

  test("the same person named twice is notified once", () => {
    assert.deepEqual(
      mentionedUserIds([entity("mention", "usr_1"), entity("mention", "usr_1")]),
      ["usr_1"],
    );
  });
});

// ── The other half: nobody bypasses that filter ─────────────────────────────

const SRC = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if ([".ts", ".tsx"].includes(extname(entry))) out.push(full);
  }
  return out;
}

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("no notifier reads entity ids without filtering by kind", () => {
  test("notification code goes through mentionedUserIds", () => {
    // `entities.map(e => e.id)` in a notifier is the exact bug described in
    // this file's header: it compiles, it looks reasonable, and it turns every
    // fighter mention into a ping. Cheap to write by accident, invisible in
    // review, and the blast radius is every claimed fighter on the platform.
    const suspects = walk(join(SRC, "lib"))
      .map((f) => relative(SRC, f).replace(/\\/g, "/"))
      .filter((rel) => rel.includes("notify") || rel.includes("notification"))
      .filter((rel) => {
        const body = stripComments(readFileSync(join(SRC, rel), "utf8"));
        if (!body.includes("entities")) return false;
        // Fine: it delegates. Suspicious: it touches entity ids itself.
        if (body.includes("mentionedUserIds")) return false;
        return /entities[\s\S]{0,80}\.id\b/.test(body);
      });

    assert.deepEqual(
      suspects,
      [],
      "These read entity ids in a notifier without going through\n" +
        "mentionedUserIds, which is the only thing that filters non-person\n" +
        "kinds out:\n" +
        suspects.map((f) => `  - ${f}`).join("\n"),
    );
  });

  test("no entity source reads an ownerId", () => {
    // The specific accident worth naming: `Gym.ownerId` and `Fighter.ownerId`
    // exist, so a source that selected one would put a real user id inside an
    // entity preview — one `.map(e => e.ownerId)` away from notifying a gym
    // owner every time anybody mentions their gym.
    //
    // No source has any reason to read it: ownership decides who may EDIT a
    // gym, which is an authorisation question answered in lib/gym-posts, not
    // something a mention needs to know.
    const sources = walk(join(SRC, "lib", "rich-text", "server"))
      .map((f) => relative(SRC, f).replace(/\\/g, "/"))
      .filter((rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).includes("ownerId"));

    assert.deepEqual(
      sources,
      [],
      "These entity sources read an ownerId:\n" +
        sources.map((f) => `  - ${f}`).join("\n") +
        "\n\nAn entity is CONTENT. Its owner is not a party to being mentioned.",
    );
  });

  test("the detector is not vacuous", () => {
    assert.ok(/entities[\s\S]{0,80}\.id\b/.test("const ids = entities.map((e) => e.id)"));
    assert.equal(/entities[\s\S]{0,80}\.id\b/.test("mentionedUserIds(entities)"), false);
  });
});
