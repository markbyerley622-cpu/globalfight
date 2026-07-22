// Ingestion: pulls channel RSS, tags videos, upserts new ones into the catalog.
// Runs only via the cron route (/api/cron/ingest-feed) plus a one-time warmup on
// cold start — never on a recurring per-instance interval. A JobLease ensures
// exactly one instance ingests at a time (no cross-instance storm).
import { fetchRss } from "./rss";
import { deriveTags } from "./tags";
import { filterFeed } from "./filter";
import { flog } from "./log";
import * as store from "./store";
import * as users from "./users";
import { notifyNewVideos } from "./notify";
import { withLease } from "@/lib/job-lease";

let running = false;
let lastRun = 0;
let started = false;

// How long one ingest may hold the lease. Comfortably longer than a real run
// (~3s for twenty feeds) and short enough that a hard crash self-heals within
// one cron tick.
const LEASE_MS = 5 * 60 * 1000;

export interface IngestResult {
  added?: number; notified?: number; total?: number;
  channelsOk?: number; channelsTotal?: number; skipped?: boolean; error?: string;
}

// Single-flight per process + a lease across processes.
export async function ingestOnce(): Promise<IngestResult> {
  if (running) { flog.info({ op: "ingest", status: "skipped", reason: "running" }, "ingest already running (this instance)"); return { skipped: true }; }
  running = true;
  try {
    const result = await withLease("feed_ingest", LEASE_MS, () => ingestUnlocked());
    if (result === null) {
      flog.info({ op: "ingest", status: "skipped", reason: "lease" }, "another instance holds the ingest lease");
      return { skipped: true };
    }
    return result;
  } finally {
    running = false;
  }
}

async function ingestUnlocked(): Promise<IngestResult> {
  const now = Date.now();
  try {
    const { videos, channelsOk, channelsTotal } = await fetchRss();
    const kept = filterFeed(videos, {}).map((v) => ({ ...v, tags: v.tags || deriveTags(v) }));
    const before = new Set(store.all().map((v) => v.id));
    const added = store.upsert(kept, now);

    // Notify only about what THIS run actually introduced. store.upsert returns
    // a count, so the genuinely-new set is recovered by diffing against the ids
    // held before the write — a re-ingest of the same feed notifies nobody.
    let notified = 0;
    if (added > 0) {
      const fresh = kept.filter((v) => !before.has(v.id));
      notified = await notifyNewVideos(fresh).catch(() => 0);
    }

    lastRun = now;
    const durationMs = Date.now() - now;
    flog.info(
      { op: "ingest", status: "succeeded", channelsOk, channelsTotal, added, notified, total: store.size(), durationMs },
      "feed ingest complete",
    );
    return { added, notified, total: store.size(), channelsOk, channelsTotal };
  } catch (e) {
    flog.error({ op: "ingest", status: "failed", durationMs: Date.now() - now, err: (e as Error).message }, "feed ingest failed");
    return { error: (e as Error).message };
  }
}

// First use per process: hydrate the catalog + user state from Postgres, and run
// a one-time warmup ingest (lock-guarded, so exactly one cold-starting instance
// fetches RSS; the rest just serve the hydrated catalog). Ongoing refresh is
// driven by the cron — there is deliberately no recurring interval here.
export function ensureIngestion(): void {
  if (started) return;
  started = true;
  store.load();
  users.load();
  void ingestOnce();
}

export const lastRunAt = (): number => lastRun;
