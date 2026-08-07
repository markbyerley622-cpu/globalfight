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
  test("no surface reimplements mention rendering", () => {
    // The old RichText produced a <span data-mention> that looked like a link
    // and did nothing. A second renderer would reintroduce exactly that split.
    const files = walk(SRC).filter((f) => f.endsWith(".tsx"));
    const owners = files
      .map((f) => relative(SRC, f).replace(/\\/g, "/"))
      .filter((rel) => rel !== "components/rich-text/entity-text.tsx")
      .filter((rel) => readFileSync(join(SRC, rel), "utf8").includes("data-mention"));

    assert.deepEqual(owners, [], `mention rendering is duplicated in: ${owners.join(", ")}`);
  });
});
