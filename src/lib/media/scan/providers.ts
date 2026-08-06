import "server-only";
import type { MediaScanProvider, MediaScanResult, ScanHint } from "./types";

// ════════════════════════════════════════════════════════════════════════════
//  The providers. Each one is small on purpose — all the policy lives in the
//  lifecycle, and a provider's only job is to turn bytes into a verdict.
// ════════════════════════════════════════════════════════════════════════════

const now = () => Date.now();

/**
 * NO SCANNER CONFIGURED.
 *
 * Returns UNKNOWN, never SAFE. This is the whole reason the abstraction exists:
 * the default must be the one that refuses to publish, so that forgetting to
 * configure a scanner is a visible outage on the upload path rather than a
 * silent hole through which unscanned bytes reach public storage.
 */
export class NullScanProvider implements MediaScanProvider {
  readonly name = "none";
  async isReachable() { return false; }
  async scan(): Promise<MediaScanResult> {
    return {
      verdict: "UNKNOWN",
      provider: this.name,
      durationMs: 0,
      detail: "No scanner configured (MEDIA_SCAN_URL unset).",
    };
  }
}

/**
 * An HTTP scanning service — a ClamAV sidecar (clamav-rest and friends), or a
 * cloud scanning API behind the same shape.
 *
 * Contract: POST the raw bytes, expect JSON. Both the common response shapes
 * are accepted (`{infected: bool}` and `{status: "clean"|"infected"}`) because
 * the two popular ClamAV REST wrappers disagree, and requiring one of them
 * would make swapping images a code change.
 */
export class HttpScanProvider implements MediaScanProvider {
  readonly name: string;

  constructor(
    private readonly url: string,
    private readonly timeoutMs = 20_000,
    private readonly token = process.env.MEDIA_SCAN_TOKEN ?? "",
    name = "http",
  ) {
    this.name = name;
  }

  async isReachable(): Promise<boolean> {
    try {
      // HEAD, with a short budget: a reachability probe that takes the full
      // scan timeout would make /api/health as slow as the scanner.
      const res = await fetch(this.url, { method: "HEAD", signal: AbortSignal.timeout(3_000) });
      // Any answer proves the socket is open and something is listening. A 405
      // (HEAD unsupported) is still reachable, so status is not checked.
      return res.status > 0;
    } catch {
      return false;
    }
  }

  async scan(bytes: Buffer, hint: ScanHint): Promise<MediaScanResult> {
    const started = now();
    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          // Advisory only. The provider is free to ignore them; nothing here
          // trusts them, and they never include a filename.
          "x-media-mime": hint.mime,
          "x-media-sha256": hint.sha256,
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
        body: new Uint8Array(bytes),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const durationMs = now() - started;
      if (!res.ok) {
        return { verdict: "FAILED", provider: this.name, durationMs, detail: `HTTP ${res.status}` };
      }

      const body = (await res.json().catch(() => null)) as
        | { infected?: boolean; status?: string; signature?: string; virus?: string }
        | null;
      if (!body) {
        return { verdict: "FAILED", provider: this.name, durationMs, detail: "Unparseable response" };
      }

      const signature = body.signature ?? body.virus ?? null;
      const status = (body.status ?? "").toLowerCase();

      if (body.infected === true || status === "infected" || status === "found") {
        return { verdict: "INFECTED", provider: this.name, durationMs, signature };
      }
      if (body.infected === false || status === "clean" || status === "ok") {
        return { verdict: "SAFE", provider: this.name, durationMs };
      }

      // A response we do not understand is NOT clean. Treated as UNKNOWN so it
      // fails closed and is not retried — a provider speaking an unexpected
      // dialect will keep speaking it.
      return { verdict: "UNKNOWN", provider: this.name, durationMs, detail: "Unrecognised verdict shape" };
    } catch (e) {
      const durationMs = now() - started;
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      return {
        verdict: timedOut ? "TIMEOUT" : "FAILED",
        provider: this.name,
        durationMs,
        detail: e instanceof Error ? e.name : "unknown error",
      };
    }
  }
}

/**
 * TEST provider. Never selected from configuration — only constructed
 * explicitly by tests, so it cannot be switched on in production by an
 * environment variable typo.
 */
export class MockScanProvider implements MediaScanProvider {
  readonly name = "mock";
  constructor(
    private readonly verdicts: MediaScanResult["verdict"][] = ["SAFE"],
    private readonly reachable = true,
  ) {}
  private call = 0;
  async isReachable() { return this.reachable; }
  async scan(): Promise<MediaScanResult> {
    // Walks the list then holds on the last entry, so a retry test can say
    // ["TIMEOUT", "SAFE"] and a "never recovers" test can say ["FAILED"].
    const verdict = this.verdicts[Math.min(this.call++, this.verdicts.length - 1)];
    return { verdict, provider: this.name, durationMs: 1 };
  }
}

/**
 * The configured provider, chosen ONCE per process.
 *
 * `MEDIA_SCAN_URL` is read rather than reusing `EVIDENCE_SCAN_URL`: the two can
 * legitimately be different endpoints (identity documents may go to a stricter
 * or differently-located scanner than public images), and silently sharing one
 * variable would make that impossible to express later.
 */
let cached: MediaScanProvider | null = null;

export function getScanProvider(): MediaScanProvider {
  if (cached) return cached;
  const url = process.env.MEDIA_SCAN_URL ?? "";
  const timeout = Number(process.env.MEDIA_SCAN_TIMEOUT_MS) || 20_000;
  cached = url ? new HttpScanProvider(url, timeout) : new NullScanProvider();
  return cached;
}

/** Tests only — swap the provider and restore it. */
export function __setScanProvider(p: MediaScanProvider | null): void {
  cached = p;
}
