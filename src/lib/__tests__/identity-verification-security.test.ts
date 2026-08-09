import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { isAdminRole } from "../admin/roles";

// ════════════════════════════════════════════════════════════════════════════
//  IDENTITY VERIFICATION — the security properties, asserted.
//
//  The feature was already built to its spec: private-bucket storage, magic-byte
//  validation, EXIF stripping, malware scanning, uniform 404s, retention
//  deletion, an audit row per decision. What it did NOT have was anything that
//  FAILS when one of those properties is removed.
//
//  ── Why these are source assertions ───────────────────────────────────────
//  Three of the properties below are structural: "no OTHER file may do X". That
//  is not a statement a runtime test can make — a runtime test can only prove
//  the paths it thought to call, and the risk here is precisely the path nobody
//  thought of. A new route that selects `storageKey` into a JSON response is a
//  leak the moment it is written, and no existing test would fail.
//
//  Where a property IS runtime-checkable from a pure module (isAdminRole), it is
//  checked that way instead. The transactional guarantees — approval writes a
//  reviewer, a timestamp and an audit row together; a decline without a reason
//  is refused — need a database and belong in test/integration.
//
//  Each test says what it proves and, just as importantly, what it does not.
// ════════════════════════════════════════════════════════════════════════════

const SRC = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if ([".ts", ".tsx"].includes(extname(entry))) out.push(full);
  }
  return out;
}

/** Strip comments so prose ABOUT a rule is never read as a violation of it. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const rel = (f: string) => relative(SRC, f).replace(/\\/g, "/");
const ALL = walk(SRC).filter((f) => !rel(f).includes("__tests__"));
const body = new Map(ALL.map((f) => [rel(f), stripComments(readFileSync(f, "utf8"))]));

// ── 12 / 13 · registryRole grants nothing ──────────────────────────────────

describe("registryRole cannot grant admin or verification", () => {
  test("the staff predicate reads `role`, and no value of registryRole satisfies it", () => {
    // Runtime, not source: isAdminRole is a pure leaf module, so the actual
    // question can be asked directly rather than pattern-matched.
    for (const label of [
      "fan", "fighter", "world-champion", "coach", "manager", "referee", "medic",
      "gym", "organisation", "promoter", "media", "photographer", "announcer",
      // The shapes someone would try if they were attacking it.
      "admin", "ADMIN", "moderator", "MODERATOR", "Admin",
    ]) {
      if (label === "ADMIN" || label === "MODERATOR") continue; // those ARE User.role values
      assert.equal(
        isAdminRole(label), false,
        `isAdminRole("${label}") is true — a self-declared signup label must never be staff`,
      );
    }
    assert.equal(isAdminRole("ADMIN"), true);
    assert.equal(isAdminRole("MODERATOR"), true);
  });

  test("verification is granted by a reviewer, never derived from the signup label", () => {
    const svc = body.get("lib/identity-verification.ts");
    assert.ok(svc, "lib/identity-verification.ts is gone — this suite is testing nothing");
    // `professionalVerifiedAt` is the column the badge derives from. It must be
    // written in the review path and nowhere near a registryRole comparison.
    assert.ok(
      /professionalVerifiedAt:\s*now/.test(svc),
      "approval no longer stamps professionalVerifiedAt — the badge has decoupled from the decision",
    );
    assert.ok(
      !/registryRole\s*===\s*['"`]\w+['"`]\s*(?:&&|\|\|)?\s*.*professionalVerifiedAt/.test(svc),
      "the verified state is being derived from registryRole",
    );
  });
});

// ── 1 / 2 · admin surfaces are guarded server-side ─────────────────────────

describe("admin surfaces refuse non-staff in the service layer, not the UI", () => {
  test("every /api/admin route requires staff, or is an explicitly machine-authenticated route", () => {
    const offenders: string[] = [];
    for (const [path, src] of body) {
      if (!path.startsWith("app/api/admin/") || !path.endsWith("route.ts")) continue;
      const staffGuarded = /requireAdminApi|isAdminRole/.test(src);
      // A cron/ops route authenticates a MACHINE with a bearer secret. That is a
      // different principal, not a missing check — but it must be visible here.
      const machineGuarded = /process\.env\.\w*(?:TOKEN|SECRET)\b/.test(src) && /Bearer/.test(src);
      if (!staffGuarded && !machineGuarded) offenders.push(path);
    }
    assert.deepEqual(
      offenders, [],
      "admin API routes with neither a staff guard nor a bearer-token principal:\n  " + offenders.join("\n  "),
    );
  });

  test("the admin page tree is guarded at its layout, and that layout still guards", () => {
    const layout = body.get("app/admin/layout.tsx");
    assert.ok(layout, "src/app/admin/layout.tsx is gone — every admin page below it just lost its guard");
    assert.ok(
      /requireAdminPage\s*\(/.test(layout),
      "the admin layout no longer calls requireAdminPage. Nested pages rely on it; " +
        "most of them carry no check of their own.",
    );
  });

  test("nobody re-implements the staff predicate", () => {
    // The bug this catches, verbatim, from app/admin/analytics/page.tsx:
    //     const isAdmin = (role: string) => role === "ADMIN" || role === "MODERATOR";
    // It was CORRECT, which is the point — a second copy agrees right up until
    // the day the rule changes in one place. There were once six.
    const INLINE = /['"`]ADMIN['"`]\s*(?:={2,3}|!={1,2})?[\s\S]{0,40}?\|\|[\s\S]{0,40}?['"`]MODERATOR['"`]/;
    const offenders: string[] = [];
    for (const [path, src] of body) {
      if (path === "lib/admin/roles.ts") continue; // THE definition
      if (INLINE.test(src)) offenders.push(path);
    }
    assert.deepEqual(
      offenders, [],
      "these files spell out the staff rule instead of importing isAdminRole:\n  " + offenders.join("\n  "),
    );
  });
});

// ── The console is reachable, and only by staff ────────────────────────────

describe("the admin console can be found without knowing a URL", () => {
  test("/admin is a real page, not a 404", () => {
    // It was a 404. The tree had a layout and seven leaf pages and no index, so
    // the console had no front door and no way to see that somebody was waiting
    // on a decision without opening each queue and counting.
    assert.ok(
      body.has("app/admin/page.tsx"),
      "src/app/admin/page.tsx is gone — /admin 404s and the console has no landing page again",
    );
  });

  test("the overview links to both operator surfaces", () => {
    const page = body.get("app/admin/page.tsx")!;
    for (const href of ["/admin/identity-verification", "/admin/analytics"]) {
      assert.ok(page.includes(href), `the admin overview no longer links to ${href}`);
    }
  });

  test("every destination the admin nav offers exists", () => {
    // A nav entry pointing at a route that was renamed is a 404 the operator
    // finds by clicking it.
    const layout = body.get("app/admin/layout.tsx")!;
    const hrefs = [...layout.matchAll(/href:\s*["'](\/admin[^"']*)["']/g)].map((m) => m[1]);
    assert.ok(hrefs.length >= 5, "the admin nav lost most of its entries");
    for (const href of hrefs) {
      const seg = href.replace(/^\/admin\/?/, "");
      const file = seg ? `app/admin/${seg}/page.tsx` : "app/admin/page.tsx";
      assert.ok(body.has(file), `the admin nav points at ${href}, but ${file} does not exist`);
    }
  });

  test("the account menu's admin section is gated, and points at the right queues", () => {
    const menu = body.get("components/layout/account-menu.tsx")!;
    assert.ok(/isAdminRole\s*\(/.test(menu), "the account menu no longer uses the shared staff predicate");
    assert.ok(/\{isAdmin\s*&&/.test(menu), "the admin section is no longer gated on isAdmin");

    // The bug: "Verification" in this menu used to point at /admin/claims,
    // which is FIGHTER CLAIMS — a different queue, different documents,
    // different decision. Identity verification and analytics had no entry
    // point at all, so the only way in was to already know the URL.
    for (const href of ["/admin", "/admin/identity-verification", "/admin/analytics"]) {
      assert.ok(menu.includes(`"${href}"`), `the account menu no longer offers ${href}`);
    }
  });

  test("hiding the links is discoverability, never the access control", () => {
    // The menu is a client component: its `isAdmin` is a rendering decision and
    // an attacker simply types the URL. What actually refuses them is the
    // server-side guard — see the page-level test below, which is the one that
    // matters. This only asserts the layout has not silently lost its check.
    const layout = body.get("app/admin/layout.tsx")!;
    assert.ok(
      /requireAdminPage\s*\(/.test(layout),
      "the admin layout stopped guarding",
    );
  });

  test("EVERY server admin page guards itself — the layout is not enough", () => {
    // ── The bug, verified against production ────────────────────────────────
    // An earlier version of this suite asserted only that the LAYOUT guards,
    // on the assumption that it covered the tree. It does not, and the proof
    // was a plain anonymous request:
    //
    //     $ curl https://…/admin
    //     200, and the flight payload contained \"children\":\"7\"
    //     immediately before \"Registered accounts\"
    //
    // A layout and its page render in PARALLEL. `notFound()` in the layout
    // swaps the UI for the 404 boundary; it does not cancel the sibling page,
    // which has already run its queries and streamed the results. So the layout
    // is a UI guard and never was a data guard, and seven server pages under
    // /admin — including the identity queue, with applicant names and emails —
    // were serialising query results to anonymous callers.
    //
    // A CLIENT page ("use client") is exempt: it ships markup and fetches from
    // /api/admin/*, which guards per route and is covered by the API test above.
    const offenders: string[] = [];
    for (const [path, src] of body) {
      if (!path.startsWith("app/admin/") || !path.endsWith("page.tsx")) continue;
      const isClient = /^\s*["']use client["']/.test(src);
      if (isClient) continue;
      if (!/await\s+requireAdminPage\s*\(\s*\)/.test(src)) offenders.push(path);
    }
    assert.deepEqual(
      offenders, [],
      "these server admin pages run queries with no guard of their own. The layout does NOT stop " +
        "them — it renders in parallel. Add `await requireAdminPage()` as the first statement:\n  " +
        offenders.join("\n  "),
    );
  });
});

// ── 3 / 9 / 10 / 16 · document bytes and their keys never leak ─────────────

describe("identity documents cannot be reached except through the audited reader", () => {
  const READER = "app/api/admin/identity-verification/[id]/document/[docId]/route.ts";

  test("the reader exists and is owner-or-staff only", () => {
    const src = body.get(READER);
    assert.ok(src, `${READER} is gone`);
    assert.ok(/isAdminRole\s*\(/.test(src), "the reader no longer checks staff");
    assert.ok(/userId\s*===\s*user\.id/.test(src), "the reader no longer checks ownership");
  });

  test("the reader is a uniform 404 — it is not an existence oracle", () => {
    const src = body.get(READER)!;
    // A 403 would confirm that a given verification id is real, which turns id
    // enumeration into a list of who has uploaded a passport.
    assert.ok(
      !/status:\s*403/.test(src),
      "the reader returns a 403 somewhere. Anonymous, stranger, wrong id and missing row must be indistinguishable.",
    );
  });

  test("document bytes are never cached", () => {
    const src = body.get(READER)!;
    assert.ok(/no-store/.test(src), "cache-control lost no-store — an ID document would persist in the reviewer's disk cache");
    assert.ok(/private/.test(src), "cache-control lost `private` — a shared proxy may now hold an ID document");
  });

  test("storage keys never leave the server", () => {
    // A key is the only secret protecting the object. It may be handled by the
    // storage layer, the service that writes it and the reader that resolves it
    // — and by nothing that builds a response for a user.
    const ALLOWED = new Set([
      READER,
      "lib/identity-verification.ts",
      // The claim uploaders write their own evidence keys through the same store.
      "app/api/fighters/[slug]/claim/upload/route.ts",
      "app/api/gyms/[slug]/claim/evidence/route.ts",
    ]);
    const offenders: string[] = [];
    for (const [path, src] of body) {
      if (path.startsWith("lib/evidence/")) continue; // the storage layer itself
      if (ALLOWED.has(path)) continue;
      if (/\bstorageKey\b/.test(src)) offenders.push(path);
    }
    assert.deepEqual(
      offenders, [],
      "these files touch a storage key and are not the store, the service or the reader:\n  " + offenders.join("\n  "),
    );
  });

  test("the user's own history hands back no key and no staff note", () => {
    const svc = body.get("lib/identity-verification.ts")!;
    const fn = svc.slice(svc.indexOf("export async function myVerifications"));
    const select = fn.slice(0, fn.indexOf("\n}"));
    assert.ok(!/storageKey/.test(select), "myVerifications now selects storageKey");
    assert.ok(!/reviewNote/.test(select), "myVerifications now selects reviewNote — that is staff-only");
    assert.ok(/declineReason/.test(select), "myVerifications stopped returning the user-facing reason");
  });
});

// ── 5 / 11 · status is not client-writable ─────────────────────────────────

describe("verification status cannot be set by the applicant", () => {
  test("exactly one module mutates IdentityVerification", () => {
    const writers = [...body].filter(([, src]) =>
      /identityVerification\.(?:update|updateMany|upsert|create|createMany|delete)/.test(src),
    ).map(([path]) => path);
    assert.deepEqual(
      writers, ["lib/identity-verification.ts"],
      "IdentityVerification is written outside its service. Status transitions must go through " +
        "reviewVerification, which is the only place that also writes the reviewer, the timestamp and the audit row.",
    );
  });

  test("the user-facing route submits documents and cannot carry a status", () => {
    const route = body.get("app/api/verification/identity/route.ts");
    assert.ok(route, "the user verification route is gone");
    assert.ok(
      !/\bstatus\b\s*[:=][^;]*(?:body|json|form|req)\b/.test(route),
      "the submit route reads a status off the request",
    );
    assert.ok(/getCurrentUser\s*\(/.test(route), "the submit route no longer authenticates");
  });
});

// ── 14 / 15 · identity is not ownership ────────────────────────────────────

describe("verifying a person does not grant them an organisation", () => {
  test("approval writes no ownership of any kind", () => {
    // John proving he is John does not make him the owner of UFC. Ownership is a
    // separate claim → evidence → decision, and it lives in the promoter and gym
    // capability systems. If approval ever starts writing an ownerId, the two
    // concepts have been merged and the claim flow has been bypassed.
    const svc = body.get("lib/identity-verification.ts")!;
    for (const forbidden of [/\bownerId\b/, /promoterClaim/i, /gymClaim/i, /\bpromotion\.update/, /\bgym\.update/]) {
      assert.ok(
        !forbidden.test(svc),
        `lib/identity-verification.ts matches ${forbidden} — identity verification is granting ownership`,
      );
    }
  });

  test("the promoter capability system is still the authority on promoter powers", () => {
    const v = body.get("lib/promoter/verification.ts");
    assert.ok(v, "the promoter capability module is gone");
    assert.ok(
      !/professionalVerifiedAt/.test(v),
      "promoter capability now reads the identity badge. A verified identity is not evidence of " +
        "controlling a promotion — that decision belongs to the claim flow.",
    );
  });
});
