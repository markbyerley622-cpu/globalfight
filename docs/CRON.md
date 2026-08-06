# Cron

Every scheduled job, what it feeds, and how to tell whether it is actually
running.

---

## The two things that make a cron dishonest

**1. A route with no schedule does not fail — it never runs.** Nothing errors,
nothing alerts, and the feature it feeds simply looks empty.

**2. A job can report green while doing nothing.** `refresh-champions` ran daily
for months and its handler was `case "champions": … refresh:noop`. The cron
dashboard was green the entire time. So was the HTTP response.

Both are why run history lives in the database (`ScrapeJob`) rather than in the
scheduler's dashboard, and why `npm run cron:doctor` reads that table.

---

## Where schedules live

**Render is the live deployment.** `render.yaml` is authoritative;
`vercel.json` is kept in step but is not what runs.

Beware: several Render services curl a **shell loop**, so grepping `render.yaml`
for a route URL will miss it. This is real and it produced a false finding during
the audit:

```yaml
startCommand: >-
  for p in refresh-events sync refresh-espn refresh-odds refresh-p4p \
           refresh-champions refresh-mma enrich-boxing; do
    curl ... "https://$APP_HOST/api/cron/$p" || true;
  done
```

`npm run audit:crons` compares routes against schedules properly. Use it rather
than a grep.

---

## The schedule

| Service | When | Routes |
|---|---|---|
| `gf-cron-results` | hourly :20 | `refresh-results?tier=recent`, `resolve-picks` |
| `gf-cron-enrich` | hourly :00 | `refresh-enrich`, `return-engine`, `ingest-feed` |
| `gf-cron-news` | every 6h | `refresh-news` |
| `gf-cron-retention` | 02:30 daily | `evidence-cleanup` (+ media cleanup) |
| `gf-cron-images` | 03:10 daily | `refresh-images?mode=new` |
| `gf-cron-daily` | 04:00 daily | `refresh-events`, `sync`, `refresh-espn`, `refresh-odds`, **`refresh-p4p`**, **`refresh-champions`**, `refresh-mma`, `enrich-boxing` |
| `gf-cron-results-daily` | 05:40 daily | `refresh-results?tier=daily` |
| `gf-cron-promotions` | 06:00 Mon/Thu | `refresh-bkfc`, `refresh-one`, **`refresh-wikicards`** |
| `gf-cron-weekly` | 08:00 Mon | `refresh-adcc` |
| `gf-cron-rankings` | 08:00 Mon | **`refresh-rankings`** |
| `gf-cron-images-revalidate` | 04:30 Sun | `refresh-images?mode=revalidate` |
| `gf-cron-results-deep` | 07:00 Sun | `refresh-results?tier=deep` |
| `gf-cron-images-retry` | 05:00 monthly | `refresh-images?mode=retry` |

`refresh-people` is the one route with no schedule. It is also a no-op, so
nothing is currently lost by that.

### `|| true`

Ingestion jobs are wrapped so a failing scraper does not fail the service — the
worst case is stale data and the next tick retries.

The retention sweep is **deliberately not** wrapped. A retention job that fails
silently means personal data kept past the period we told people we would keep
it, and a green dashboard is then actively misleading. Let that one go red.

---

## Verifying

```bash
npm run cron:doctor          # every expected job, oldest problem first
npm run cron:doctor -- --all # including the healthy ones
npm run audit:crons          # every ROUTE has a schedule (static check)
npm run audit:providers      # per-source ingestion ladder
npm run doctor:production    # the whole launch surface
```

Run them **in the Render Shell**, or with `DATABASE_URL` exported at production.
`cron:doctor` prints which database it read for exactly this reason: diagnosing
the wrong one is the fastest way to a confident wrong answer.

### States

| State | Meaning |
|---|---|
| `ok` | Ran within its cadence and succeeded |
| `overdue` | Past `GRACE × cadence` — the scheduler stopped firing it |
| `failing` | Ran, threw |
| `never-run` | **No run has ever been recorded.** The service is missing, misnamed, or 401ing |

---

## Known open item

**`refresh-wikicards` reports `never-run`.**

It is declared in `gf-cron-promotions` *and* in `vercel.json`, its handler writes
a `ScrapeJob` row under target `wikicards` (the same mechanism its healthy
siblings use), and `refresh-results` — which uses the identical `safe()` wrapper
— reports healthy. So the recording path works and the job genuinely has not run.

That points at the Render **service**, not the code: `gf-cron-promotions` is in
the blueprint but a blueprint is only applied on sync. **Action: re-sync the
Render blueprint** (or create the cron service by hand) and confirm with
`npm run cron:doctor`.

Impact while it is down: past events keep their card but never get bouts or
results from Wikipedia — which is the *only* results source for BKFC and ONE.

---

## Registry jobs

Added to `EXPECTED_JOBS` by the data-integrity sprint. That list covered 8 of 22
routes, and the three deciding what the rankings and champions pages publish were
not among them — so "champions are out of date" was invisible to the one tool
built to answer that question.

| Route | Cadence | Matters because |
|---|---|---|
| `refresh-rankings` | weekly | Divisional boards freeze at the last successful run |
| `refresh-p4p` | daily | P4P boards and the derived records behind them go stale |
| `refresh-champions` | daily | Title changes are not picked up — the belt shows the previous holder |

**Expect these to report `never-run` on the first deploy after this change.**
That is correct: a job that has never been observed should say so rather than be
absent from a list claiming to be complete.

---

## Idempotency

Every job in this list can be re-run safely, and several rely on it (`--retry`
in the curl commands).

- **Rankings**: the payload hash short-circuits an unchanged provider entirely;
  observations are `createMany(skipDuplicates)` on a natural key; projection is a
  pure function of the evidence.
- **Champions**: a reign that already agrees with the evidence writes nothing.
- **Media cleanup**: only marks rows `DELETED`; running twice does nothing the
  second time.
- **Results**: upserts keyed on bout identity.

A job that is *not* idempotent has no business on a retrying schedule.
