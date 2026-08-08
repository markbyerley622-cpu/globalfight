import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

// ════════════════════════════════════════════════════════════════════════════
//  The legacy parser is a COMPATIBILITY layer, not an implementation.
//
//  ── Why this needs a test ─────────────────────────────────────────────────
//  `extractMentions` still exists and still has to: every post, comment and DM
//  written before entities existed has no structured layer, and re-parsing is
//  the only way to render and notify them correctly. So it cannot be deleted.
//
//  That makes it a trap. It is exported, it works, and calling it from a NEW
//  surface is the path of least resistance — and the result compiles, renders
//  and notifies, so nothing looks wrong. What is silently lost is everything
//  the entity layer buys: the mention stops surviving a rename, the notifier
//  goes back to guessing by username, and the two can drift apart again.
//
//  This pins the call sites. Adding one is a deliberate act with a reason
//  recorded here, not an accident.
// ════════════════════════════════════════════════════════════════════════════

const SRC = join(process.cwd(), "src");

/**
 * Files allowed to call the legacy parser, and why.
 *
 * The bar for a new entry: it must be the FALLBACK branch of a surface that
 * also reads structured entities, reached only when there are none.
 */
const ALLOWED: Record<string, string> = {
  "lib/mentions.ts": "IS the compatibility parser",
  "lib/rich-text/segment.ts":
    "the one reconciler — runs the parser only when a body carries no entities at all",
  "lib/forum/repo.ts":
    "fallback branch of notifyReplyTargets, reached only when mentionedUserIds() is empty",
  "lib/gym-posts/notify.ts":
    "fallback branch of notifyPostComment, reached only when the stored entities are empty",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if ([".ts", ".tsx"].includes(extname(entry))) out.push(full);
  }
  return out;
}

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("legacy mention parsing is confined to the compatibility layer", () => {
  const files = walk(SRC);

  test("the codebase is actually being scanned", () => {
    assert.ok(files.length > 300, `only ${files.length} files scanned — the walk is broken`);
  });

  test("no unexpected caller of extractMentions or the token regex", () => {
    const offenders = files
      .map((f) => relative(SRC, f).replace(/\\/g, "/"))
      .filter((rel) => !ALLOWED[rel])
      .filter((rel) => {
        const body = stripComments(readFileSync(join(SRC, rel), "utf8"));
        return body.includes("extractMentions") || body.includes("RICH_TEXT_TOKEN");
      });

    assert.deepEqual(
      offenders,
      [],
      "These call the LEGACY mention parser. It exists only for content written\n" +
        "before structured entities and must not be a new surface's implementation:\n" +
        offenders.map((f) => `  - ${f}`).join("\n") +
        "\n\nWrite: resolveDraftEntities(). Read: hydrateEntities() + <EntityText>.\n" +
        "Notify: mentionedUserIds(). If this genuinely is a fallback branch beside\n" +
        "a structured path, add it to ALLOWED with the reason.",
    );
  });

  test("the detector actually detects — this guard is not vacuous", () => {
    assert.ok(stripComments("const x = extractMentions(body)").includes("extractMentions"));
    assert.ok(stripComments("line.split(RICH_TEXT_TOKEN)").includes("RICH_TEXT_TOKEN"));
    assert.equal(stripComments("// extractMentions is legacy").includes("extractMentions"), false);
    assert.equal(stripComments("mentionedUserIds(entities)").includes("extractMentions"), false);
  });

  test("every ALLOWED entry still exists — a stale exemption is a hole", () => {
    for (const rel of Object.keys(ALLOWED)) {
      assert.ok(files.includes(join(SRC, rel)), `ALLOWED lists ${rel}, which no longer exists`);
    }
  });
});

describe("there is one entity renderer", () => {
  /**
   * The marker EntityText stamps on every chip it builds.
   *
   * It was `data-mention`, carrying the handle. It is now `data-entity`,
   * carrying the KIND — because a chip is no longer necessarily a person, and
   * because the handle was a value the DOM did not need. Anything else emitting
   * this attribute is a second renderer.
   */
  const MARKER = "data-entity=";

  test("no surface reimplements entity rendering", () => {
    // The old RichText produced a <span data-mention> that looked like a link
    // and did nothing. A second renderer would reintroduce exactly that split —
    // and now that chips carry hover, focus and long-press bindings, a second
    // one would also be a second set of those.
    const files = walk(SRC).filter((f) => f.endsWith(".tsx"));
    const owners = files
      .map((f) => relative(SRC, f).replace(/\\/g, "/"))
      .filter((rel) => rel !== "components/rich-text/entity-text.tsx")
      .filter((rel) => readFileSync(join(SRC, rel), "utf8").includes(MARKER));

    assert.deepEqual(
      owners,
      [],
      `entity rendering is duplicated in: ${owners.join(", ")}\n` +
        "Render bodies with <EntityText>. If a surface needs a different chip, " +
        "the difference belongs in its plugin's tone or label, not in a second " +
        "component.",
    );
  });

  test("the ONE renderer still stamps the marker — this guard is not vacuous", () => {
    // Without this, renaming the attribute in entity-text.tsx would make the
    // test above pass by finding nothing anywhere, which is the failure mode
    // that let `data-mention` linger after it stopped being emitted.
    const source = readFileSync(join(SRC, "components/rich-text/entity-text.tsx"), "utf8");
    assert.ok(
      source.includes(MARKER),
      `EntityText no longer emits ${MARKER}. Update MARKER in this test to ` +
        "whatever replaced it, or the duplicate-renderer check above is testing nothing.",
    );
  });

  test("the renderer does not branch on entity KIND", () => {
    // The registry's whole purpose. A comparison against a kind string here is
    // the first step back to a switch, and the second one is always added by
    // somebody who did not know the first existed.
    const source = readFileSync(join(SRC, "components/rich-text/entity-text.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    for (const kind of ["mention", "fighter", "event", "gym", "promotion"]) {
      assert.ok(
        !source.includes(`"${kind}"`) && !source.includes(`'${kind}'`),
        `EntityText names the kind "${kind}". It must ask the registry instead — ` +
          "see lib/rich-text/registry. A kind named here is a kind the next " +
          "plugin will have to be added beside.",
      );
    }
  });
});
