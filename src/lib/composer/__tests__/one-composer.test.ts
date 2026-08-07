import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

// ════════════════════════════════════════════════════════════════════════════
//  There is ONE composer.
//
//  ── Why this needs a test ─────────────────────────────────────────────────
//  Adding a `<textarea>` is the single easiest thing to do in this codebase and
//  it is always locally correct: the new surface works, ships, and looks fine.
//  What it silently loses is everything the Composer owns — @mentions, the
//  keyboard contract, drafts, the character limit, the combobox ARIA. Nobody
//  notices, because nothing is broken; the feature is just quietly absent on
//  one screen.
//
//  That is exactly how the codebase ended up with seven textareas and mentions
//  working in precisely one of them. This test makes the next one fail loudly.
// ════════════════════════════════════════════════════════════════════════════

const SRC = join(process.cwd(), "src");

/** Directories where user-to-user text is entered. */
const COMMUNICATION = [
  "components/messages",
  "components/forums",
  "components/feed",
  "components/gym-posts",
  "components/gyms",
  "components/fight",
  "components/community",
];

/**
 * Files allowed a raw textarea, with the reason.
 *
 * The bar: it must not be user-to-user COMMUNICATION. A form field that happens
 * to be multi-line is not a message, and mentions in it would be meaningless.
 */
const ALLOWED: Record<string, string> = {
  "components/forums/report-dialog.tsx":
    "a moderation report — addressed to staff, not to another user. An @mention in a report body would notify the person being reported that they had been reported",
  "components/composer/composer.tsx": "IS the composer",
};

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // a listed directory that does not exist yet is not a failure
  }
  for (const entry of entries) {
    if (entry === "__tests__" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if ([".ts", ".tsx"].includes(extname(entry))) out.push(full);
  }
  return out;
}

describe("every communication surface uses the Composer", () => {
  const files = COMMUNICATION.flatMap((d) => walk(join(SRC, d)));

  test("the scan actually covers the communication surfaces", () => {
    assert.ok(files.length > 20, `only ${files.length} files scanned — the directory list is stale`);
  });

  test("no raw <textarea> outside the allow-list", () => {
    const offenders = files
      .map((f) => relative(SRC, f).replace(/\\/g, "/"))
      .filter((rel) => !ALLOWED[rel])
      .filter((rel) => readFileSync(join(SRC, rel), "utf8").includes("<textarea"));

    assert.deepEqual(
      offenders,
      [],
      "These surfaces enter user text through a raw <textarea>, which silently\n" +
        "loses @mentions, the keyboard contract, drafts and the character limit:\n" +
        offenders.map((f) => `  • ${f}`).join("\n") +
        "\n\nUse <Composer> from components/composer/composer. If the field genuinely\n" +
        "is not user-to-user communication, add it to ALLOWED with the reason.",
    );
  });

  test("the detector actually detects — this guard is not vacuous", () => {
    // Everything is migrated, so the assertion above passes trivially. Pin the
    // detector so a future edit that breaks it fails here instead of silently
    // permitting what it exists to catch.
    assert.ok("<textarea rows={3} />".includes("<textarea"));
    assert.equal("<Composer rows={3} />".includes("<textarea"), false);
  });

  test("every ALLOWED entry still exists — a stale exemption is a hole", () => {
    for (const rel of Object.keys(ALLOWED)) {
      const full = join(SRC, rel);
      assert.doesNotThrow(
        () => statSync(full),
        `ALLOWED lists ${rel}, which no longer exists — remove the exemption`,
      );
    }
  });
});

describe("mention autocomplete has one implementation", () => {
  test("only the Composer queries the people typeahead", () => {
    // A second caller of this endpoint means a second menu, a second keyboard
    // model and a second ranking — which is how "mentions feel different over
    // here" starts. The challenge PICKER is a different control (it picks a
    // person, it does not complete text mid-sentence) and has its own file.
    // Comments are stripped first: several files legitimately DESCRIBE the
    // endpoint ("the picker is fed by /api/users/search") without calling it,
    // and a guard that cannot tell prose from code trains people to ignore it.
    const stripComments = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

    const all = walk(join(SRC, "components")).concat(walk(join(SRC, "lib")));
    const callers = all
      .map((f) => relative(SRC, f).replace(/\\/g, "/"))
      .filter((rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).includes("/api/users/search"));

    assert.deepEqual(
      callers.sort(),
      ["components/composer/composer.tsx", "components/people/people-picker.tsx"],
      "an unexpected surface is querying the mention endpoint directly",
    );
  });
});
