import { test, expect, expectHealthy, signIn } from "./fixtures";
import type { Page } from "@playwright/test";

// ════════════════════════════════════════════════════════════════════════════
//  H-2 — anonymous/authenticated feed identity confusion, proven in a browser.
//
//  ── Why this file exists ──────────────────────────────────────────────────
//  The unit and integration suites cover most of H-2, but three cases could
//  only be proven STRUCTURALLY, because `feedKey` reads the session through
//  `cookies()` and `mock.module` is unavailable under the unit runner:
//
//    C  authenticated User A sends cid = User B's id  (read path)
//    G  a query-string cid tries to override the session
//    H  a request-body cid tries to override the session
//
//  A source argument is not evidence that a real session beats a real request
//  parameter. These tests sign in as two seeded accounts through the real login
//  API — genuine session cookies — and attack one from the other.
//
//  They sign IN rather than signing UP: signup is rate limited to 8/hour per IP
//  across the whole suite, and the first version of this file 429'd in a full
//  run while passing in isolation. Login is bounded per email, so two distinct
//  seeded accounts never compete for the same budget.
//
//  ── Why the assertions are about STATE, not status codes ──────────────────
//  `expect(status).toBe(200)` proves nothing here: the endpoint is *supposed*
//  to answer 200. The security property is WHERE the operation executed. Each
//  test therefore plants a uniquely-named marker and then reads it back through
//  the real API as each user — which is a stronger check than inspecting the
//  database, because it exercises the same read path a real client uses.
// ════════════════════════════════════════════════════════════════════════════

// ── Every request runs INSIDE the browser ──────────────────────────────────
// Not `page.request`. The session cookie is `Secure`; Chromium grants
// http://127.0.0.1 the localhost exception and stores it, but Playwright's
// APIRequestContext does not — so `page.request` silently behaves as an
// ANONYMOUS caller even on a signed-in page. That would have made the
// authenticated attack tests meaningless: they would have "passed" by never
// being authenticated at all.
//
// Driving `fetch` through `page.evaluate` also makes this genuine browser
// evidence: the same code path, cookies and CSP a real client runs under.

/** The signed-in user's own id, straight from the session endpoint. */
async function myUserId(page: Page): Promise<string> {
  const user = await page.evaluate(async () => {
    const r = await fetch("/api/auth/me");
    return ((await r.json()) as { user: { id: string } | null }).user;
  });
  expect(user, "expected an authenticated session").not.toBeNull();
  return user!.id;
}

/** Collection names visible to whoever this page is signed in as. */
async function myCollectionNames(page: Page, cid?: string): Promise<string[]> {
  return page.evaluate(async (c) => {
    const qs = c === undefined ? "" : `?cid=${encodeURIComponent(c)}`;
    const r = await fetch(`/api/feed/library${qs}`);
    const b = (await r.json()) as { collections: { name: string }[] };
    return b.collections.map((x) => x.name);
  }, cid);
}

async function createCollection(page: Page, name: string, cid?: string) {
  const status = await page.evaluate(async ([n, c]) => {
    const r = await fetch("/api/feed/library", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(c === undefined ? { action: "create", name: n } : { action: "create", name: n, cid: c }),
    });
    return r.status;
  }, [name, cid] as const);
  expect(status).toBe(200);
}

// Seeded accounts (prisma/seed/e2e.mts). Reused rather than freshly signed up:
// signup is rate limited per IP across the WHOLE suite, login is per email.
const VICTIM_EMAIL = "primary@e2e.local";
const ATTACKER_EMAIL = "rival@e2e.local";

test.describe("H-2 · a request parameter cannot choose whose feed identity is used", () => {
  test("authenticated attacker cannot read or write a victim's feed namespace", async ({ browser, health }) => {
    // ── Two real accounts, two real sessions ──────────────────────────────
    const victimCtx = await browser.newContext();
    const attackerCtx = await browser.newContext();
    const victim = await victimCtx.newPage();
    const attacker = await attackerCtx.newPage();

    try {
      await signIn(victim, VICTIM_EMAIL);
      await signIn(attacker, ATTACKER_EMAIL);

      const victimId = await myUserId(victim);
      const attackerId = await myUserId(attacker);
      expect(victimId).not.toBe(attackerId);

      const VICTIM_MARK = `victim-only-${Date.now()}`;
      const ATTACK_MARK = `planted-by-attacker-${Date.now()}`;

      // The victim owns a uniquely named collection under their own identity.
      await createCollection(victim, VICTIM_MARK);
      expect(await myCollectionNames(victim)).toContain(VICTIM_MARK);

      // ── ATTACK C / G — read, with the victim's id in the query string ────
      // Before the fix, `feedKey` returned `uid ?? fallbackCid`; for a signed-in
      // caller the session already won here, so this asserts the property has
      // not regressed rather than that it was ever broken on this path.
      const stolen = await myCollectionNames(attacker, victimId);
      expect(
        stolen,
        "the attacker read the victim's collections by putting their id in ?cid=",
      ).not.toContain(VICTIM_MARK);

      // ── ATTACK H — write, with the victim's id in the body ───────────────
      await createCollection(attacker, ATTACK_MARK, victimId);

      // The victim's namespace must be untouched: their marker still there, the
      // attacker's marker absent. This is the assertion that matters — it says
      // the write did not execute under the victim's identity.
      const victimAfter = await myCollectionNames(victim);
      expect(victimAfter, "the victim lost their own collection").toContain(VICTIM_MARK);
      expect(
        victimAfter,
        "the attacker's write landed in the VICTIM's namespace — H-2 is open",
      ).not.toContain(ATTACK_MARK);

      // …and it must have landed under the attacker's own identity instead of
      // vanishing. A write that silently no-ops would also pass the check above
      // while breaking the feature.
      expect(
        await myCollectionNames(attacker),
        "the attacker's write went nowhere — the request should still succeed under their own identity",
      ).toContain(ATTACK_MARK);

      // ── Both cid vectors at once ─────────────────────────────────────────
      const BOTH_MARK = `both-vectors-${Date.now()}`;
      const status = await attacker.evaluate(async ([n, v]) => {
        const r = await fetch(`/api/feed/library?cid=${encodeURIComponent(v)}`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "create", name: n, cid: v }),
        });
        return r.status;
      }, [BOTH_MARK, victimId]);
      expect(status).toBe(200);
      expect(
        await myCollectionNames(victim),
        "supplying cid in BOTH the query and the body reached the victim",
      ).not.toContain(BOTH_MARK);
      expect(await myCollectionNames(attacker)).toContain(BOTH_MARK);
    } finally {
      await victimCtx.close();
      await attackerCtx.close();
    }

    expectHealthy(health);
  });

  test("an ANONYMOUS caller cannot reach a signed-in user's namespace", async ({ browser, health }) => {
    // This is the case that was actually exploitable: with no session,
    // `uid ?? fallbackCid` handed the caller's `cid` straight through, and
    // User.id values are published on the public leaderboard.
    const victimCtx = await browser.newContext();
    const anonCtx = await browser.newContext(); // never signs in
    const victim = await victimCtx.newPage();
    const anon = await anonCtx.newPage();

    try {
      await signIn(victim, VICTIM_EMAIL);
      const victimId = await myUserId(victim);

      const MARK = `anon-target-${Date.now()}`;
      await createCollection(victim, MARK);
      expect(await myCollectionNames(victim)).toContain(MARK);

      // The exploit, verbatim: no session, victim's id as the cid.
      await anon.goto("/events");
      const seen = await myCollectionNames(anon, victimId);
      expect(
        seen,
        "an unauthenticated caller read a signed-in user's collections by supplying their id",
      ).not.toContain(MARK);

      // And an anonymous write must not reach them either.
      const ANON_MARK = `anon-write-${Date.now()}`;
      await createCollection(anon, ANON_MARK, victimId);
      expect(
        await myCollectionNames(victim),
        "an anonymous write landed in a signed-in user's namespace — H-2 is open",
      ).not.toContain(ANON_MARK);
      expect(await myCollectionNames(victim)).toContain(MARK);
    } finally {
      await victimCtx.close();
      await anonCtx.close();
    }

    expectHealthy(health);
  });

  test("two anonymous browsers stay isolated from each other", async ({ browser }) => {
    const oneCtx = await browser.newContext();
    const twoCtx = await browser.newContext();
    const one = await oneCtx.newPage();
    const two = await twoCtx.newPage();

    try {
      await one.goto("/events");
      await two.goto("/events");

      const MARK = `anon-one-${Date.now()}`;
      await createCollection(one, MARK, "c_anonbrowserone");
      expect(await myCollectionNames(one, "c_anonbrowserone")).toContain(MARK);
      expect(
        await myCollectionNames(two, "c_anonbrowsertwo"),
        "one anonymous browser can see another's library",
      ).not.toContain(MARK);
    } finally {
      await oneCtx.close();
      await twoCtx.close();
    }
  });
});
