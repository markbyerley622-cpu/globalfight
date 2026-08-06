import { test } from "node:test";
import assert from "node:assert/strict";
import { validateImageBytes, sniffImageMime, looksLikePolyglot } from "@/lib/media/scan/validate";

// ── Builders for real, minimal, VALID files ────────────────────────────────
// Constructed from the actual format bytes rather than fixture files, so the
// tests state exactly which structural property they depend on.
const pad = (n: number) => Buffer.alloc(n, 0x20);

const jpeg = (body = pad(200)) =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), body, Buffer.from([0xff, 0xd9])]);

const png = (body = pad(200)) =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    body,
    Buffer.from("IEND", "latin1"),
    Buffer.from([0xae, 0x42, 0x60, 0x82]),
  ]);

const webp = (body = pad(200)) => {
  const payload = Buffer.concat([Buffer.from("WEBP", "latin1"), body]);
  const head = Buffer.alloc(8);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(payload.length, 4);
  return Buffer.concat([head, payload]);
};

test("accepts the three formats we publish", () => {
  for (const [name, buf, mime] of [
    ["jpeg", jpeg(), "image/jpeg"], ["png", png(), "image/png"], ["webp", webp(), "image/webp"],
  ] as const) {
    const r = validateImageBytes(buf);
    assert.equal(r.ok, true, `${name}: ${r.ok ? "" : r.reason}`);
    if (r.ok) assert.equal(r.mime, mime);
  }
});

test("a content hash is produced and is stable", () => {
  const a = validateImageBytes(jpeg());
  const b = validateImageBytes(jpeg());
  assert.equal(a.ok && b.ok && a.sha256 === b.sha256, true);
  if (a.ok) assert.match(a.sha256, /^[a-f0-9]{64}$/);
});

// ── The refusals ───────────────────────────────────────────────────────────

test("empty and near-empty files are refused", () => {
  const empty = validateImageBytes(Buffer.alloc(0));
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.reason, "EMPTY");
  const tiny = validateImageBytes(Buffer.from([0xff, 0xd8, 0xff]));
  assert.equal(tiny.ok, false);
});

test("SVG is refused — it is a scriptable document, not an image", () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'.padEnd(200, " "));
  const r = validateImageBytes(svg);
  assert.equal(r.ok, false);
});

test("executables and archives are refused", () => {
  const exe = Buffer.concat([Buffer.from("MZ", "latin1"), pad(300)]);
  const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), pad(300)]);
  const pdf = Buffer.concat([Buffer.from("%PDF-1.7", "latin1"), pad(300)]);
  for (const b of [exe, zip, pdf]) assert.equal(validateImageBytes(b).ok, false);
});

test("a PDF is refused HERE even though the evidence pipeline accepts one", () => {
  // Different risk: evidence is private and human-reviewed; media is public.
  const pdf = Buffer.concat([Buffer.from("%PDF-1.7", "latin1"), pad(300)]);
  const r = validateImageBytes(pdf);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "UNKNOWN_SIGNATURE");
});

test("a POLYGLOT — valid image with an appended payload — is refused", () => {
  // The payload sits AFTER the JPEG end marker, which is where a prefix-only
  // scan would stop looking.
  const evil = Buffer.concat([jpeg(), Buffer.from("<?php system($_GET[0]); ?>", "latin1")]);
  assert.equal(sniffImageMime(evil), "image/jpeg", "it really does look like a JPEG");
  assert.equal(looksLikePolyglot(evil), true);
  const r = validateImageBytes(evil);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "POLYGLOT");
});

test("an HTML payload appended to a PNG is refused", () => {
  const evil = Buffer.concat([png(), Buffer.from("<script>fetch('/steal')</script>", "latin1")]);
  const r = validateImageBytes(evil);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "POLYGLOT");
});

test("a LYING Content-Type is caught by the signature", () => {
  // The declared type is only ever checked against the bytes, never trusted.
  const r = validateImageBytes(png(), "image/jpeg");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "MIME_MISMATCH");
});

test("a truncated image is refused", () => {
  const cut = jpeg().subarray(0, 120); // end marker removed
  const r = validateImageBytes(cut);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "TRUNCATED");
});

test("oversized files are refused", () => {
  const huge = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(13 * 1024 * 1024), Buffer.from([0xff, 0xd9])]);
  const r = validateImageBytes(huge);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "TOO_LARGE");
});

test("refusal messages never reveal what the file actually was", () => {
  // Telling a prober "that's an executable" is free reconnaissance.
  const exe = Buffer.concat([Buffer.from("MZ", "latin1"), pad(300)]);
  const r = validateImageBytes(exe);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(/executable|MZ|php|script|polyglot/i.test(r.message), false, r.message);
  }
});
