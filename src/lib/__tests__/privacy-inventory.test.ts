import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_CATEGORIES, PROCESSORS, COOKIES, activeProcessors, hasOptionalCookies } from "../privacy-inventory";
import { LEGAL_POLICY_VERSION } from "../legal-config";

// ════════════════════════════════════════════════════════════════════════════
//  The privacy notice is GENERATED from this inventory, so these tests are the
//  only thing standing between "we added a feature" and "the notice is false".
//
//  The failure they exist to catch actually happened: direct messages, picks,
//  the location map, follows and push notifications were all built and shipped
//  while the inventory still described a site that had none of them. The notice
//  rendered perfectly and was wrong.
// ════════════════════════════════════════════════════════════════════════════

const SCHEMA = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");

test("every category names the code it was traced from", () => {
  for (const c of DATA_CATEGORIES) {
    assert.ok(c.source.length > 0, `${c.category} has no source`);
    assert.ok(c.lawfulBasis.length > 0, `${c.category} has no lawful basis`);
    assert.ok(c.retention.length > 0, `${c.category} has no retention statement`);
  }
});

test("a category citing a Prisma model cites one that EXISTS", () => {
  // Catches the inventory describing a table that was renamed or dropped —
  // a notice promising a retention rule for storage nobody uses any more.
  const cited = DATA_CATEGORIES.flatMap((c) => {
    const m = c.source.match(/schema\.prisma\s*—\s*([^;]+)/); // stop at ";", which separates a second file
    return m
      ? m[1]
          .split(",")
          .map((s) => s.trim().split(".")[0]) // "User.mapLat" cites model User
          .filter(Boolean)
      : [];
  });
  assert.ok(cited.length > 0, "no category cites a model — the regex has rotted");
  for (const model of cited) {
    assert.match(
      SCHEMA,
      new RegExp(`model\\s+${model}\\s*\\{`),
      `inventory cites model ${model}, which is not in schema.prisma`,
    );
  }
});

// Personal-data-bearing models that MUST be disclosed. Each entry is a model in
// the schema plus the inventory category expected to cover it. Adding a model
// here without a matching category fails, which is the point: the test is the
// checklist someone forgot to run.
const MUST_DISCLOSE: Array<[model: string, expectCategoryMatching: RegExp]> = [
  ["User", /account/i],
  ["DirectMessage", /message/i],
  ["Conversation", /message/i],
  ["FightPick", /prediction|pick/i],
  ["Battle", /prediction|pick/i],
  ["CheckIn", /location/i],
  ["UserFollow", /follow|favourite|favorite/i],
  ["PushSubscription", /notification/i],
  ["AnalyticsEvent", /analytic|usage/i],
  ["ForumPost", /community/i],
  ["AuditLog", /audit/i],
];

test("every personal-data model in the schema is covered by a category", () => {
  for (const [model, expected] of MUST_DISCLOSE) {
    assert.match(SCHEMA, new RegExp(`model\\s+${model}\\s*\\{`), `${model} missing from schema`);
    const covered = DATA_CATEGORIES.some(
      (c) => expected.test(c.category) && c.source.includes(model),
    );
    assert.ok(covered, `${model} holds personal data but no DATA_CATEGORY cites it`);
  }
});

test("the location entry does NOT claim we read device GPS", () => {
  // The design promise: a self-placed pin, never a device location. If someone
  // wires up the geolocation API, this test should be the thing that stops them
  // shipping it against a notice that says we do not.
  const loc = DATA_CATEGORIES.find((c) => /location/i.test(c.category));
  assert.ok(loc, "no location category");
  assert.match(loc.data, /do NOT read your device's GPS/i);
  assert.match(loc.lawfulBasis, /consent/i);
});

test("private messages are honestly described as not end-to-end encrypted", () => {
  const dm = DATA_CATEGORIES.find((c) => /message/i.test(c.category));
  assert.ok(dm, "no messages category");
  assert.match(dm.retention, /NOT END-TO-END ENCRYPTED/i);
});

test("predictions state plainly that no money is involved", () => {
  const picks = DATA_CATEGORIES.find((c) => /prediction/i.test(c.category));
  assert.ok(picks, "no predictions category");
  assert.match(picks.retention, /NO MONEY IS STAKED/i);
});

test("every processor that receives data is marked active with what it gets", () => {
  for (const p of PROCESSORS) {
    assert.ok(p.dataSent.length > 0, `${p.name} does not say what it receives`);
    assert.ok(p.location.length > 0, `${p.name} does not say where it is`);
    if (!p.active) assert.ok(p.note, `${p.name} is inactive but does not explain why`);
  }
  assert.ok(activeProcessors().length > 0);
});

test("the third parties the CSP permits are all disclosed", () => {
  // A host the browser is ALLOWED to contact is a host that may receive an IP
  // address. If the CSP lets it through, the notice has to name it.
  const middleware = readFileSync(join(process.cwd(), "src", "middleware.ts"), "utf8");
  const names = PROCESSORS.map((p) => p.name.toLowerCase()).join(" | ");
  if (middleware.includes("cartocdn")) {
    assert.match(names, /carto/, "CSP allows CARTO tiles but no processor names them");
  }
  if (middleware.includes("flagcdn")) {
    assert.match(names, /flagcdn/, "CSP allows flagcdn but no processor names it");
  }
});

test("no analytics or marketing cookie is claimed while none is set", () => {
  assert.equal(hasOptionalCookies(), false);
  for (const c of COOKIES) {
    assert.ok(["strictly-necessary", "preferences"].includes(c.category));
    assert.match(c.provider, /first-party/i);
  }
});

test("the consent version is a plain ISO date, fixed at accept time", () => {
  assert.match(LEGAL_POLICY_VERSION, /^\d{4}-\d{2}-\d{2}$/);
});

test("the signup route REFUSES an account that did not accept the terms", () => {
  // The guard must live on the server. A client-only tick is a UI affordance:
  // anyone posting straight to the route would create an account having agreed
  // to nothing, and no record would distinguish them afterwards.
  const route = readFileSync(
    join(process.cwd(), "src", "app", "api", "auth", "signup", "route.ts"),
    "utf8",
  );
  assert.match(route, /body\.termsAccepted !== true/, "no server-side terms guard");
  assert.match(route, /TERMS_REQUIRED/);
  assert.match(route, /termsAcceptedAt: new Date\(\)/, "acceptance time is not recorded");
  assert.match(route, /termsVersion: LEGAL_POLICY_VERSION/, "accepted version is not recorded");
});
