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

describe("uploads have one implementation", () => {
  // The failure this catches is the one that just got fixed: two upload engines
  // that behaved nothing alike, one with progress and retry and one without,
  // because the second was written inside a component file where nobody could
  // see the first.

  test("no surface builds its own upload with XMLHttpRequest or /api/media", () => {
    const stripComments = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

    const ALLOWED_UPLOADERS = new Set([
      // THE engine. Everything else configures it.
      "lib/composer/attachments.ts",
      // Single-image REPLACE controls — an avatar, a gym hero, an event
      // poster. Deliberately not folded into the composer engine: they hold one
      // image rather than a list, they replace rather than append, they support
      // cancel and delete, and none of them lives beside a text input. Forcing
      // them through a multi-attachment message engine would be a worse fit in
      // both directions.
      "components/ui/image-upload.tsx",
      "components/fighters/avatar-uploader.tsx",
      "components/profile/profile-editor.tsx",
      "components/gyms/gym-media-manager.tsx",
      "components/map/gym-gallery-manager.tsx",
      "components/promoter/new-event-flow.tsx",
    ]);

    const all = walk(join(SRC, "components")).concat(walk(join(SRC, "lib")));
    const offenders = all
      .map((f) => relative(SRC, f).replace(/\\/g, "/"))
      .filter((rel) => !ALLOWED_UPLOADERS.has(rel))
      .filter((rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).includes("new XMLHttpRequest"));

    assert.deepEqual(
      offenders,
      [],
      "These build their own upload transport instead of useComposerUploads:\n" +
        offenders.map((f) => `  - ${f}`).join("\n") +
        "\n\nA second engine means a second progress model, a second retry " +
        "rule and a second set of leaked object URLs.",
    );
  });
});

describe("mention autocomplete has one implementation", () => {
  // Comments are stripped first: several files legitimately DESCRIBE an
  // endpoint ("the picker is fed by /api/entities/suggest") without calling it,
  // and a guard that cannot tell prose from code trains people to ignore it.
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  const callersOf = (endpoint: string): string[] => {
    const all = walk(join(SRC, "components")).concat(walk(join(SRC, "lib")));
    return all
      .map((f) => relative(SRC, f).replace(/\\/g, "/"))
      .filter((rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).includes(endpoint))
      .sort();
  };

  test("only the Composer queries the ENTITY typeahead", () => {
    // A second caller means a second menu, a second keyboard model and a second
    // ranking — which is how "mentions feel different over here" starts. This
    // is the endpoint the "@" menu is fed by, across every kind it offers.
    assert.deepEqual(
      callersOf("/api/entities/suggest"),
      ["components/composer/composer.tsx"],
      "an unexpected surface is querying the entity typeahead directly",
    );
  });

  test("the people endpoint is left to the challenge picker", () => {
    // /api/users/search predates the entity picker and still serves the
    // challenge PICKER — a different control, which picks a person rather than
    // completing text mid-sentence. Its people QUERY is shared with the
    // composer's picker through lib/users/search, so there is one definition of
    // "find a person" even though there are two endpoints.
    //
    // The Composer must NOT appear here: it moved to the entity endpoint, and a
    // regression to this one would silently drop fighters and events from the
    // menu while still looking like it worked.
    assert.deepEqual(
      callersOf("/api/users/search"),
      ["components/people/people-picker.tsx"],
      "an unexpected surface is querying the people endpoint directly",
    );
  });

  test("both people typeaheads share ONE query definition", () => {
    // Two endpoints now answer "find a person": /api/users/search for the
    // challenge picker, and the mention half of /api/entities/suggest. They
    // must reach the same function rather than each growing a
    // `prisma.user.findMany` that agrees today and drifts on the first tuning
    // change — the ranking in particular (people you follow first) is easy to
    // reimplement slightly differently and impossible to notice.
    //
    // Asserted by delegation rather than by counting queries: the mention
    // source legitimately queries the user table for resolve, hydrate and
    // preview, none of which are typeaheads.
    for (const rel of [
      "app/api/users/search/route.ts",
      "lib/rich-text/server/mention.ts",
    ]) {
      const body = readFileSync(join(SRC, rel), "utf8");
      assert.ok(
        body.includes("searchPeople("),
        `${rel} runs a people typeahead without calling searchPeople from ` +
          "lib/users/search. Two definitions of this query will diverge.",
      );
    }
  });
});
