# BKFC ingestion provider

A resilient scraper for [bkfc.com](https://www.bkfc.com) that emits GlobalFight's
canonical `Normalized*` entities (`sport = BARE_KNUCKLE`). It is a **pure data
provider** — acquisition + transformation only. `syncBKFC()` returns canonical
entities; the shared ingestion pipeline (`src/services/sync/persist.ts`) owns
persistence, dedupe, identity resolution and provenance.

## Responsibilities

The provider **does**: discover pages (sitemap) → fetch → extract (JSON-LD + Webflow
DOM) → normalize → validate → map to `Normalized{Event,Fighter,Ranking,Article}` →
return a `BkfcHarvest`.

The provider **does not**: write Prisma, upsert, dedupe, snapshot, own metrics, or
know about the ingestion registry. Those belong to the shared framework. The runner
(`src/lib/scraper/runner.ts`, kind `"bkfc"`) takes the harvest and calls
`persistAggregated("BARE_KNUCKLE", "events"|"fighters", …)`.

## ⚠️ One gate (the registry gate was removed)

1. **`ENABLE_SCRAPER=true`** — required for *any* fetch (shared `../http.ts`). Off by
   default, so `syncBKFC()` fetches nothing until set. This is now the **only** switch.
2. ~~The `bkfc-*` ingestion-registry entries~~ — **removed 2026-08-01** on the operator's
   instruction, to allow ingestion from sources without an established licence.
   `isSourceEnabled()` returns `true` for every id, so the runner's calls no longer hold
   anything back: with `ENABLE_SCRAPER=true`, everything the harvest carries is written.
   The `bkfc-*` entries in `src/lib/ingestion-registry.ts` survive as a record of what we
   know about the terms — `bkfc-rankings` is an editorial compilation and `bkfc-news` is
   `Disallow: /news` in robots.txt. Nothing enforces that now; read it before pointing a
   scraper. To reinstate the gate, restore the one-line body of `isSourceEnabled()`.

## Usage

```ts
import { syncBKFC } from "@/lib/scraper/bkfc";
import { persistAggregated } from "@/services/sync/persist";

const harvest = await syncBKFC({ mode: "daily" });
// harvest.events / .fighters / .rankings / .news / .videos are canonical entities.
await persistAggregated("BARE_KNUCKLE", "fighters", harvest.fighters); // pipeline persists

// Single record
await syncBKFC({ mode: "event", slug: "bkfc-10-lombard-vs-mundell" });
await syncBKFC({ mode: "fighter", slug: "aaron-chalmers" });
await syncBKFC({ mode: "full", entities: ["events"], maxPages: 50 });
```

Cron: `GET /api/cron/refresh-bkfc` (Bearer `SCRAPE_CRON_SECRET`) → `refresh("bkfc")` →
`syncBKFC({ mode: "daily" })` → gated `persistAggregated`.

### Modes

| mode      | scope                                                        |
|-----------|-------------------------------------------------------------|
| `full`    | every URL in the sitemap (use `maxPages` on serverless)     |
| `daily`   | all events + all fighters + 100 most-recent news            |
| `hourly`  | events + 25 most-recent news                                |
| `event`   | one event by `slug`                                         |
| `fighter` | one fighter by `slug`                                       |

## Design

Discovery is a single `sitemap.xml` fetch (≈170 events / 1.5k fighters / 1.9k news),
classified by path — no crawl queue. Each page is parsed two ways:

1. **JSON-LD** (`schema.org/Event`, `Person`, `SportsOrganization`) — poster, date,
   venue, socials.
2. **Webflow DOM** via cheerio — fight cards, records, stats, rankings.

BKFC is a Webflow site — there is **no Next.js data layer or JSON API**, so those
extraction stages are intentionally absent.

### Results — read from the page's own official feed

Event results are genuinely **not in the static HTML**, and that was verified rather
than assumed: a completed card ships all four result variants unmarked
(`data-cond-key="RedResult"`, values win/lose/draw/no contest) and
`<p data-render="WinMethod">TBU</p>` as the placeholder.

What the old note got wrong was the conclusion — that results were therefore
unavailable "until a licensed results feed is available". **The page declares that
feed itself**, in an inline script, as an unauthenticated GET:

```js
const FINAL_STATS = 'https://xapi.mmareg.com/api/bkfc?type=json&modifier=event-stats&id=312';
```

`results-feed.ts` extracts the URL (pure), `sync.ts` fetches it, and the feed card
**supersedes** the DOM card — it carries the same matchups plus result, method,
round, time, weight class, ruleset, scheduled rounds and referee.

Measured over 24 events sampled across every slug family:

| | |
|---|---|
| feed present → full results | 20 events, **207 bouts, 207 decided** |
| no feed URL | 4 — *all four are future events* |
| round / time / weight class / both athlete UUIDs | 207 / 207 |
| method | 206 (one bout genuinely states none) |

Three response shapes exist and all are handled: **v1** `Bouts` is an array, **v2**
`/api/v2/` keys it `Bout1..BoutN` as an object, and one page embeds `type=xml`
(forced back to JSON). A parser assuming the array shape reads 11 of 20 events as empty.

`BoutNumber` **ascends from the first prelim — the main event is LAST** (the opposite
of ONE). The card is emitted main-event-first so `orderOnCard` matches every other provider.

Corner identity resolves the feed's athletes back to **bkfc.com page slugs** (the
namespace our fighters are already stored under) inside each card's closed set —
90% resolve, with zero ambiguous matches; a miss emits no external id and lets the
shared dedupe engine resolve by name.

⚠️ `xapi.mmareg.com` is a **third-party host** with its own registry entry
(`bkfc-results`). Read its `basis` before production use.

### Other known limits (honest nulls, never fabricated data)
- **Images are not re-hosted** — source URLs only.
- **Videos** only surface when a page carries a YouTube id; BKFC's own PPV embeds
  (gigcasters) have none and are reported but not mapped to `FeedVideo`.

### Idempotency & dedup

Owned by the shared pipeline, not the provider. `persistAggregated` resolves identity
via the dedupe engine (`services/dedupe`) and upserts on slug / `_meta.externalId`
(the BKFC page slug), recording provenance in `FighterExternalId` / `EventExternalId`.
Re-running never duplicates. `sport` is written on create only.

## Config (env)

| var                   | default | purpose                                     |
|-----------------------|---------|---------------------------------------------|
| `ENABLE_SCRAPER`      | *unset* | master gate — must be `true` to fetch       |
| `BKFC_CONCURRENCY`    | `3`     | parse concurrency (requests still throttled) |
| `BKFC_MAX_PAGES`      | `0`     | per-run page cap (0 = unlimited)            |
| `BKFC_SITEMAP_URL`    | bkfc.com/sitemap.xml | discovery source override      |
| `SCRAPER_RATE_LIMIT_MS` | `5000` | shared inter-request throttle              |
| `SCRAPER_MAX_RETRIES` | `2`     | shared: 5xx retries (429/4xx never retried) |

## Tests

`npm run test:bkfc` — Node's built-in runner over real captured HTML fixtures
(`__tests__/fixtures/`): normalization, parser selectors + resilience (empty/broken
HTML), canonical mapping, and the validation gate.

## Enabling in production (checklist)

1. Obtain and document a real legal basis (licence / written permission). No code enforces
   this any more — the registry gate is gone — so it is a process step, not a build error.
2. Update the relevant `bkfc-*` entries in `ingestion-registry.ts` (`basis`, `enabled`,
   `permittedFields`) so the public /data-sources page tells the truth about what you take.
3. Set `ENABLE_SCRAPER=true`.
4. Schedule `GET /api/cron/refresh-bkfc`; use `mode:"daily"` + `BKFC_MAX_PAGES` to keep
   a run within the cron `maxDuration`.
