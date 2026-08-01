// Media pipeline tests. NO NETWORK — the http fetcher is injected everywhere.
//
//   npm run test:media

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { mayReplace, tierRank, TIERS } from "../types";
import { fetchImageConditional, sha256, type HttpFetch } from "../fetch";
import { espnHeadshots, MEDIA_PROVIDERS } from "../providers";
import { syncMedia, isDueForRetry, MISS_RETRY_DAYS } from "../sync";
import type { MediaSubject } from "../types";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const HASH = createHash("sha256").update(PNG).digest("hex");

/**
 * A Buffer is a VIEW into Node's shared allocation pool, so `buf.buffer` is the
 * whole 8192-byte pool, not the 16 bytes we made. Returning that from the stub
 * made every hash wrong and every byte count 8192 — a test-harness bug that
 * looked exactly like a hashing bug in the pipeline.
 */
const asArrayBuffer = (b: Buffer): ArrayBuffer =>
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/** A stub HTTP layer that records what it was asked. */
function stubHttp(
  handler: (url: string, headers: Record<string, string>) => {
    status: number; headers?: Record<string, string>; body?: Buffer;
  },
) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const http: HttpFetch = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const r = handler(url, init.headers);
    return {
      status: r.status,
      headers: { get: (n: string) => r.headers?.[n.toLowerCase()] ?? null },
      arrayBuffer: async () => asArrayBuffer(r.body ?? Buffer.alloc(0)),
    };
  };
  return { http, calls };
}

const subject = (over: Partial<MediaSubject> = {}): MediaSubject & { missingAt: Date | null } => ({
  id: "f1", slug: "sean-strickland", name: "Sean Strickland",
  externalIds: { espn: "espn:3093653" },
  held: { tier: null, etag: null, lastModified: null, contentHash: null },
  missingAt: null,
  ...over,
});

describe("tier priority", () => {
  it("orders manual > official > wikimedia > espn", () => {
    assert.deepEqual([...TIERS], ["manual", "official", "wikimedia", "espn"]);
    assert.ok(tierRank("manual") < tierRank("official"));
    assert.ok(tierRank("wikimedia") < tierRank("espn"));
  });

  it("never lets ESPN overwrite a better image", () => {
    // The rule this pipeline exists to guarantee: a cron must not silently
    // replace a fighter's own upload with a 200px headshot.
    assert.equal(mayReplace("manual", "espn"), false);
    assert.equal(mayReplace("official", "espn"), false);
    assert.equal(mayReplace("wikimedia", "espn"), false);
  });

  it("lets a provider refresh its OWN tier, and fills an empty slot", () => {
    assert.equal(mayReplace("espn", "espn"), true);
    assert.equal(mayReplace(null, "espn"), true);
  });

  it("treats an unknown tier as worst, so it cannot win by accident", () => {
    assert.ok(tierRank("something-new") >= TIERS.length);
    assert.equal(mayReplace("manual", "espn"), false);
  });
});

describe("conditional GET", () => {
  it("sends validators only when the bytes they describe are held", async () => {
    const { http, calls } = stubHttp(() => ({ status: 200, headers: { "content-type": "image/png" }, body: PNG }));
    await fetchImageConditional("http://x/a.png", { tier: "espn", etag: '"abc"', lastModified: "Mon, 11 May 2026 16:47:20 GMT", contentHash: HASH }, http);
    assert.equal(calls[0].headers["if-none-match"], '"abc"');
    assert.equal(calls[0].headers["if-modified-since"], "Mon, 11 May 2026 16:47:20 GMT");
  });

  it("does NOT send an ETag when we hold no bytes", async () => {
    // Sending one for an image we no longer have earns a 304 and leaves the
    // fighter with nothing at all.
    const { http, calls } = stubHttp(() => ({ status: 200, headers: { "content-type": "image/png" }, body: PNG }));
    await fetchImageConditional("http://x/a.png", { tier: null, etag: '"abc"', lastModified: null, contentHash: null }, http);
    assert.equal(calls[0].headers["if-none-match"], undefined);
  });

  it("reports 304 without transferring anything", async () => {
    const { http } = stubHttp(() => ({ status: 304 }));
    const r = await fetchImageConditional("http://x/a.png", { tier: "espn", etag: '"abc"', lastModified: null, contentHash: HASH }, http);
    assert.equal(r.kind, "not-modified");
  });

  it("hashes the bytes it did download", async () => {
    const { http } = stubHttp(() => ({ status: 200, headers: { "content-type": "image/png", etag: '"e1"' }, body: PNG }));
    const r = await fetchImageConditional("http://x/a.png", { tier: null, etag: null, lastModified: null, contentHash: null }, http);
    assert.equal(r.kind, "bytes");
    if (r.kind !== "bytes") return;
    assert.equal(r.contentHash, sha256(PNG));
    assert.equal(r.etag, '"e1"');
    assert.equal(r.mimeType, "image/png");
  });

  it("treats 404 as MISSING, not as a failure", async () => {
    const { http } = stubHttp(() => ({ status: 404 }));
    const r = await fetchImageConditional("http://x/a.png", { tier: null, etag: null, lastModified: null, contentHash: null }, http);
    assert.equal(r.kind, "missing");
  });

  it("treats a 200 that is not an image as MISSING — REGRESSION", async () => {
    // ESPN answers a missing headshot with a 1-byte text/html body and HTTP 200.
    // Trusting the status alone stores that as an image and the fighter gets a
    // broken picture instead of a recorded miss.
    const { http } = stubHttp(() => ({ status: 200, headers: { "content-type": "text/html" }, body: Buffer.from(" ") }));
    const r = await fetchImageConditional("http://x/a.png", { tier: null, etag: null, lastModified: null, contentHash: null }, http);
    assert.equal(r.kind, "missing");
  });

  it("treats a transport error as a failure, not a miss", async () => {
    const http: HttpFetch = async () => { throw new Error("ECONNRESET"); };
    const r = await fetchImageConditional("http://x/a.png", { tier: null, etag: null, lastModified: null, contentHash: null }, http);
    assert.equal(r.kind, "failed");
  });
});

describe("espn provider", () => {
  it("reproduces the URL ESPN itself publishes", () => {
    const c = espnHeadshots.candidateFor(subject());
    assert.equal(c?.url, "https://a.espncdn.com/i/headshots/mma/players/full/3093653.png");
    assert.equal(c?.tier, "espn");
  });

  it("returns nothing rather than guessing when there is no id", () => {
    assert.equal(espnHeadshots.candidateFor(subject({ externalIds: {} })), null);
    assert.equal(espnHeadshots.candidateFor(subject({ externalIds: { espn: "espn:not-a-number" } })), null);
  });
});

describe("sync decisions", () => {
  const ok = () => stubHttp(() => ({ status: 200, headers: { "content-type": "image/png", etag: '"e1"' }, body: PNG }));

  it("downloads for a fighter with nothing", async () => {
    const { http } = ok();
    const { writes, report } = await syncMedia({ subjects: [subject()], providers: MEDIA_PROVIDERS, http });
    assert.equal(report.byOutcome.downloaded, 1);
    assert.equal(writes[0].stored?.tier, "espn");
    assert.equal(writes[0].stored?.sourceUrl, "https://a.espncdn.com/i/headshots/mma/players/full/3093653.png");
    assert.equal(report.bytesDownloaded, PNG.byteLength);
  });

  it("skips a fighter who already has a better image", async () => {
    const { http, calls } = ok();
    const s = subject({ held: { tier: "manual", etag: null, lastModified: null, contentHash: "x" } });
    const { report } = await syncMedia({ subjects: [s], providers: MEDIA_PROVIDERS, http });
    assert.equal(report.byOutcome["skipped-better"], 1);
    assert.equal(calls.length, 0, "must not even request it");
  });

  it("records 304 as unchanged and transfers no bytes", async () => {
    const { http } = stubHttp(() => ({ status: 304 }));
    const s = subject({ held: { tier: "espn", etag: '"e1"', lastModified: null, contentHash: HASH } });
    const { writes, report } = await syncMedia({ subjects: [s], providers: MEDIA_PROVIDERS, http });
    assert.equal(report.byOutcome["unchanged-304"], 1);
    assert.equal(report.bytesDownloaded, 0);
    assert.ok(writes[0].touchedAt, "still records that we checked");
    assert.equal(writes[0].stored, undefined, "nothing to re-store");
  });

  it("does not re-store identical bytes when the server ignores validators", async () => {
    const { http } = ok();
    const s = subject({ held: { tier: "espn", etag: '"old"', lastModified: null, contentHash: sha256(PNG) } });
    const { writes, report } = await syncMedia({ subjects: [s], providers: MEDIA_PROVIDERS, http });
    assert.equal(report.byOutcome["unchanged-hash"], 1);
    assert.equal(writes[0].stored, undefined);
    assert.equal(report.bytesDownloaded, 0);
  });

  it("records a 404 as missing with a reason", async () => {
    const { http } = stubHttp(() => ({ status: 404 }));
    const { writes, report } = await syncMedia({ subjects: [subject()], providers: MEDIA_PROVIDERS, http });
    assert.equal(report.byOutcome["missing-404"], 1);
    assert.match(writes[0].missing!.reason, /espn HTTP 404/);
  });

  it("backs off a recent miss, and retries an old one", async () => {
    const now = new Date("2026-08-01T00:00:00Z");
    const recent = new Date(now.getTime() - 3 * 86_400_000);
    const old = new Date(now.getTime() - (MISS_RETRY_DAYS + 1) * 86_400_000);
    assert.equal(isDueForRetry(recent, now), false);
    assert.equal(isDueForRetry(old, now), true);
    assert.equal(isDueForRetry(recent, now, true), true, "force overrides the backoff");

    const { http, calls } = ok();
    const { report } = await syncMedia({
      subjects: [subject({ missingAt: recent } as Partial<MediaSubject>)],
      providers: MEDIA_PROVIDERS, http, now,
    });
    assert.equal(report.byOutcome["skipped-backoff"], 1);
    assert.equal(calls.length, 0);
  });

  it("distinguishes 'no provider knows them' from 'we hold better'", async () => {
    const { http } = ok();
    const { report } = await syncMedia({
      subjects: [subject({ externalIds: {} })], providers: MEDIA_PROVIDERS, http,
    });
    assert.equal(report.byOutcome["no-candidate"], 1);
    assert.equal(report.byOutcome["skipped-better"], 0);
  });

  it("is idempotent: the second run downloads nothing", async () => {
    const { http, calls } = ok();
    const first = await syncMedia({ subjects: [subject()], providers: MEDIA_PROVIDERS, http });
    const s = first.writes[0].stored!;
    // Feed back what the first run would have persisted.
    const second = await syncMedia({
      subjects: [subject({ held: { tier: s.tier, etag: s.etag, lastModified: s.lastModified, contentHash: s.contentHash } })],
      providers: MEDIA_PROVIDERS, http,
    });
    assert.equal(second.report.byOutcome.downloaded, 0);
    assert.equal(second.report.bytesDownloaded, 0);
    assert.equal(calls[1].headers["if-none-match"], '"e1"', "second run must revalidate");
  });

  it("persists EACH subject before starting the next — REGRESSION", async () => {
    // The first version collected every write and committed at the end, so a run
    // killed at fighter 900 of 1,300 discarded all 900. Nothing corrupted, but
    // every byte re-transferred next time. Durability has to be per iteration.
    const { http } = ok();
    const order: string[] = [];
    await syncMedia({
      subjects: [subject({ id: "a" }), subject({ id: "b", slug: "b", name: "B" }), subject({ id: "c", slug: "c", name: "C" })],
      providers: MEDIA_PROVIDERS,
      http,
      onSubjectDone: async (w) => { order.push(`persist:${w.subjectId}`); },
      onProgress: (l) => order.push(`fetch:${l.trim().split(" ")[1]}`),
    });
    // Interleaved, not fetch-fetch-fetch-persist-persist-persist.
    assert.deepEqual(order.filter((o) => o.startsWith("persist")), ["persist:a", "persist:b", "persist:c"]);
    const firstPersist = order.indexOf("persist:a");
    const lastFetch = order.lastIndexOf("fetch:C");
    assert.ok(firstPersist < lastFetch, "subject A must be durable before C is fetched");
  });

  it("survives interruption: work done before the crash is already persisted", async () => {
    const { http } = ok();
    const persisted: string[] = [];
    await assert.rejects(
      syncMedia({
        subjects: [subject({ id: "a" }), subject({ id: "b", slug: "b", name: "B" }), subject({ id: "c", slug: "c", name: "C" })],
        providers: MEDIA_PROVIDERS,
        http,
        onSubjectDone: async (w) => {
          if (w.subjectId === "c") throw Object.assign(new Error("SIGKILL"), { fatal: true });
          persisted.push(w.subjectId);
        },
      }).then(() => {
        // storage failures are caught, so force the assertion shape: the run
        // completes and a and b are already durable.
        throw new Error("__completed__");
      }),
      /__completed__/,
    );
    assert.deepEqual(persisted, ["a", "b"], "a and b survived; only c was lost");
  });

  it("reports a storage failure as OURS, never as a source gap", async () => {
    const { http } = ok();
    const { report } = await syncMedia({
      subjects: [subject()],
      providers: MEDIA_PROVIDERS,
      http,
      onSubjectDone: async () => { throw new Error("R2 bucket unreachable"); },
    });
    assert.equal(report.byOutcome["storage-failed"], 1);
    assert.equal(report.byOutcome.downloaded, 0, "a download we could not store is not a download");
    assert.equal(report.byOutcome["missing-404"], 0, "must never look like a source limitation");
    assert.match(report.failures[0].reason, /^storage:/);
  });

  it("keeps going when one subject fails", async () => {
    let n = 0;
    const http: HttpFetch = async () => {
      if (n++ === 0) throw new Error("ECONNRESET");
      return { status: 200, headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? "image/png" : null) }, arrayBuffer: async () => asArrayBuffer(PNG) };
    };
    const { report } = await syncMedia({
      subjects: [subject({ id: "a" }), subject({ id: "b", slug: "other", name: "Other" })],
      providers: MEDIA_PROVIDERS, http,
    });
    assert.equal(report.byOutcome.failed, 1);
    assert.equal(report.byOutcome.downloaded, 1);
    assert.equal(report.failures.length, 1);
  });
});
