import { test } from "node:test";
import assert from "node:assert/strict";
// The PURE module, not the server-only wrapper: the unit runner does not pass
// --conditions=react-server, so importing the wrapper throws on `server-only`.
import { readFramingHeaders, safeArticleUrl } from "@/lib/embeddability-rules";

// Header parsing is the whole decision, and it is easy to get backwards: a MISSING
// frame-ancestors means "no restriction", while `frame-ancestors 'none'` means the
// opposite. Getting it wrong in the permissive direction shows the reader a blank
// white iframe, which is the exact failure the check exists to prevent.

const H = (h: Record<string, string>) => ({
  get: (name: string) => h[name.toLowerCase()] ?? null,
});

// ── X-Frame-Options ─────────────────────────────────────────────────────────

test("no framing headers at all is embeddable", () => {
  assert.equal(readFramingHeaders(H({})).embeddable, true);
});

test("X-Frame-Options DENY blocks", () => {
  assert.equal(readFramingHeaders(H({ "x-frame-options": "DENY" })).embeddable, false);
});

test("X-Frame-Options SAMEORIGIN blocks us — we are not the same origin", () => {
  assert.equal(readFramingHeaders(H({ "x-frame-options": "SAMEORIGIN" })).embeddable, false);
});

test("X-Frame-Options is case- and whitespace-insensitive", () => {
  for (const v of ["deny", "  DeNy ", "sameorigin", "SameOrigin"]) {
    assert.equal(readFramingHeaders(H({ "x-frame-options": v })).embeddable, false, v);
  }
});

test("the obsolete ALLOW-FROM is treated as a restriction", () => {
  // Modern browsers ignore it, but a site sending it is expressing intent to
  // restrict, and guessing permissive gives a blank frame.
  assert.equal(readFramingHeaders(H({ "x-frame-options": "ALLOW-FROM https://x.com" })).embeddable, false);
});

// ── CSP frame-ancestors ─────────────────────────────────────────────────────

test("frame-ancestors 'none' blocks", () => {
  assert.equal(
    readFramingHeaders(H({ "content-security-policy": "default-src 'self'; frame-ancestors 'none'" })).embeddable,
    false,
  );
});

test("frame-ancestors 'self' blocks", () => {
  assert.equal(
    readFramingHeaders(H({ "content-security-policy": "frame-ancestors 'self'" })).embeddable,
    false,
  );
});

test("a CSP with NO frame-ancestors does not block", () => {
  // The directive being absent is the common case and must not be read as a denial,
  // or almost every publisher would fall back unnecessarily.
  assert.equal(
    readFramingHeaders(H({ "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'" })).embeddable,
    true,
  );
});

test("frame-ancestors * is embeddable", () => {
  assert.equal(readFramingHeaders(H({ "content-security-policy": "frame-ancestors *" })).embeddable, true);
});

test("an explicit allow-list we are probably not on is treated as blocked", () => {
  assert.equal(
    readFramingHeaders(H({ "content-security-policy": "frame-ancestors https://partner.example" })).embeddable,
    false,
  );
});

test("CSP frame-ancestors is read even when X-Frame-Options is absent, and vice versa", () => {
  assert.equal(readFramingHeaders(H({ "content-security-policy": "frame-ancestors 'none'" })).embeddable, false);
  assert.equal(readFramingHeaders(H({ "x-frame-options": "DENY" })).embeddable, false);
});

test("directive matching is not fooled by a similarly-named directive", () => {
  // `frame-src` governs what the page may frame, not who may frame IT.
  assert.equal(
    readFramingHeaders(H({ "content-security-policy": "frame-src 'none'" })).embeddable,
    true,
    "frame-src must not be mistaken for frame-ancestors",
  );
});

// ── SSRF guard ──────────────────────────────────────────────────────────────

test("only public http(s) URLs are accepted", () => {
  assert.ok(safeArticleUrl("https://espn.com/story"));
  assert.ok(safeArticleUrl("http://example.com/a"));
  assert.equal(safeArticleUrl("javascript:alert(1)"), null);
  assert.equal(safeArticleUrl("file:///etc/passwd"), null);
  assert.equal(safeArticleUrl("not a url"), null);
  assert.equal(safeArticleUrl(null), null);
  assert.equal(safeArticleUrl(""), null);
});

test("private, loopback and metadata addresses are refused", () => {
  // This function's argument comes from ingested data and is then FETCHED by the
  // server, so it is an SSRF surface. 169.254.169.254 is the cloud metadata
  // endpoint and is the one that actually matters.
  for (const bad of [
    "http://localhost/x",
    "http://127.0.0.1/x",
    "http://127.1.2.3/x",
    "http://10.0.0.5/x",
    "http://192.168.1.1/x",
    "http://169.254.169.254/latest/meta-data/",
    "http://172.16.0.1/x",
    "http://172.31.255.255/x",
  ]) {
    assert.equal(safeArticleUrl(bad), null, bad);
  }
});

test("a public address that merely looks similar is allowed", () => {
  // 172.32.x is OUTSIDE the private 172.16–172.31 range, and 10x.x is not 10.x.
  assert.ok(safeArticleUrl("http://172.32.0.1/x"), "172.32 is public");
  assert.ok(safeArticleUrl("http://109.0.0.1/x"), "109.x is public");
});
