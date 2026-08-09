import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { anonKey, isAnonKey } from "../feed/identity";

// ════════════════════════════════════════════════════════════════════════════
//  H-2 — anonymous feed identity confusion.
//
//  ── The vulnerability ─────────────────────────────────────────────────────
//  `feedKey` returned `uid ?? fallbackCid`, and `fallbackCid` came straight off
//  the query string or JSON body. A signed-in caller was fine — the session
//  wins. An ANONYMOUS caller chose their own storage key, and `User.id` is not
//  a secret: the public leaderboard serves cuid values beside usernames.
//
//  Confirmed against production with a synthetic key: an unauthenticated
//  `GET /api/feed/library?cid=<key>` returned that key's collections, and an
//  unauthenticated `POST /api/feed/prefs` wrote under it.
//
//  ── What is asserted here ─────────────────────────────────────────────────
//  The INVARIANT, not the implementation: no value a client can send is ever
//  interpreted as an authenticated identity. The database-level isolation
//  (User A ≠ User B ≠ anon A ≠ anon B) is proven separately in
//  test/integration/feed-identity.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Real `User.id` values from this application, and the shapes an attacker
 * would actually try. Every one must come back namespaced.
 */
const HOSTILE = [
  "cmsaaddgt000ynt35nh2s67zi", // a real cuid read off the public leaderboard
  "cmsais0td002sny33c4v6p0yi",
  "clx1234567890abcdefghijkl",
  "admin",
  "1",
];

describe("no client-supplied value can become an authenticated identity", () => {
  test("every hostile id lands in the anonymous namespace", () => {
    for (const id of HOSTILE) {
      const key = anonKey(id);
      assert.notEqual(key, id, `anonKey("${id}") returned the raw id — that IS the vulnerability`);
      assert.ok(isAnonKey(key), `anonKey("${id}") produced "${key}", outside the anonymous namespace`);
    }
  });

  test("a namespaced key can never equal a bare user id", () => {
    // The property that makes impersonation unrepresentable rather than merely
    // checked: a `User.id` is a cuid and contains no ":", so no anonymous key
    // can collide with one.
    for (const id of HOSTILE) {
      assert.ok(!anonKey(id).match(/^c[a-z0-9]{20,}$/), "an anonymous key took cuid shape");
    }
  });

  test("echoing a namespaced key back does not create a second namespace", () => {
    // A client handed `anon:c_abc` and sending it back must resolve to the same
    // row space, not `anon:anon:c_abc`.
    const once = anonKey("c_abc12345");
    assert.equal(anonKey(once), once, "a round-tripped key changed identity");
    assert.ok(!once.slice("anon:".length).includes(":"), "the key was double-prefixed");
  });

  test("junk, empty and oversized ids collapse to the shared bucket, never to a user", () => {
    for (const bad of ["", "   ", null, undefined, "a", "x".repeat(200), "has space", "semi;colon", "../../etc"]) {
      const key = anonKey(bad as string);
      assert.ok(isAnonKey(key), `"${String(bad)}" escaped the anonymous namespace as "${key}"`);
    }
  });

  test("the shared bucket is itself inside the namespace", () => {
    // Pre-existing behaviour collapsed a missing id to the literal "anon",
    // which sat in the SAME row space as user ids. It must not any more.
    const shared = anonKey(null);
    assert.ok(isAnonKey(shared));
    assert.notEqual(shared, "anon", "the shared bucket is still a bare key");
  });
});

// ── Static: no route may bypass the resolver ────────────────────────────────

const SRC = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e.startsWith(".")) continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else if ([".ts", ".tsx"].includes(extname(e))) out.push(full);
  }
  return out;
}

const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const rel = (f: string) => relative(SRC, f).replace(/\\/g, "/");
const body = new Map(
  walk(SRC).filter((f) => !rel(f).includes("__tests__")).map((f) => [rel(f), strip(readFileSync(f, "utf8"))]),
);

describe("every feed route resolves identity through the one trusted path", () => {
  const feedRoutes = [...body].filter(([p]) => p.startsWith("app/api/feed/") && p.endsWith("route.ts"));

  test("the feed API surface is actually being scanned", () => {
    assert.ok(feedRoutes.length >= 5, `only ${feedRoutes.length} feed routes found — the scan is not covering them`);
  });

  test("no feed route uses a caller-supplied id without the resolver", () => {
    const offenders: string[] = [];
    for (const [path, src] of feedRoutes) {
      // A route that never mentions cid is fine. One that reads cid MUST hand
      // it to feedKey and must not use the raw value anywhere else.
      const readsCid = /\bcid\b/.test(src);
      if (!readsCid) continue;
      if (!/feedKey\s*\(/.test(src)) { offenders.push(`${path} (reads cid, never calls feedKey)`); continue; }
      // The raw value may appear only as the ARGUMENT to feedKey.
      const rawUses = [...src.matchAll(/[^\w.]cid\b/g)].length;
      const inResolver = [...src.matchAll(/feedKey\s*\([^)]*cid/g)].length;
      // Allow the destructure/read plus the resolver call; more than that means
      // the raw id is being used for something else.
      if (rawUses > inResolver + 3) offenders.push(`${path} (raw cid used ${rawUses}× for ${inResolver} resolver call(s))`);
    }
    assert.deepEqual(
      offenders, [],
      "these feed routes may use a caller-supplied identity directly:\n  " + offenders.join("\n  "),
    );
  });

  test("nothing outside the resolver turns a request value into a feed key", () => {
    // `dbPersistServed`/`dbHydrateUser` take a key. Any caller passing something
    // request-derived rather than session-derived reintroduces H-2.
    const offenders: string[] = [];
    for (const [path, src] of body) {
      if (path === "lib/feed/identity.ts" || path.startsWith("lib/feed/repo") || path.startsWith("lib/feed/users")) continue;
      for (const m of src.matchAll(/db(?:PersistServed|HydrateUser|PersistHidden|PersistNotInterested|PersistInterest)\(\s*([A-Za-z_$][\w.]*)/g)) {
        const arg = m[1];
        // Session-derived names are fine; a raw `cid`/`body.…`/`q.get(…)` is not.
        if (/^(userId|key|uid)$/.test(arg)) continue;
        offenders.push(`${path} → passes "${arg}"`);
      }
    }
    assert.deepEqual(
      offenders, [],
      "these call sites feed persistence with a non-session identity:\n  " + offenders.join("\n  "),
    );
  });

  test("feedKey NEVER returns the caller's value on any path", () => {
    // ── Why this test exists in this exact form ─────────────────────────────
    // The first version of this suite tested `anonKey()` directly and asserted
    // the static rules around it — and PASSED against a deliberately
    // reintroduced `return fallbackCid`. It was vacuous: `anonKey` was never
    // the vulnerable function. `feedKey` was.
    //
    // `feedKey` cannot be called in a unit test (it reads the session through
    // `cookies()`), so the invariant is asserted against its body: every return
    // is either the session uid or a value that has been through `anonKey`. A
    // bare `return fallbackCid` — the vulnerability, verbatim — fails here.
    const src = body.get("lib/feed/identity.ts")!;
    const start = src.indexOf("export async function feedKey");
    assert.ok(start > -1, "feedKey is gone");
    const fn = src.slice(start, src.indexOf("\n}", start));

    const returns = [...fn.matchAll(/return\s+([^;]+);/g)].map((m) => m[1].trim());
    assert.ok(returns.length > 0, "feedKey has no returns — the scan is broken");

    for (const r of returns) {
      const safe = /^uid$/.test(r) || /^anonKey\(/.test(r);
      assert.ok(
        safe,
        `feedKey returns "${r}". Every path must return the session uid or anonKey(...) — ` +
          "returning a caller-supplied value IS H-2.",
      );
    }
    assert.ok(
      returns.some((r) => r.startsWith("anonKey(")),
      "feedKey no longer routes the anonymous path through anonKey",
    );
  });

  test("an authenticated session short-circuits BEFORE the caller's id is consulted", () => {
    // ── ATTACK C / G / H ────────────────────────────────────────────────────
    //   C: authenticated User A sends cid = User B's id
    //   G: query-string cid tries to override the session
    //   H: request-body cid tries to override the session
    // All three reduce to one property: when a session exists, `fallbackCid` is
    // never read.
    //
    // Asserted STRUCTURALLY, not behaviourally, and the limitation is recorded
    // deliberately: `feedKey` resolves the session through `cookies()`, and
    // `mock.module` is unavailable under this runner (verified), so the
    // authenticated branch cannot be exercised in a unit test. What is checked
    // is that the session return precedes any use of the caller's value — which
    // is the whole of the property, given the earlier test already proves every
    // return is `uid` or `anonKey(...)`.
    const src = body.get("lib/feed/identity.ts")!;
    const start = src.indexOf("export async function feedKey");
    const fn = src.slice(start, src.indexOf("\n}", start));

    const shortCircuit = fn.indexOf("if (uid) return uid;");
    assert.ok(shortCircuit > -1, "feedKey no longer short-circuits on an authenticated session");

    // `fallbackCid` may appear only AFTER that return — i.e. on the anonymous
    // path. Its declaration in the signature is excluded from the search.
    const afterSignature = fn.indexOf(")", fn.indexOf("feedKey("));
    const firstUse = fn.indexOf("fallbackCid", afterSignature);
    assert.ok(
      firstUse > shortCircuit,
      "feedKey reads the caller-supplied id before returning the session identity — " +
        "a signed-in user's key could be influenced by their request",
    );
  });

  test("the resolver never returns the caller's value on the error path", () => {
    // The original code had `catch { return fallbackCid }` — a request that
    // could induce a session error got to name its own identity. Same hole,
    // second route in.
    const src = body.get("lib/feed/identity.ts")!;
    const fn = src.slice(src.indexOf("export async function feedKey"));
    const catchBlock = fn.slice(fn.indexOf("catch"), fn.indexOf("}", fn.indexOf("catch")) + 1);
    assert.ok(
      !/return\s+fallbackCid/.test(catchBlock),
      "feedKey returns the caller's id when the session lookup throws",
    );
  });
});
