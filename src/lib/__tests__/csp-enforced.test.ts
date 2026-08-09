import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ════════════════════════════════════════════════════════════════════════════
//  The CSP is ENFORCED, and enforcing it meant removing 'unsafe-inline'.
//
//  ── What this replaces ────────────────────────────────────────────────────
//  The policy shipped as `Content-Security-Policy-Report-Only` with a comment
//  saying the enforced version was blocked on nonce work. Report-Only is a
//  policy the browser reports on and then obeys nobody: it stopped nothing, and
//  because the header LOOKS like a CSP it read as protection in every header
//  dump.
//
//  Two ways for that to come back, and both are silent:
//    1. someone re-adds the `-Report-Only` header,
//    2. someone puts 'unsafe-inline' back in script-src to fix a blocked
//       script, which keeps the header enforced and removes the only directive
//       that actually buys XSS protection.
//  A header dump would look fine in both cases. These fail instead.
// ════════════════════════════════════════════════════════════════════════════

const ROOT = process.cwd();
const middleware = readFileSync(join(ROOT, "src", "middleware.ts"), "utf8");
const nextConfig = readFileSync(join(ROOT, "next.config.ts"), "utf8");

const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const mw = strip(middleware);
const cfg = strip(nextConfig);

describe("the production CSP is enforced, not observed", () => {
  test("nothing sends Content-Security-Policy-Report-Only", () => {
    for (const [name, src] of [["src/middleware.ts", mw], ["next.config.ts", cfg]] as const) {
      assert.ok(
        !/Report-Only/i.test(src),
        `${name} is back on Report-Only — the browser will report violations and block none of them`,
      );
    }
  });

  test("the middleware sets the enforced header on both the request and the response", () => {
    // The REQUEST copy is what Next reads to stamp its own script tags with the
    // nonce; the RESPONSE copy is what the browser enforces. Losing the request
    // copy does not weaken the policy — it white-screens the app, because
    // Next's own bootstrap stops carrying a nonce it no longer knows about.
    assert.ok(
      /headers\.set\(\s*["']Content-Security-Policy["']/.test(mw),
      "the middleware no longer puts the CSP on the REQUEST — Next cannot nonce its scripts",
    );
    assert.ok(
      /res\.headers\.set\(\s*["']Content-Security-Policy["']/.test(mw),
      "the middleware no longer puts the CSP on the RESPONSE — nothing is enforced",
    );
  });
});

describe("script-src carries no 'unsafe-inline'", () => {
  // Whole LINE. An earlier version excluded quotes from the character class,
  // which stopped the match at `'self'` and made the nonce assertion fail
  // against a policy that was perfectly correct.
  const scriptSrc = mw.match(/script-src.*/)?.[0] ?? "";

  test("the directive exists and is nonce-based", () => {
    assert.ok(scriptSrc, "script-src is gone from the policy");
    assert.ok(/'nonce-\$\{nonce\}'/.test(scriptSrc), "script-src is no longer nonce-based");
    assert.ok(/'strict-dynamic'/.test(scriptSrc), "strict-dynamic is gone — Next cannot load its chunks");
  });

  test("no 'unsafe-inline' and no 'unsafe-eval' in script-src", () => {
    assert.ok(
      !/unsafe-inline/.test(scriptSrc),
      "'unsafe-inline' is back in script-src. That is the one directive whose absence buys XSS " +
        "protection — an enforced policy with it is enforcement in name only. If a script is being " +
        "blocked, give it the nonce.",
    );
    assert.ok(!/unsafe-eval/.test(scriptSrc), "'unsafe-eval' was added to script-src");
  });

  test("nowhere in the policy uses unsafe-eval or a bare wildcard source", () => {
    const policy = mw.slice(mw.indexOf("function policy"), mw.indexOf("export function middleware"));
    assert.ok(!/unsafe-eval/.test(policy), "unsafe-eval appears in the policy");
    // `https://*.host` is a scoped wildcard and fine; a bare `*` or `https:` is not.
    assert.ok(
      !/["'\s](\*|https:|http:)["'\s;]/.test(policy),
      "a bare wildcard scheme/source is in the policy — name the origin instead",
    );
  });

  test("style-src keeps 'unsafe-inline', and that is a recorded decision", () => {
    // Not an oversight. React writes style={{…}} as an ATTRIBUTE, which cannot
    // carry a nonce; the only CSP mechanism covering it is 'unsafe-hashes',
    // which would mean hashing every inline style in the product. The threat is
    // style injection — defacement and CSS exfiltration — not script execution.
    const styleSrc = mw.match(/style-src.*/)?.[0] ?? "";
    assert.ok(styleSrc.includes("unsafe-inline"), "style-src changed; re-verify the app still renders");
    assert.ok(
      /unsafe-hashes/.test(mw) === false,
      "if 'unsafe-hashes' has been adopted, this test should be replaced rather than left passing",
    );
  });
});

describe("the hard directives are all present", () => {
  for (const directive of [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
  ]) {
    test(`"${directive}" survives`, () => {
      assert.ok(mw.includes(directive), `the policy lost: ${directive}`);
    });
  }

  test("`upgrade-insecure-requests` stays OUT of the policy", () => {
    // Not an omission. HSTS (preload, includeSubDomains) already forces HTTPS
    // for the whole domain, so the directive buys nothing on production — and
    // it breaks every non-HTTPS environment. Reproduced in Chromium against a
    // production build on http://127.0.0.1: `/fighters` fetched fine while `/`
    // and `/predictions/<slug>` failed with net::ERR_SSL_PROTOCOL_ERROR,
    // because those are REDIRECTS and the absolute `http://` Location header
    // gets upgraded even though 127.0.0.1 is itself an exempt trustworthy
    // origin. That is what turned the E2E suite red.
    //
    // Asserted on the POLICY function specifically, so the explanation above
    // (which contains the phrase) does not satisfy the test.
    const policy = mw.slice(mw.indexOf("function policy"), mw.indexOf("export function middleware"));
    const directives = policy.match(/"[a-z-]+ [^"]*"|"[a-z-]+"/g) ?? [];
    assert.ok(
      !directives.some((d) => d.includes("upgrade-insecure-requests")),
      "upgrade-insecure-requests is back in the policy. It breaks redirects on any HTTP " +
        "deployment (local dev, E2E) and adds nothing over HSTS. Remove HSTS first if you want it.",
    );
  });

  test("the middleware still runs on HTML routes", () => {
    // A matcher that stops matching is a CSP that silently stops shipping —
    // every page would serve with no policy at all and nothing would fail.
    assert.ok(/matcher/.test(mw), "the middleware matcher is gone");
    assert.ok(
      /_next\/static/.test(mw) && /api/.test(mw),
      "the matcher no longer excludes hashed assets and API routes",
    );
  });
});
