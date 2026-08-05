// Guard against the auth race coming back.
//
// Six components independently wrote `if (!user) { location.href = "/account" }`,
// which treats "auth has not resolved yet" as "signed out" and hard-redirects a
// signed-in user off the page mid-tap. The fix is `useAuthGate()`; this test is
// what stops a seventh component from re-deriving the broken version.
//
// A static check rather than a runtime one because the bug is a MISSING read of
// `loading` — there is no runtime state to assert on a component that never
// asked the question.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const SRC = join(process.cwd(), "src");

/**
 * Components that take a `signedIn`/`requireAuth` BOOLEAN PROP rather than
 * calling useAuth() themselves. The race, if any, lives in whatever computes
 * that prop — these files have no auth state of their own to consult, so the
 * gate does not apply to them. Listed explicitly so the exemption is a decision
 * rather than a gap.
 */
const PROP_DRIVEN = new Set([
  "components/feed/alerts-toggle.tsx",
  "components/map/gym-membership.tsx",
  "components/forums/reaction-bar.tsx",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next" || entry === "__tests__") continue;
      walk(full, out);
    } else if ([".ts", ".tsx"].includes(extname(entry))) out.push(full);
  }
  return out;
}

test("nothing redirects to /account without first checking whether auth has resolved", () => {
  const offenders: string[] = [];

  for (const file of walk(SRC)) {
    const rel = file.slice(SRC.length + 1).replace(/\\/g, "/");
    if (rel === "lib/auth-client.tsx") continue;          // the implementation
    if (PROP_DRIVEN.has(rel)) continue;

    const text = readFileSync(file, "utf8");
    if (!/location\.href\s*=\s*["'`]\/account/.test(text)) continue;

    // Reaching for the redirect is fine — but only through the gate, or after
    // explicitly consulting `loading`.
    const usesGate = /useAuthGate|requireSignIn/.test(text);
    const readsLoading = /\bloading\b/.test(text);
    if (!usesGate && !readsLoading) offenders.push(rel);
  }

  assert.deepEqual(
    offenders,
    [],
    "These redirect to /account without knowing whether auth has finished loading, so a\n" +
      "signed-in user who taps during hydration is thrown off the page.\n" +
      "Use `useAuthGate()` from @/lib/auth-client:\n" +
      "    if (gate.requireSignIn() !== \"OK\") return;\n\n" +
      offenders.join("\n"),
  );
});

test("useAuthGate exists and is exported from the auth client", () => {
  const src = readFileSync(join(SRC, "lib/auth-client.tsx"), "utf8");
  assert.ok(/export function useAuthGate/.test(src), "the gate must live beside the state it reads");
  assert.ok(/return "PENDING"/.test(src), "pending must be a distinct outcome, not a falsy user");
});
