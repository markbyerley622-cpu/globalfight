import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

// ════════════════════════════════════════════════════════════════════════════
//  publicDisplayName is a PRIVACY CONTROL, and it only works if it is used.
//
//  display-name.test.ts proves the function is correct. This proves nothing
//  bypasses it — which is the failure that actually shipped. `User.name` holds
//  whatever was typed at signup, and browsers autofill the account EMAIL into
//  that field, so `name ?? username` publishes an inbox. It was found on:
//
//    • the leaderboard row (public page, every ranked predictor)
//    • every forum thread card and post, via the repo mappers
//    • gym reviews
//    • battle/room opponent names
//    • search results and the map pin card
//
//  Each was written independently, by someone who did not know the rule existed.
//  A test that reads the source is the only thing that catches the NEXT one,
//  because the bypass compiles, type-checks and renders perfectly.
// ════════════════════════════════════════════════════════════════════════════

const SRC = join(process.cwd(), "src");

/** `x.name ?? x.username`, `x.name || x.username` — the bypass, in any spacing. */
const BYPASS = /\.name\s*(\?\?|\|\|)\s*[\w.?]*\busername\b/;

/**
 * Surfaces where the raw name is the CORRECT thing to show, with the reason.
 * Every entry is a place the viewer is the subject or is staff — never a
 * stranger reading about someone else.
 */
const ALLOWED: Record<string, string> = {
  "app/account/page.tsx": "your own account page, showing your own name to you",
  "app/admin/layout.tsx": "the signed-in admin's own name in the admin chrome",
  "app/admin/gym-claims/page.tsx": "staff reviewing a claim need the real name on file",
  "app/admin/identity-verification/page.tsx":
    "identity review queue — staff-only (the admin layout 404s for everyone else). The whole task is comparing the name on file against the name on a passport, so publicDisplayName would defeat the page",
  "app/admin/identity-verification/[id]/page.tsx":
    "identity review detail — same reason; the reviewer must see the real name to match it to the document",
  "lib/admin/events.ts": "staff audit log — the actor's real name is the point",
  "app/today/page.tsx": "greets the viewer by their own first name",
  "components/layout/nav-sheet.tsx": "the viewer's own avatar initial in their own nav",
  "components/layout/account-menu.tsx": "the viewer's own avatar initial in their own account menu",
  "lib/fighters/profile.ts":
    "claim review — reviewer-only (see the access matrix); staff assessing an identity claim need the real name on file, and the row already carries claimantEmail on purpose",
  "components/profile/profile-view.tsx": "the viewer's own profile editor",
  "components/predictions/predictions-markets.tsx": "the viewer's own name in their own panel",
  "components/map/gym-members-manager.tsx": "gym owner managing their own roster",
  "lib/rich-text/registry.ts":
    "entityDisplayName falls back across an entity HINT, not a User row. `hint.name` is stamped by resolveDraftEntities on write and re-stamped by hydrateEntities on read, and both pass the row through publicDisplayName first — so an email-shaped name has already become a handle before it reaches this envelope. This is the ONE place the chain is written, precisely so the argument is made once instead of at every card and aria-label that needs a name before its preview has loaded",
  "lib/display-name.ts": "the implementation itself",
  "lib/__tests__/display-name.test.ts": "tests the implementation",
  "lib/__tests__/display-name-usage.test.ts": "this file",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      walk(full, out);
    } else if ([".ts", ".tsx"].includes(extname(entry))) {
      out.push(full);
    }
  }
  return out;
}

test("nothing renders a user's raw name where publicDisplayName is required", () => {
  const offenders: string[] = [];

  for (const file of walk(SRC)) {
    const rel = relative(SRC, file).replace(/\\/g, "/");
    if (ALLOWED[rel]) continue;

    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (line.trim().startsWith("//") || line.trim().startsWith("*")) return;
      if (BYPASS.test(line)) offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
    });
  }

  assert.deepEqual(
    offenders,
    [],
    "These publish User.name directly, which can be an email address.\n" +
      "Use publicDisplayName(user) from @/lib/display-name, or add the file to\n" +
      "ALLOWED in this test WITH the reason it is safe.\n\n" +
      offenders.join("\n"),
  );
});

test("the allow-list only names files that still exist", () => {
  // A stale entry silently re-opens the hole it was documenting.
  const present = new Set(walk(SRC).map((f) => relative(SRC, f).replace(/\\/g, "/")));
  const stale = Object.keys(ALLOWED).filter((f) => !present.has(f));
  assert.deepEqual(stale, [], `Stale allow-list entries: ${stale.join(", ")}`);
});

test("the detector actually matches the shapes that shipped", () => {
  // A guard that matches nothing passes forever. These are the real lines.
  for (const line of [
    `{leader.name ?? leader.username ?? "Anonymous"}`,
    `authorName: t.author.name ?? t.author.username ?? "Member",`,
    `const initial = (r.name ?? r.username ?? "?").slice(0, 1)`,
    `name={u.name ?? u.username}`,
    `u?.name ?? u?.username ?? "Challenger"`,
    `pin.name || pin.person.username`,
  ]) {
    assert.ok(BYPASS.test(line), `should have been flagged: ${line}`);
  }
});

test("the detector does not flag legitimate code", () => {
  for (const line of [
    `const label = event.name ?? "Untitled";`,
    `publicDisplayName({ name: u.name, username: u.username })`,
    `username: user.username,`,
    `fighter.name ?? fighter.slug`,
  ]) {
    assert.equal(BYPASS.test(line), false, `should NOT have been flagged: ${line}`);
  }
});
