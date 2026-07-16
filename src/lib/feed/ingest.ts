// Ingestion: pulls channel RSS, tags videos, upserts new ones into the catalog.
// Runs only via the cron route (/api/cron/ingest-feed) plus a one-time warmup on
// cold start — never on a recurring per-instance interval. A Postgres advisory
// lock ensures exactly one instance ingests at a time (no cross-instance storm).
import { prisma } from "@/lib/db";
import { fetchRss } from "./rss";
import { deriveTags } from "./tags";
import { filterFeed } from "./filter";
import { dbEnabled } from "./repo";
import { flog } from "./log";
import * as store from "./store";
import * as users from "./users";

// Arbitrary but stable key for pg_advisory_lock across all instances.
const LOCK_KEY = 4210001;
let running = false;
let lastRun = 0;
let started = false;

export interface IngestResult { added?: number; total?: number; channelsOk?: number; channelsTotal?: number; skipped?: boolean; error?: string; }

// Cross-instance mutual exclusion. In mock mode (no DB) the per-process guard is
// sufficient. If the lock query errors (DB unreachable) we decline to ingest —
// there's nowhere to persist anyway.
async function acquireLock(): Promise<boolean> {
  if (!dbEnabled()) return true;
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ locked: boolean }>>(
      `SELECT pg_try_advisory_lock(${LOCK_KEY}) AS locked`,
    );
    return rows?.[0]?.locked === true;
  } catch (e) {
    flog.error({ op: "ingest.lock", err: (e as Error).message }, "advisory lock failed");
    return false;
  }
}
async function releaseLock(): Promise<void> {
  if (!dbEnabled()) return;
  try { await prisma.$queryRawUnsafe(`SELECT pg_advisory_unlock(${LOCK_KEY})`); } catch { /* best effort */ }
}

// Single-flight per process + advisory lock across processes.
export async function ingestOnce(): Promise<IngestResult> {
  if (running) { flog.info({ op: "ingest", status: "skipped", reason: "running" }, "ingest already running (this instance)"); return { skipped: true }; }
  running = true;
  const gotLock = await acquireLock();
  if (!gotLock) {
    running = false;
    flog.info({ op: "ingest", status: "skipped", reason: "lock" }, "another instance holds the ingest lock");
    return { skipped: true };
  }
  const now = Date.now();
  try {
    const { videos, channelsOk, channelsTotal } = await fetchRss();
    const kept = filterFeed(videos, {}).map((v) => ({ ...v, tags: v.tags || deriveTags(v) }));
    const added = store.upsert(kept, now);
    lastRun = now;
    const durationMs = Date.now() - now;
    flog.info(
      { op: "ingest", status: "succeeded", channelsOk, channelsTotal, added, total: store.size(), durationMs },
      "feed ingest complete",
    );
    return { added, total: store.size(), channelsOk, channelsTotal };
  } catch (e) {
    flog.error({ op: "ingest", status: "failed", durationMs: Date.now() - now, err: (e as Error).message }, "feed ingest failed");
    return { error: (e as Error).message };
  } finally {
    running = false;
    await releaseLock();
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
