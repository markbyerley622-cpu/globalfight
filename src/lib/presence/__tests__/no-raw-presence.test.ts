import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

// ════════════════════════════════════════════════════════════════════════════
//  Nothing may read `lastSeenAt` except the policy layer.
//
//  ── Why this test exists ──────────────────────────────────────────────────
//  `visiblePresence` / `presenceDtoFor` are only a privacy control while they
//  are the ONLY route to the data. The moment one surface selects `lastSeenAt`
//  into a DTO by hand, that surface leaks the presence of every user who
//  switched it off — and the leak is invisible to the person it concerns,
//  because they cannot see what strangers see.
//
//  Presence is going onto every surface with an avatar, each with its own
//  query. That is a lot of chances to write the obvious thing. This test reads
//  the source so the obvious thing fails loudly instead of silently.
// ════════════════════════════════════════════════════════════════════════════

const SRC = join(process.cwd(), "src");

/** The privacy columns. Reading any of these outside the policy layer is the bug. */
const RAW = /\b(lastSeenAt|showOnlineStatus|showLastSeen|allowTypingIndicator|allowReadReceipts)\b/;

/**
 * Files allowed to touch the raw columns, with the reason.
 *
 * Every entry is either the policy layer itself, the fragment that feeds it, or
 * a place that WRITES the columns. Nothing that renders may appear here.
 */
const ALLOWED: Record<string, string> = {
  "lib/presence/derive.ts": "the pure decay function — takes a timestamp as an argument, reads no row",
  "lib/presence/policy.ts": "THE policy layer; the one place allowed to decide visibility",
  "lib/presence/select.ts": "the shared Prisma fragment every query spreads",
  "lib/presence/repo.ts": "writes the heartbeat",
  "lib/presence/use-presence.ts": "consumes the already-filtered DTO",
  "lib/messages/repo.ts": "builds DmPerson through presenceDtoFor and applies the mutual gates",
  "app/api/profile/route.ts": "lets a user read and write their OWN switches",
  "app/u/[username]/page.tsx": "selects via PRESENCE_SELECT and renders through presenceDtoFor",
  "components/profile/presence-settings.tsx": "the settings screen itself",
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

/** Strip comments so prose ABOUT the rule is not read as a breach of it. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("raw presence columns stay inside the policy layer", () => {
  const files = walk(SRC);

  test("the codebase is actually being scanned", () => {
    assert.ok(files.length > 300, `only ${files.length} files scanned — the walk is broken`);
  });

  test("no surface reads a presence column directly", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(SRC, file).replace(/\\/g, "/");
      if (ALLOWED[rel]) continue;
      if (RAW.test(stripComments(readFileSync(file, "utf8")))) offenders.push(rel);
    }

    assert.deepEqual(
      offenders,
      [],
      "These files touch a raw presence column. Presence is viewer-dependent and\n" +
        "privacy-gated: selecting it by hand leaks the status of every user who\n" +
        "switched it off, on a surface they cannot see.\n" +
        offenders.map((f) => `  • ${f}`).join("\n") +
        "\n\nUse PRESENCE_SELECT in the query and presenceDtoFor() to build the DTO,\n" +
        "then render with <PresenceDot> / <PresenceLabel>.",
    );
  });

  test("every ALLOWED entry still exists — a stale exemption is a hole", () => {
    for (const rel of Object.keys(ALLOWED)) {
      assert.ok(
        files.includes(join(SRC, rel)),
        `ALLOWED lists ${rel}, which no longer exists — remove the exemption`,
      );
    }
  });
});

describe("the presence UI has exactly one implementation", () => {
  const files = walk(SRC).filter((f) => f.endsWith(".tsx"));

  test("only the shared component renders a presence dot", () => {
    // A second copy is a second place the privacy rules can be got wrong, and
    // the wrong one is invisible to the person it leaks about.
    const owners = files
      .map((f) => relative(SRC, f).replace(/\\/g, "/"))
      .filter((rel) => rel !== "components/presence/presence-dot.tsx")
      .filter((rel) => /export function Presence(Dot|Label|Avatar)/.test(readFileSync(join(SRC, rel), "utf8")));

    assert.deepEqual(owners, [], `presence UI is defined outside the shared component: ${owners.join(", ")}`);
  });
});
