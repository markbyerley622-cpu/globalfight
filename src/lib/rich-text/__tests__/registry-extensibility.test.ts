import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  registerEntity, entityPlugin, entityKinds, entityPlugins,
  entityHref, entityPreviewable, entityCacheKey, entityDisplayName,
} from "../registry";
import { sanitizeEntities } from "../types";
import { segmentBody } from "../segment";

// ════════════════════════════════════════════════════════════════════════════
//  THE CLAIM: a new entity kind needs NO change to any consumer.
//
//  That is the whole argument for the registry, and it is the kind of claim
//  that is true on the day it is written and quietly false six months later —
//  somebody adds a `if (kind === "event")` to the renderer for one urgent case
//  and the property is gone, with nothing failing.
//
//  So it is tested by actually doing it. The suite below registers a kind that
//  exists nowhere in the source — "sponsor", one of the kinds the brief named
//  as a future need — and then asserts that the pipeline handles it end to end:
//  it validates, it segments, it routes, it caches, it previews. Not one line
//  of EntityText, the hover manager, the segmenter or the sanitiser mentions
//  it, and none of them had to.
//
//  If this suite ever needs editing to accommodate a new kind, the architecture
//  has regressed and the edit is the evidence.
// ════════════════════════════════════════════════════════════════════════════

const SPONSOR = {
  kind: "sponsor",
  label: "sponsor",
  labelPlural: "Sponsors",
  tone: "org" as const,
  markShape: "square" as const,
  href: (e: { hint?: { slug?: string } }) => (e.hint?.slug ? `/sponsors/${e.hint.slug}` : null),
  unavailable: "This sponsor is no longer listed",
  previewable: true,
  analytics: () => ({ entity: "sponsor" }),
};

describe("a brand-new kind works with no core edits", () => {
  registerEntity(SPONSOR);

  const entity = {
    type: "sponsor",
    id: "sp_1",
    start: 6,
    end: 14,
    hint: { slug: "monster", name: "Monster" },
  };
  const text = "Fuelled by Monster tonight";

  test("the kind becomes STORABLE — sanitizeEntities stops dropping it", () => {
    // This is the mechanism. Before registration the sanitiser would discard
    // the entity as an unknown kind, and the span would silently degrade to
    // plain text everywhere in the product.
    const out = sanitizeEntities([{ ...entity, start: 11, end: 18 }], text);
    assert.equal(out.length, 1);
    assert.equal(out[0].type, "sponsor");
    assert.equal(out[0].hint?.slug, "monster");
  });

  test("the SEGMENTER emits it without knowing what it is", () => {
    const lines = segmentBody(text, [{ ...entity, start: 11, end: 18 }]);
    const seg = lines[0].find((s) => s.kind === "entity");
    assert.ok(seg, "the segmenter dropped a registered kind");
    assert.equal(seg.kind === "entity" && seg.entity.type, "sponsor");
    assert.equal(seg.kind === "entity" && seg.text, "Monster");
  });

  test("NAVIGATION comes from the plugin — the registry owns deep linking", () => {
    assert.equal(entityHref(entity), "/sponsors/monster");
    // A hint with no slug is a row that has gone. Inert text, never a 404 link.
    assert.equal(entityHref({ ...entity, hint: {} }), null);
  });

  test("it is PREVIEWABLE, and the viewer gate is respected", () => {
    assert.equal(entityPreviewable(entity, { signedIn: false }), true);

    registerEntity({
      ...SPONSOR,
      kind: "sponsor-private",
      // A kind that declines to preview for signed-out readers.
      mayPreview: (_e, viewer) => viewer.signedIn,
    });
    const priv = { ...entity, type: "sponsor-private" };
    assert.equal(entityPreviewable(priv, { signedIn: false }), false);
    assert.equal(entityPreviewable(priv, { signedIn: true }), true);
  });

  test("it CACHES under the shared key scheme", () => {
    assert.equal(entityCacheKey(entity), "sponsor:sp_1");
  });

  test("it gets a display name from the same helper every kind uses", () => {
    assert.equal(entityDisplayName(entity), "Monster");
    assert.equal(entityDisplayName({ ...entity, hint: {} }, "Sponsor"), "Sponsor");
  });

  test("an UNREGISTERED kind is dropped, not rendered as an inert chip", () => {
    const out = sanitizeEntities(
      [{ type: "nothing-registered-this", id: "x1", start: 0, end: 3 }],
      text,
    );
    assert.deepEqual(out, []);
  });

  test("a duplicate kind is LOUD, not silently overwritten", () => {
    assert.throws(
      () => registerEntity({ ...SPONSOR, label: "impostor" }),
      /both claim kind "sponsor"/,
      "a second plugin claiming a live kind must throw — otherwise one of the " +
        "two files is dead code that still looks live",
    );
  });

  // The synthetic kinds stay registered for the rest of this process, and that
  // is deliberate: the registry is append-only at runtime, because a plugin
  // system that can UNregister invites code that removes a kind while entities
  // of it are on screen. The suites below therefore assert against an explicit
  // list of built-in kinds rather than against "everything registered".
});

// ════════════════════════════════════════════════════════════════════════════
//  THE MANIFESTS — a plugin file that nothing imports simply never runs.
//
//  Registration is an import side effect, so a plugin left out of its manifest
//  is not a compile error and not a test failure anywhere else: the kind is
//  just silently unknown, and every entity of that kind is dropped by
//  sanitizeEntities as though it had never been written. These turn that into
//  a failure with a name on it.
// ════════════════════════════════════════════════════════════════════════════

const SRC = join(process.cwd(), "src");

/**
 * Does this file REGISTER something?
 *
 * ── Why this replaced a filename allow-list ───────────────────────────────
 * The exclusion used to be a set of names — index, registry, parts. That works
 * until a plugin directory gains a shared helper (`rank.ts`, extracted so gyms
 * and fighters could not drift apart), at which point the guard fails on a file
 * that is not a plugin and the reflex is to add its name to the list. Do that
 * twice and the list is a place where a REAL plugin can be silently parked.
 *
 * So the test is behavioural: a plugin is a file that calls a register
 * function. Infrastructure does not, and cannot be mistaken for one whatever it
 * is called.
 */
const REGISTERS = /\bregister(EntitySource|Entity|PreviewLoader|Preview)\s*\(/;

function pluginFiles(dir: string): string[] {
  return readdirSync(join(SRC, dir))
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
    // The manifest itself imports every plugin, so it always matches the
    // pattern in the files it names — exclude it by path, not by behaviour.
    .filter((f) => !/^index\.tsx?$/.test(f))
    .filter((f) => REGISTERS.test(readFileSync(join(SRC, dir, f), "utf8")))
    .map((f) => f.replace(/\.tsx?$/, ""));
}

const MANIFESTS: { name: string; dir: string; manifest: string }[] = [
  {
    name: "entity kinds",
    dir: "lib/rich-text/plugins",
    manifest: "lib/rich-text/plugins/index.ts",
  },
  {
    name: "entity sources (server)",
    dir: "lib/rich-text/server",
    manifest: "lib/rich-text/server/index.ts",
  },
  {
    name: "preview views (client)",
    dir: "components/rich-text/previews",
    manifest: "components/rich-text/previews/index.tsx",
  },
];

describe("every plugin file is registered by its manifest", () => {
  for (const m of MANIFESTS) {
    test(`${m.name}: no file is left unimported`, () => {
      const source = readFileSync(join(SRC, m.manifest), "utf8");
      const missing = pluginFiles(m.dir).filter((f) => !source.includes(`"./${f}"`));

      assert.deepEqual(
        missing,
        [],
        `These files exist in src/${m.dir} but are not imported by ${m.manifest}:\n` +
          missing.map((f) => `  - ${f}`).join("\n") +
          "\n\nAn unimported plugin never registers, so its kind is silently " +
          "unknown and every entity of that kind is dropped on read. Add the " +
          "import.",
      );
    });
  }
});

describe("the three halves of a plugin agree", () => {
  test("every built-in kind that claims a preview has a loader and a view", async () => {
    // Imported here rather than at module scope: the view manifest pulls React
    // components, and the loader manifest is server-only. Both are inspected as
    // SOURCE below rather than executed, so this stays a plain node test.
    await import("../plugins");

    const viewSource = readFileSync(
      join(SRC, "components/rich-text/previews/index.tsx"), "utf8",
    );
    const loaderSource = readFileSync(
      join(SRC, "lib/rich-text/server/index.ts"), "utf8",
    );

    // Only the kinds this repository ships. The synthetic kinds registered by
    // the suite above are deliberately excluded — they exist to prove the
    // pipeline is open, not to demand three files each.
    const builtIn = ["mention", "fighter", "event", "gym", "promotion"];

    for (const kind of builtIn) {
      const plugin = entityPlugin(kind);
      assert.ok(plugin, `built-in kind "${kind}" is not registered`);
      if (!plugin.previewable) continue;

      assert.ok(
        loaderSource.includes(`"./${kind}"`),
        `"${kind}" is previewable but has no entity source — it could not be ` +
          "resolved, hydrated or previewed.",
      );
      assert.ok(
        viewSource.includes(`"./${kind}"`),
        `"${kind}" is previewable but has no view — its card would fall back ` +
          "to the generic body, which says almost nothing.",
      );
    }
  });

  test("the built-in list is not stale", () => {
    // If somebody adds a plugin file and forgets this list, the check above
    // would pass vacuously for the new kind.
    const onDisk = pluginFiles("lib/rich-text/plugins").sort();
    assert.deepEqual(
      onDisk,
      ["event", "fighter", "gym", "mention", "promotion"],
      "A plugin file was added or removed. Update the `builtIn` list above so " +
        "the loader/view agreement is actually checked for it.",
    );
  });
});

describe("registered kinds are internally consistent", () => {
  test("no plugin ships without the fields every consumer reads", () => {
    for (const p of entityPlugins()) {
      assert.equal(typeof p.kind, "string", "a plugin has no kind");
      assert.ok(p.label.length > 0, `${p.kind}: an empty label is read aloud as nothing`);
      assert.ok(p.unavailable.length > 0, `${p.kind}: no unavailable copy`);
      assert.equal(typeof p.href, "function", `${p.kind}: href is not a function`);
    }
  });

  test("entityKinds reports what was registered", () => {
    const kinds = entityKinds();
    for (const kind of ["mention", "fighter", "event", "gym", "promotion"]) {
      assert.ok(kinds.includes(kind), `${kind} is missing from entityKinds()`);
    }
  });
});
