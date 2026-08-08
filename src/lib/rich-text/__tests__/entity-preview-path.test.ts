import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { entitySource, registerEntitySource, loadPreviews } from "../server";
import { entityPlugin, entityCacheKey, entityHrefForHint } from "../registry";

// ════════════════════════════════════════════════════════════════════════════
//  GYMS AND PROMOTIONS TAKE THE SAME PREVIEW PATH AS EVERYTHING ELSE.
//
//  The path is: plugin says previewable → source.preview() loads → the batched
//  /api/entities/preview route answers → the shared cache stores under kind:id
//  → the one hover host renders the kind's registered view → the plugin's
//  href() navigates.
//
//  Every step is shared. What this asserts is that neither kind has fallen out
//  of any of them — which is exactly the kind of gap that produces a chip that
//  hovers into an empty card and looks like a rendering fault.
//
//  ── What is NOT tested here, and why ──────────────────────────────────────
//  The gym and promotion `preview()` queries both hit Postgres, so they cannot
//  run in this suite. Their CONTRACT is asserted; their SQL is not. The report
//  says so rather than implying otherwise.
// ════════════════════════════════════════════════════════════════════════════

const PREVIEWED = ["mention", "fighter", "event", "gym", "promotion"] as const;

describe("gym and promotion are previewable, the same way as everything else", () => {
  for (const kind of ["gym", "promotion"] as const) {
    describe(kind, () => {
      test("the plugin declares it previewable", () => {
        const plugin = entityPlugin(kind);
        assert.ok(plugin, `${kind} has no plugin`);
        assert.equal(plugin.previewable, true, `${kind} would never open a card`);
      });

      test("the source can load a preview", () => {
        const source = entitySource(kind);
        assert.ok(source, `${kind} has no entity source`);
        assert.equal(typeof source.preview, "function");
      });

      test("a view is wired to draw it", () => {
        // Without one the shell falls back to a generic card that names the
        // thing and links to it — which works, but says almost nothing.
        //
        // Asserted from SOURCE, not by importing the view registry. The view
        // manifest is a client module and this suite runs under
        // `--conditions=react-server`, where React's server build has no
        // createContext — importing it throws. So what is checked is that the
        // kind's view file exists AND registers itself AND is imported by the
        // manifest, which is the whole chain that makes the runtime lookup
        // succeed.
        const view = readFileSync(
          join(process.cwd(), "src", "components", "rich-text", "previews", `${kind}.tsx`),
          "utf8",
        );
        assert.ok(
          view.includes(`registerPreview("${kind}"`),
          `previews/${kind}.tsx does not register itself`,
        );

        const manifest = readFileSync(
          join(process.cwd(), "src", "components", "rich-text", "previews", "index.tsx"),
          "utf8",
        );
        assert.ok(
          manifest.includes(`"./${kind}"`),
          `previews/index.tsx does not import ${kind} — an unimported view never registers`,
        );
      });

      test("navigation comes from the registry, not the card", () => {
        const href = entityHrefForHint(kind, { slug: "example" });
        assert.ok(href && href.length > 0, `${kind} has no href for a known slug`);
        // A row that has gone is inert text, never a link into a 404.
        assert.equal(entityHrefForHint(kind, {}), null);
      });
    });
  }
});

describe("the shared cache keeps the kinds apart", () => {
  test("the same id under two kinds is two cache entries", () => {
    // Gyms, promotions, events and fighters all key on ids from different
    // tables, and a cuid collision across two of them is not impossible. A key
    // of just the id would serve a gym's card for an event.
    const keys = PREVIEWED.map((kind) => entityCacheKey({ type: kind, id: "same_id" }));
    assert.equal(new Set(keys).size, keys.length, "two kinds share a cache key");
  });

  test("the key names the kind, so a mixed batch cannot cross-contaminate", () => {
    assert.equal(entityCacheKey({ type: "gym", id: "g1" }), "gym:g1");
    assert.equal(entityCacheKey({ type: "promotion", id: "ufc" }), "promotion:ufc");
  });
});

describe("the batched preview route handles any kind", () => {
  // A fake source proves the FAN-OUT — the code every kind actually runs
  // through — without needing a database for the real ones.
  registerEntitySource({
    kind: "previewtest",
    async resolve() { return new Map(); },
    async hydrate() { return new Map(); },
    async preview(ids) {
      // "gone" stands in for a row that was deleted, or that this viewer may
      // not see — a source returns nothing for both, identically.
      return ids
        .filter((id) => id !== "gone")
        .map((id) => ({ kind: "previewtest", id, name: `row-${id}` }));
    },
  });

  test("a mixed batch returns each kind's own rows", async () => {
    const out = await loadPreviews(
      [{ type: "previewtest", id: "a" }, { type: "previewtest", id: "b" }],
      { viewerId: null },
    );
    assert.equal(out.length, 2);
    for (const p of out) assert.equal(p.kind, "previewtest");
  });

  test("an unavailable row is ABSENT, not an error, and does not lose its batch", async () => {
    // The cache reads an absent id as `missing` and stops asking. A deleted
    // gym, a withdrawn promotion and a nonsense id all behave identically, so
    // the endpoint cannot be used to tell them apart — and the rows either
    // side of it still answer.
    const out = await loadPreviews(
      [
        { type: "previewtest", id: "a" },
        { type: "previewtest", id: "gone" },
        { type: "previewtest", id: "b" },
      ],
      { viewerId: null },
    );
    assert.deepEqual(out.map((p) => p.id).sort(), ["a", "b"]);
  });

  test("an UNREGISTERED kind is skipped without taking the batch down", async () => {
    const out = await loadPreviews(
      [{ type: "not-a-kind", id: "x" }, { type: "previewtest", id: "a" }],
      { viewerId: null },
    );
    assert.equal(out.length, 1, "one unknown kind lost the answers the batch could give");
    assert.equal(out[0].kind, "previewtest");
  });

  test("a source that THROWS loses only its own kind", async () => {
    registerEntitySource({
      kind: "previewthrows",
      async resolve() { return new Map(); },
      async hydrate() { return new Map(); },
      async preview() { throw new Error("table is on fire"); },
    });

    const out = await loadPreviews(
      [{ type: "previewthrows", id: "x" }, { type: "previewtest", id: "a" }],
      { viewerId: null },
    );
    assert.equal(out.length, 1, "one failing kind emptied the whole batch");
    assert.equal(out[0].kind, "previewtest");
  });
});

// ── What a preview may publish ──────────────────────────────────────────────

describe("previews carry nothing private", () => {
  const SRC = join(process.cwd(), "src");
  const SERVER = join(SRC, "lib", "rich-text", "server");

  const sources = readdirSync(SERVER)
    .filter((f) => f.endsWith(".ts") && !["index.ts", "registry.ts", "rank.ts"].includes(f));

  /**
   * Columns no entity source has any business selecting.
   *
   * A preview answers "what is this thing" for anyone who can already see it
   * referenced. None of these help answer that, and every one of them would be
   * a leak on a surface that opens when a pointer crosses a word.
   */
  const FORBIDDEN = [
    "passwordHash", "tokenVersion", "email", "emailVerified",
    "ownerId", "claimantEmail", "phone", "contactEmail",
  ];

  for (const file of sources) {
    test(`${file} selects no private column`, () => {
      const body = readFileSync(join(SERVER, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");

      const found = FORBIDDEN.filter((col) => new RegExp(`\\b${col}\\b`).test(body));
      assert.deepEqual(
        found, [],
        `${file} references ${found.join(", ")}. An entity preview is public by ` +
          "construction — it is loaded for anyone who can read the body the " +
          "entity sits in.",
      );
    });
  }

  test("the forbidden list is not vacuous", () => {
    assert.ok(FORBIDDEN.length > 3);
    assert.ok(new RegExp("\\bownerId\\b").test("select: { ownerId: true }"));
  });
});

describe("the suggest half still hands out KEYS, never ids", () => {
  test("promotion suggestions carry a slug and no id field", async () => {
    // Runs for real: promotions live in an in-code registry, so this needs no
    // database. The invariant it protects is the one that keeps a client from
    // naming a row it should not be able to name.
    const out = await entitySource("promotion")!.suggest!("ufc", 5, { viewerId: null });
    assert.ok(out.length > 0);
    for (const s of out) {
      assert.ok(!("id" in s), "a suggestion carried an id");
      assert.match(s.key, /^[a-z0-9-]+$/, `key "${s.key}" is not a public slug`);
    }
  });
});
