import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { screenMedia, scannerHealth } from "@/lib/media/scan";
import { MockScanProvider, NullScanProvider, __setScanProvider } from "@/lib/media/scan/providers";
import { isPublishable, isRetryable } from "@/lib/media/scan/types";

const pad = (n: number) => Buffer.alloc(n, 0x20);
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), pad(200), Buffer.from([0xff, 0xd9])]);

afterEach(() => __setScanProvider(null));

// ════════════════════════════════════════════════════════════════════════════
//  FAIL CLOSED. Only an explicit SAFE may be published.
// ════════════════════════════════════════════════════════════════════════════

test("SAFE is the only verdict that publishes", async () => {
  __setScanProvider(new MockScanProvider(["SAFE"]));
  const r = await screenMedia(jpeg());
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.mime, "image/jpeg");
    assert.equal(r.scan.verdict, "SAFE");
    assert.match(r.sha256, /^[a-f0-9]{64}$/);
  }
});

test("INFECTED is refused", async () => {
  __setScanProvider(new MockScanProvider(["INFECTED"]));
  const r = await screenMedia(jpeg());
  assert.equal(r.ok, false);
  if (!r.ok && r.stage === "scan") assert.equal(r.scan.verdict, "INFECTED");
});

test("a scanner that never recovers is refused, not published", async () => {
  __setScanProvider(new MockScanProvider(["FAILED"]));
  const r = await screenMedia(jpeg());
  assert.equal(r.ok, false);
});

test("TIMEOUT fails CLOSED — an unresponsive scanner never means clean", async () => {
  __setScanProvider(new MockScanProvider(["TIMEOUT"]));
  const r = await screenMedia(jpeg());
  assert.equal(r.ok, false);
  if (!r.ok && r.stage === "scan") assert.equal(r.scan.verdict, "TIMEOUT");
});

test("NO SCANNER CONFIGURED refuses everything", async () => {
  // The default must be the one that cannot leak. Forgetting to configure a
  // scanner has to be a visible outage, never a silent hole.
  __setScanProvider(new NullScanProvider());
  const r = await screenMedia(jpeg());
  assert.equal(r.ok, false);
  if (!r.ok && r.stage === "scan") assert.equal(r.scan.verdict, "UNKNOWN");
});

test("a retryable verdict IS retried, and a recovery publishes", async () => {
  __setScanProvider(new MockScanProvider(["TIMEOUT", "SAFE"]));
  const r = await screenMedia(jpeg());
  assert.equal(r.ok, true, "second attempt should succeed");
});

test("UNKNOWN is NOT retried — it is a configuration fault, not a blip", async () => {
  // If it were retried, an unconfigured scanner would burn the retry budget and
  // delay the operator finding out.
  assert.equal(isRetryable({ verdict: "UNKNOWN", provider: "x", durationMs: 0 }), false);
  assert.equal(isRetryable({ verdict: "TIMEOUT", provider: "x", durationMs: 0 }), true);
  assert.equal(isRetryable({ verdict: "FAILED", provider: "x", durationMs: 0 }), true);
  assert.equal(isRetryable({ verdict: "INFECTED", provider: "x", durationMs: 0 }), false);
});

test("only SAFE satisfies isPublishable", () => {
  for (const v of ["INFECTED", "FAILED", "TIMEOUT", "UNKNOWN"] as const) {
    assert.equal(isPublishable({ verdict: v, provider: "x", durationMs: 0 }), false, v);
  }
  assert.equal(isPublishable({ verdict: "SAFE", provider: "x", durationMs: 0 }), true);
});

// ════════════════════════════════════════════════════════════════════════════
//  ORDER: validation runs BEFORE the scan.
// ════════════════════════════════════════════════════════════════════════════

test("a structurally invalid file is refused WITHOUT reaching the scanner", async () => {
  // Shipping every probe and every 12MB of garbage to a scanning service is
  // both slow and expensive, and it puts unvalidated bytes near a decoder.
  let scanned = false;
  __setScanProvider({
    name: "spy",
    async isReachable() { return true; },
    async scan() { scanned = true; return { verdict: "SAFE" as const, provider: "spy", durationMs: 0 }; },
  });
  const r = await screenMedia(Buffer.from("<?php echo 1; ?>".padEnd(300, " ")));
  assert.equal(r.ok, false);
  assert.equal(scanned, false, "the scanner must not have been called");
});

test("a polyglot never reaches the scanner either", async () => {
  let scanned = false;
  __setScanProvider({
    name: "spy",
    async isReachable() { return true; },
    async scan() { scanned = true; return { verdict: "SAFE" as const, provider: "spy", durationMs: 0 }; },
  });
  const evil = Buffer.concat([jpeg(), Buffer.from("<?php system($_GET[0]); ?>", "latin1")]);
  const r = await screenMedia(evil);
  assert.equal(r.ok, false);
  assert.equal(scanned, false);
});

// ════════════════════════════════════════════════════════════════════════════
//  What the UPLOADER is told.
// ════════════════════════════════════════════════════════════════════════════

test("a refusal never tells the uploader their payload was detected", async () => {
  // That feedback loop is exactly what lets someone iterate until it isn't.
  __setScanProvider(new MockScanProvider(["INFECTED"]));
  const r = await screenMedia(jpeg());
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(/infect|virus|malware|signature|clam/i.test(r.message), false, r.message);
    assert.ok(r.message.length > 0);
  }
});

test("a provider that throws cannot escape into the upload path", async () => {
  // A scanner crash must be a refusal, never a 500 that skips the check.
  __setScanProvider({
    name: "broken",
    async isReachable() { return true; },
    async scan() { throw new Error("provider exploded"); },
  });
  const r = await screenMedia(jpeg());
  assert.equal(r.ok, false, "a throwing provider must refuse, not publish");
  if (!r.ok && r.stage === "scan") assert.equal(r.scan.verdict, "FAILED");
});

// ════════════════════════════════════════════════════════════════════════════
//  Health reporting.
// ════════════════════════════════════════════════════════════════════════════

test("health reports an unconfigured scanner honestly", async () => {
  __setScanProvider(new NullScanProvider());
  const h = await scannerHealth();
  assert.deepEqual(h, { configured: false, provider: "none", reachable: false });
});

test("health reports a configured-but-unreachable scanner as not reachable", async () => {
  __setScanProvider(new MockScanProvider(["SAFE"], false));
  const h = await scannerHealth();
  assert.equal(h.configured, true);
  assert.equal(h.reachable, false);
});
