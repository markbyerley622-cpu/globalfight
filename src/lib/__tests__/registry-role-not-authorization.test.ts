import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

// ════════════════════════════════════════════════════════════════════════════
//  `registryRole` IS NOT AN AUTHORIZATION MECHANISM.
//
//  CLAUDE.md states it twice and lib/promoter/verification.ts opens with it:
//  registryRole is a SELF-DECLARED label chosen at signup, with no evidence
//  behind it and no privilege attached. Anyone can pick "promoter". It drives
//  UI copy and "claim your page" nudges, nothing else.
//
//  ── Why a test and not just the comment ───────────────────────────────────
//  The wrong version is the one that looks obvious. `user.registryRole ===
//  "promoter"` reads like a permission check, compiles, type-checks, renders
//  correctly, and passes every manual test — because the person testing it
//  picked "promoter" at signup. It fails in two directions at once and neither
//  is visible from the code:
//
//    • It GRANTS nothing it should, to nobody — but it LOOKS like it grants,
//      so the real capability check gets skipped as redundant.
//    • It HIDES the feature from every verified promoter who picked "fan" at
//      signup, which is most of them, because nobody chooses their signup
//      label expecting it to gate a product surface months later.
//
//  Privileges come from the capability system: a claim, evidence, a human
//  decision, and a state derived by lib/promoter/verification. This test reads
//  the source so the NEXT person to reach for the obvious version is stopped by
//  a failing test rather than by a code review that might not happen.
// ════════════════════════════════════════════════════════════════════════════

const SRC = join(process.cwd(), "src");

/**
 * `registryRole` in a COMPARISON — the shape that gates on it.
 *
 * Matches `=== "promoter"`, `!== 'gym'`, `includes(registryRole)` and the
 * switch/ternary forms, in any spacing, in either quote style. Deliberately
 * does NOT match a bare read (`select: { registryRole: true }`, `role =
 * u.registryRole`, rendering it as a label), which is the legitimate use and by
 * far the common one.
 */
const GATED = [
  /registryRole\s*[=!]==?\s*['"`]/,
  /['"`]\w+['"`]\s*[=!]==?\s*[\w.?]*registryRole/,
  /\b(?:includes|has)\s*\(\s*[\w.?]*registryRole\s*\)/,
  /switch\s*\(\s*[\w.?]*registryRole\s*\)/,
];

/**
 * Comparisons that are legitimately about the LABEL, not about permission.
 *
 * Every entry must be a place where the answer changes what is DISPLAYED or
 * which form is shown — never what a caller is allowed to do. Adding an entry
 * here is a deliberate act; adding one that gates a capability is the bug this
 * file exists to catch.
 */
const ALLOWED: Record<string, string> = {
  "components/profile/profile-editor.tsx":
    "renders which role chip is selected in the viewer's own profile editor — a display state of their own self-declared label",
  "components/profile/profile-view.tsx":
    "prints the label as text on a profile",
  "lib/identity-verification.ts":
    "picks WHICH document flow applies to a professional claim (fighter vs coach vs gym). It decides the shape of the evidence asked for, never whether the claim is granted — that is a human reviewer's decision recorded elsewhere",
  "lib/geo/people.ts":
    "decides whether to print a role caption under a map pin",
  "app/account/page.tsx":
    "chooses which panel to OFFER on the viewer's own account page (the professional-verification nudge, the fighter-profile form). Verified independently: /api/fighters/onboard authenticates and scopes to user.id and never reads registryRole, so hiding the panel withholds a shortcut, not a permission — the same page's own comment calls it 'the nudge, not a gate'",
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

/** Strip comments so prose ABOUT the rule is never read as a violation of it. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("registryRole is never an authorization decision", () => {
  const files = walk(SRC);

  test("the codebase is actually being scanned", () => {
    // A guard test that silently walks an empty tree passes forever. Pin it.
    assert.ok(files.length > 300, `only ${files.length} source files scanned — the walk is broken`);
  });

  test("no file gates behaviour on registryRole", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const rel = relative(SRC, file).replace(/\\/g, "/");
      if (ALLOWED[rel]) continue;
      const body = stripComments(readFileSync(file, "utf8"));
      if (GATED.some((re) => re.test(body))) offenders.push(rel);
    }

    assert.deepEqual(
      offenders,
      [],
      `registryRole is a self-declared label with NO privilege (CLAUDE.md).\n` +
        `These files compare it, which is how a permission check gets written by accident:\n` +
        offenders.map((f) => `  • ${f}`).join("\n") +
        `\n\nGate on the capability system instead — for promoters that is\n` +
        `getViewerPromoter() + promoterCapabilities() (lib/promoter/verification).\n` +
        `If the comparison is genuinely about DISPLAY, add it to ALLOWED with the reason.`,
    );
  });

  test("every ALLOWED entry still exists — a stale exemption is a hole", () => {
    // An exemption that outlives its file silently widens the allow-list for
    // whatever is created at that path next.
    for (const rel of Object.keys(ALLOWED)) {
      const full = join(SRC, rel);
      assert.ok(
        files.includes(full),
        `ALLOWED lists ${rel}, which no longer exists — remove the exemption`,
      );
    }
  });
});

describe("the promoter surfaces gate on the capability system", () => {
  // The positive half. The scan above proves the WRONG check is absent; this
  // proves the RIGHT one is present, so deleting the real gate cannot pass by
  // simply leaving no comparison behind at all.

  const MUST_GUARD = [
    "app/api/promoter/events/route.ts",
    "app/api/promoter/poster/route.ts",
    "app/api/promoter/events/[id]/results/route.ts",
    "app/promoter/page.tsx",
    "app/promoter/new/page.tsx",
  ];

  for (const rel of MUST_GUARD) {
    test(`${rel} consults the promoter capability system`, () => {
      const body = readFileSync(join(SRC, rel), "utf8");
      assert.match(
        body,
        /promoterCapabilities|getViewerPromoter|requireCapability|assertPromoterCan|publishDraft|recordPromoterResult|createDraft|saveDraft/,
        `${rel} is a promoter surface that never reaches the capability system — ` +
          `either it calls a service-layer function that does, or the gate is missing`,
      );
    });
  }
});
