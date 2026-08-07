// The landing page's copy and routing, tested as data.
//
// A marketing page fails in ways a rendering test never catches: a CTA that
// points at a route nobody built, a claim the product cannot support, a role
// advertised that the sign-up form does not offer, a gambling word that walks
// the product into a Play Store policy question. Every one of those is a
// property of the CONSTANTS, so every one of them is checked here — statically,
// with no browser and no database.
//
// The route existence check is the load-bearing one: it reads the App Router's
// own directory tree, so a link on this page cannot outlive the page it points
// at, and nobody has to remember to update a list.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";

import {
  ROUTES, CTA, NAV, HERO, STAGES, STORY_HEADING, ECOSYSTEM, WINDOWS,
  PERSONAL, ROLE_LABELS, TRUST, FINAL, META, SKILL_NOT_BETTING,
} from "@/components/home-landing/content";
import { REGISTRY_ROLE_DEFS } from "@/lib/roles";
import { EVENTS } from "@/lib/analytics";

const APP = path.join(process.cwd(), "src", "app");

/** Does the App Router actually serve this path? */
function routeExists(href: string): boolean {
  const pathname = href.split("?")[0];
  if (pathname === "/") return existsSync(path.join(APP, "page.tsx"));
  const dir = path.join(APP, ...pathname.replace(/^\//, "").split("/"));
  return existsSync(path.join(dir, "page.tsx"));
}

// ── Links ────────────────────────────────────────────────────────────────────

test("every route the landing page links to is a real App Router page", () => {
  for (const [name, href] of Object.entries(ROUTES)) {
    assert.ok(routeExists(href), `ROUTES.${name} → ${href} has no page.tsx`);
  }
});

test("every nav item and product-preview window points at a real route", () => {
  for (const item of NAV) assert.ok(routeExists(item.href), `nav "${item.label}" → ${item.href}`);
  for (const w of WINDOWS) assert.ok(routeExists(w.href), `window "${w.id}" → ${w.href}`);
  for (const l of TRUST.links) assert.ok(routeExists(l.href), `trust link "${l.label}" → ${l.href}`);
});

test("both CTAs use the real account route, and signup carries a return path", () => {
  assert.ok(ROUTES.signup.startsWith("/account"), "primary CTA must open the account route");
  assert.ok(ROUTES.signup.includes("next="), "signup must carry a return path");
  assert.ok(ROUTES.signin.startsWith("/account"), "sign-in must open the account route");
  assert.ok(ROUTES.signin.includes("mode=signin"), "sign-in must open the account route in sign-in mode");
  // The account page reads `?next=` through safeRedirectPath, so it must be a
  // same-origin PATH — an absolute URL would be rejected and silently dropped.
  const next = new URLSearchParams(ROUTES.signup.split("?")[1]).get("next");
  assert.ok(next?.startsWith("/") && !next.startsWith("//"), `next must be a same-origin path, got ${next}`);
});

test("there is no waitlist and no email capture — the account flow already exists", () => {
  const all = JSON.stringify({ ROUTES, CTA, HERO, FINAL, PERSONAL });
  assert.ok(!/waitlist|early access|join the list|notify me/i.test(all), "no waitlist language");
});

// ── Claims ───────────────────────────────────────────────────────────────────

test("no empty superlatives", () => {
  const prose = JSON.stringify({ HERO, STAGES, ECOSYSTEM, WINDOWS, PERSONAL, TRUST, FINAL, META, STORY_HEADING });
  for (const banned of [
    "revolutionary", "ultimate", "game-changing", "game changing", "world-class",
    "cutting-edge", "next-generation", "unrivalled", "unrivaled", "best-in-class",
  ]) {
    assert.ok(!new RegExp(banned, "i").test(prose), `"${banned}" is an empty claim`);
  }
});

test('"all in one place" is not repeated — the headline says it once', () => {
  const prose = JSON.stringify({ HERO, STAGES, ECOSYSTEM, PERSONAL, TRUST, FINAL });
  const hits = prose.match(/in one place/gi) ?? [];
  assert.ok(hits.length <= 1, `"in one place" appears ${hits.length} times`);
});

test("no gambling presentation anywhere in the copy", () => {
  for (const banned of [
    "\\bbet\\b", "\\bbets\\b", "\\bbetting\\b", "\\bodds\\b", "\\bstake\\b", "\\bwager",
    "deposit", "withdraw", "payout", "bookmaker", "sportsbook", "cash out",
  ]) {
    const re = new RegExp(banned, "i");
    // "No betting" in the final reassurance is the one legitimate use: it is a
    // denial, and denying it is the opposite of presenting it.
    const offenders = [HERO.support, HERO.micro, ...STAGES.map((s) => `${s.headline} ${s.support}`), FINAL.support]
      .filter((s) => re.test(s));
    assert.deepEqual(offenders, [], `${banned} appears in: ${offenders.join(" | ")}`);
  }
  assert.equal(FINAL.reassurance.includes("No betting"), true, "the denial itself must stay");
  assert.equal(SKILL_NOT_BETTING, "Skill, not betting.");
});

test("no fabricated statistics, ratings or partnerships in the copy", () => {
  const prose = JSON.stringify({ HERO, STAGES, ECOSYSTEM, WINDOWS, PERSONAL, TRUST, FINAL, META });
  // A bare number followed by a scale word is how a fake stat reads.
  assert.ok(!/\b\d[\d,.]*\s*(k|m|million|thousand|\+)\s*(members|users|fans|fighters|events)/i.test(prose));
  assert.ok(!/\b(trusted by|official partner|in partnership with|as seen on|rated \d)/i.test(prose));
  // The trust section must not overclaim.
  const trust = JSON.stringify(TRUST);
  assert.ok(!/\b(guarantee|100% accurate|verified by|certified|official)\b/i.test(trust), "trust copy must not overclaim");
});

// ── Hierarchy ────────────────────────────────────────────────────────────────

const words = (s: string) => s.trim().split(/\s+/).length;

test("headlines stay under eight words", () => {
  const headlines = [
    ...HERO.headline,
    ...STAGES.map((s) => s.headline),
    ECOSYSTEM.headline,
    PERSONAL.headline, PERSONAL.industry.copy,
    TRUST.headline,
    FINAL.headline,
    ...WINDOWS.map((w) => w.copy),
  ];
  for (const h of headlines) assert.ok(words(h) < 8, `"${h}" is ${words(h)} words`);
});

test("the one nine-word heading is the brief's own mandated line", () => {
  // "Follow what matters. Build a record that is yours." is specified verbatim,
  // and it is two four-word imperatives rather than a long headline — it scans
  // as one beat. Pinned exactly so a future edit that lengthens it fails here
  // instead of quietly raising the ceiling for every other heading.
  assert.equal(PERSONAL.fan.copy, "Follow what matters. Build a record that is yours.");
  assert.equal(words(PERSONAL.fan.copy), 9);
});

test("supporting copy stays under twenty-five words", () => {
  const support = [
    HERO.support, HERO.micro,
    ...STAGES.map((s) => s.support),
    ECOSYSTEM.support,
    ...TRUST.principles.map((p) => p.copy),
    FINAL.support, FINAL.reassurance,
    META.description,
  ];
  for (const s of support) assert.ok(words(s) <= 25, `"${s}" is ${words(s)} words`);
});

test("no supporting paragraph runs to more than two sentences", () => {
  // FINAL.support is excluded and pinned below: it is four two-to-four-word
  // imperatives, which is a cadence rather than a paragraph, and it is specified
  // verbatim by the brief.
  const support = [HERO.support, ECOSYSTEM.support, ...STAGES.map((s) => s.support)];
  for (const s of support) {
    // Decimal points and abbreviations are not sentence ends; these strings have
    // neither, so counting terminators is exact here.
    const sentences = s.split(/[.!?]+\s/).filter(Boolean).length;
    assert.ok(sentences <= 2, `"${s}" is ${sentences} sentences`);
  }
});

test("the final CTA's four-beat cadence stays short and stays four beats", () => {
  const beats = FINAL.support.split(".").map((s) => s.trim()).filter(Boolean);
  assert.equal(beats.length, 4, "four imperatives, not a paragraph");
  for (const b of beats) assert.ok(words(b) <= 4, `"${b}" is ${words(b)} words — a beat, not a sentence`);
});

// ── Structure ────────────────────────────────────────────────────────────────

test("the story is four stages, each with a distinct id and a screen-reader description", () => {
  assert.equal(STAGES.length, 4);
  assert.equal(new Set(STAGES.map((s) => s.id)).size, 4, "stage ids must be unique");
  for (const s of STAGES) {
    assert.ok(s.visualLabel.length > 40, `stage "${s.id}" needs a real description of its visual`);
    assert.match(s.label, /^0[1-4] — /, `stage "${s.id}" label must be numbered`);
  }
  // The numbering has to match the order, or the progress indicator lies.
  STAGES.forEach((s, i) => assert.ok(s.label.startsWith(`0${i + 1}`), `${s.label} is out of order`));
});

test("the ecosystem is four windows, each with a link and a label", () => {
  assert.equal(WINDOWS.length, 4);
  assert.equal(new Set(WINDOWS.map((w) => w.id)).size, 4);
  for (const w of WINDOWS) assert.ok(w.linkLabel.length > 0, `window "${w.id}" needs a link label`);
});

test("the role selector cannot advertise a role the sign-up form does not offer", () => {
  const offered = new Set(REGISTRY_ROLE_DEFS.map((r) => r.label));
  for (const label of ROLE_LABELS) {
    assert.ok(offered.has(label), `"${label}" is not a role the account form accepts`);
  }
  assert.equal(ROLE_LABELS.length, REGISTRY_ROLE_DEFS.length, "the list must be derived, not retyped");
});

test("the eight sports named in the hero are sports the product carries", () => {
  const named = HERO.sports.split("·").map((s) => s.trim().toLowerCase());
  assert.equal(named.length, 8);
  // Every one of these has a Sport enum value or is the plain-English name for a
  // group of them ("grappling" covers BJJ and no-gi).
  const known = ["mma", "boxing", "muay thai", "kickboxing", "bare knuckle", "grappling", "wrestling", "judo"];
  assert.deepEqual(named, known);
});

// ── Metadata and instrumentation ─────────────────────────────────────────────

test("metadata is present and the title is not truncated by a template", () => {
  assert.ok(META.title.includes("Combat Reviews"), "the product name must be in the title");
  assert.ok(META.title.length <= 70, `title is ${META.title.length} chars — search results truncate near 60-70`);
  assert.ok(META.description.length >= 110 && META.description.length <= 165,
    `description is ${META.description.length} chars — aim for 110-165`);
});

test("every landing analytics name is in the shared allow-list", () => {
  // /api/track drops any name that is not in EVENTS, so a name emitted by the
  // page but missing here is instrumentation that silently records nothing.
  const emitted = [
    "home_landing_view", "home_primary_cta_clicked", "home_secondary_cta_clicked",
    "home_story_stage_viewed", "home_product_preview_clicked", "home_signup_started",
  ];
  for (const name of emitted) {
    assert.ok((EVENTS as readonly string[]).includes(name), `"${name}" is not in EVENTS`);
  }
  // Completion stays the existing `signup` event — one name per fact.
  assert.ok((EVENTS as readonly string[]).includes("signup"));
  assert.ok(!(EVENTS as readonly string[]).includes("home_signup_completed"),
    "signup completion is already `signup`; a second name would double-count it");
});

test("the primary CTA label is the one the brief converts on", () => {
  assert.equal(CTA.primary, "Create your account");
  assert.equal(CTA.secondary, "Explore events");
  assert.equal(CTA.signin, "Sign in");
});
