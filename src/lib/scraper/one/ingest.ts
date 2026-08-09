import "server-only";
import * as cheerio from "cheerio";
import type { FightMethod } from "@prisma/client";
import { prisma } from "@/lib/db";
import { slugify } from "@/lib/utils";
import { log } from "@/lib/scraper/logger";
import { BOT_HEADERS } from "@/lib/http-identity";
import { assertFetchAllowed } from "@/lib/scraper/source-gate";
import { resolveOrCreateFighter } from "@/lib/registry/identity";
import { parseOneResults, validateOneResults, type OneBout } from "./results";
import { matchArticleToEvent, type EventCandidate } from "./match";

// ════════════════════════════════════════════════════════════════════════════
//  ONE ingestion — discovery, matching, and the write.
//
//  The editorial results articles are server-rendered and carry the whole card
//  — see ./results.
//
//  TWO stale claims lived here and both are corrected rather than trimmed,
//  because each sent work in a wrong direction:
//
//    "Target, measured: 251 ONE events with NO BOUTS AT ALL" — production on
//    2026-08-09 measured 490 of 509 ONE events carded, 5,502 bouts, and a full
//    archive sweep produced a delta of zero. The target no longer exists.
//
//    "ONE renders results client-side on its event pages, which is why the
//    existing pipeline could never read them" — never true, and ./results.ts
//    already says so at length: onefc.com server-renders the full card into
//    `div.event-matchup`, which ../extract/matchups reads directly.
//
//  ── What this reuses, rather than rebuilding ─────────────────────────────
//    parseOneResults        the parser, built against a captured page
//    matchArticleToEvent    pure, deterministic, skips rather than guesses
//    resolveOrCreateFighter the ONE canonical identity resolver
//    FightImport            per-bout provenance, already in the schema
//    BOT_HEADERS            the single outbound identity
//
//  ── Idempotent, resume-safe, retry-safe ──────────────────────────────────
//  A bout is keyed on (event, corners), so re-running writes nothing new. The
//  backfill selects events that are STILL empty, so an interrupted run resumes
//  simply by being run again — there is no cursor to lose.
// ════════════════════════════════════════════════════════════════════════════

const LISTING = "https://www.onefc.com/category/live-results/";

/** ONE's own source id, from the provider registry (lib/registry/sources). */
const PROVIDER = "one";

export interface DiscoveredArticle {
  url: string;
  title: string;
}

/**
 * Minimum gap between requests to onefc.com.
 *
 * Not a guess — measured. A backfill run without pacing was rate-limited after
 * roughly a dozen article fetches and every subsequent request returned 429.
 * A backfill covering hundreds of events is a sustained load on somebody else's
 * server, and the polite rate is the one that finishes rather than the one that
 * gets blocked.
 */
const REQUEST_GAP_MS = 1_500;

/** 429 means back off entirely — retrying immediately is the behaviour that earned it. */
export class RateLimited extends Error {
  constructor(url: string) {
    super(`ONE rate-limited (429) at ${url} — backing off`);
    this.name = "RateLimited";
  }
}

let lastRequestAt = 0;

async function fetchText(url: string): Promise<string> {
  // This path predates the shared fetch layer and calls `fetch` directly (it
  // needs its own 1.5s pacing, distinct from the global throttle). That made it
  // the one scraper outbound the source gate could not see, so the check is
  // repeated here explicitly. Any NEW outbound belongs in ../http instead.
  assertFetchAllowed(url);

  const wait = REQUEST_GAP_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();

  const res = await fetch(url, { headers: { ...BOT_HEADERS }, signal: AbortSignal.timeout(25_000) });
  if (res.status === 429) throw new RateLimited(url);
  if (!res.ok) throw new Error(`ONE fetch ${res.status} for ${url}`);
  return res.text();
}

/**
 * Walk the live-results index and collect result articles.
 *
 * `pages` is bounded by the caller. The index is paginated `/page/N/`, and a
 * backfill that walked it without a ceiling would hammer a third party for as
 * long as their archive is deep.
 */
export async function discoverOneArticles(pages = 1, fromPage = 1): Promise<DiscoveredArticle[]> {
  const out = new Map<string, DiscoveredArticle>();
  const first = Math.max(1, fromPage);

  for (let page = first; page < first + Math.max(1, pages); page++) {
    const url = page === 1 ? LISTING : `${LISTING}page/${page}/`;
    let html: string;
    try {
      html = await fetchText(url);
    } catch (e) {
      // A missing page is the end of the archive, not a failure.
      log.warn({ url, err: (e as Error).message }, "one:listing-page-unavailable");
      break;
    }

    const $ = cheerio.load(html);
    $("a.title").each((_, a) => {
      const href = $(a).attr("href");
      // `title` on the anchor carries the FULL headline; the h3 is sometimes
      // truncated with an ellipsis by the theme.
      const title = ($(a).attr("title") ?? $(a).text()).replace(/\s+/g, " ").trim();
      if (!href || !title) return;
      if (!/results-and-highlights/i.test(href)) return;
      out.set(href, { url: href, title });
    });
  }

  return [...out.values()];
}

export interface IngestOutcome {
  url: string;
  status: "written" | "unchanged" | "skipped" | "failed";
  eventId?: string;
  eventName?: string;
  boutsWritten?: number;
  boutsExisting?: number;
  fightersResolved?: number;
  fightersCreated?: number;
  reason?: string;
}

/**
 * Ingest one article: fetch → parse → validate → match → resolve → write.
 *
 * Every failure mode returns rather than throws, so one bad article never stops
 * a backfill.
 */
export async function ingestOneArticle(article: DiscoveredArticle): Promise<IngestOutcome> {
  let bouts: OneBout[];
  try {
    const html = await fetchText(article.url);
    bouts = parseOneResults(html);
    // Fail closed. A partial card is indistinguishable from a real short one.
    validateOneResults(bouts);
  } catch (e) {
    return { url: article.url, status: "failed", reason: (e as Error).message };
  }

  // Candidates: ONE events only. Narrow in SQL rather than loading the table.
  const candidates: EventCandidate[] = await prisma.event.findMany({
    where: { promotion: { contains: "ONE", mode: "insensitive" } },
    select: { id: true, name: true, date: true },
  });

  const match = matchArticleToEvent(article.title, candidates);
  if (!match.ok) {
    // SKIPPED, not guessed — and recorded, so the queue is reviewable rather
    // than a silent gap. See docs/DATA_PIPELINE.
    await queueUnmatched(article, match.reason, match.names);
    return { url: article.url, status: "skipped", reason: match.reason };
  }

  const event = await prisma.event.findUnique({
    where: { id: match.eventId },
    select: { id: true, name: true, date: true, sport: true, _count: { select: { fights: true } } },
  });
  if (!event) return { url: article.url, status: "failed", reason: "event vanished" };

  // ── ONLY FILL EMPTY CARDS ────────────────────────────────────────────────
  // This connector exists to move a measured number: events with NO BOUTS AT
  // ALL. It is not a merge tool, and the first real run proved why that
  // distinction matters — writing into a card another source had already built
  // produced DUPLICATE bouts:
  //
  //   Numsurin Chor Ketwina  vs Songchainoi Kiatsongrit   (existing)
  //   Numsurin Chor.Ketwina  vs Songchainoi Kiatsongrit   (ONE's spelling)
  //
  // The corner-identity check above cannot catch that, because the two
  // spellings resolved to two different fighters — so as far as the check could
  // see, it was a different bout. The underlying duplicate-fighter question is
  // real and belongs to the identity review queue; the answer HERE is simply not
  // to write into a card somebody else owns.
  //
  // Reconciling two sources' versions of the same card is the evidence layer's
  // job, and it needs bout-level observations to do it properly. Until that
  // exists, filling gaps is the honest scope.
  if (event._count.fights > 0) {
    return {
      url: article.url,
      status: "unchanged",
      eventId: event.id,
      eventName: event.name,
      boutsWritten: 0,
      boutsExisting: event._count.fights,
      reason: "card already present",
    };
  }

  let written = 0;
  let existing = 0;
  let resolved = 0;
  let created = 0;

  for (const bout of bouts) {
    const corners = await resolveCorners(bout);
    if (!corners) continue;
    resolved += 2;
    created += corners.created;

    const already = await prisma.fight.findFirst({
      where: {
        eventId: event.id,
        OR: [
          { redId: corners.redId, blueId: corners.blueId },
          { redId: corners.blueId, blueId: corners.redId },
        ],
      },
      select: { id: true },
    });

    if (already) {
      existing++;
      // Provenance is recorded even for a bout we did not create — knowing THIS
      // source also saw it is what makes agreement measurable later.
      await recordProvenance(already.id, article.url, false);
      continue;
    }

    // ── The slug is a URL key, not the bout's identity ──────────────────────
    // Identity is (event, corners) and was already checked above. `Fight.slug`
    // is globally unique, so a rematch — the same two fighters on a differently
    // named card — collides with a bout that is genuinely a different fight.
    // The first run hit exactly that and lost two bouts to a P2002.
    //
    // Resolved the same way the fighter path resolves it: ask the identity
    // question first, then mint a free key.
    const slug = await freeFightSlug(`${event.name}-${bout.redName}-vs-${bout.blueName}`);

    try {
      const fight = await prisma.fight.create({
        data: {
          slug,
          eventId: event.id,
          redId: corners.redId,
          blueId: corners.blueId,
          date: event.date,
          result: bout.result,
          // The WINNER is the red corner, because ONE writes "X defeats Y".
          winnerId: bout.result === "WIN" ? corners.redId : null,
          method: methodEnum(bout.method),
          roundEnded: bout.round ?? undefined,
          timeEnded: bout.time ?? undefined,
          orderOnCard: bout.order,
          mainEvent: bout.order === 0,
          scheduledRounds: 3,
          ...(bout.ruleset ? { ruleset: bout.ruleset as never } : {}),
        },
        select: { id: true },
      });
      await recordProvenance(fight.id, article.url, true);
      written++;
    } catch (e) {
      log.warn({ url: article.url, err: (e as Error).message }, "one:bout-write-failed");
    }
  }

  return {
    url: article.url,
    status: written > 0 ? "written" : "unchanged",
    eventId: event.id,
    eventName: event.name,
    boutsWritten: written,
    boutsExisting: existing,
    fightersResolved: resolved,
    fightersCreated: created,
  };
}

/**
 * Resolve both corners through the canonical resolver.
 *
 * The athlete slug is passed as an EXTERNAL ID, which is the resolver's
 * strongest rung — so the second time ONE publishes a fighter they resolve by id
 * rather than by name, permanently. That is the whole reason this source is
 * worth having over Wikipedia for ONE.
 *
 * Returns null when either corner is unusable: a bout needs two people, and half
 * a bout is worse than none.
 */
async function resolveCorners(
  bout: OneBout,
): Promise<{ redId: string; blueId: string; created: number } | null> {
  const one = async (name: string, externalId: string | null, nickname: string | null) =>
    resolveOrCreateFighter(
      {
        name,
        // ONE runs several disciplines; the BOUT's ruleset is the truth, and MMA
        // is the fallback only when the page did not say.
        sport: (bout.ruleset === "MUAY_THAI" || bout.ruleset === "KICKBOXING" ? bout.ruleset : "MMA") as never,
        nickname,
        externalIds: externalId ? [{ source: PROVIDER, externalId }] : [],
      },
      { origin: "one-results", sportFallback: "MMA" },
    );

  const red = await one(bout.redName, bout.redExternalId, bout.redNickname);
  const blue = await one(bout.blueName, bout.blueExternalId, bout.blueNickname);
  if (!red.fighterId || !blue.fighterId) return null;
  // A bout against oneself is a parse fault, not a fixture.
  if (red.fighterId === blue.fighterId) return null;

  return {
    redId: red.fighterId,
    blueId: blue.fighterId,
    created: (red.created ? 1 : 0) + (blue.created ? 1 : 0),
  };
}

/** A `Fight.slug` nobody holds. See the note at the call site. */
async function freeFightSlug(raw: string): Promise<string> {
  const base = slugify(raw) || "bout";
  let slug = base;
  for (let i = 2; await prisma.fight.findUnique({ where: { slug }, select: { id: true } }); i++) {
    slug = `${base}-${i}`;
  }
  return slug;
}

/** Where this bout came from. Best-effort — the bout itself already landed. */
async function recordProvenance(fightId: string, sourceRef: string, created: boolean): Promise<void> {
  await prisma.fightImport
    .upsert({
      where: { fightId_source: { fightId, source: PROVIDER } },
      // A later touch never re-claims authorship — `created` says whether THIS
      // source brought the row into existence, which is what a rollback needs.
      update: { sourceRef, importedAt: new Date() },
      create: { fightId, source: PROVIDER, sourceRef, created },
    })
    .catch(() => {});
}

/**
 * Record an article we refused to attach.
 *
 * Uses the EXISTING ImportConflict table rather than a new one — it is already
 * the place this codebase records "a source said something we did not act on",
 * and a second queue would be a second thing to remember to read.
 */
async function queueUnmatched(article: DiscoveredArticle, reason: string, names: string[]): Promise<void> {
  const importedValue = JSON.stringify({ reason, title: article.title, candidateNames: names });
  // upsert, not create: the unique is (entity, entityId, field), and a backfill
  // re-run must refresh the same row rather than fail on a P2002 (CLAUDE.md
  // rule 4). Re-running is the normal case — that is what resume-safe means.
  await prisma.importConflict
    .upsert({
      where: { entity_entityId_field: { entity: "Event", entityId: article.url, field: "one:unmatched" } },
      create: {
        entity: "Event",
        entityId: article.url,
        field: "one:unmatched",
        importedValue,
        source: PROVIDER,
      },
      update: { importedValue, resolvedAt: null },
    })
    .catch(() => {});
}

/**
 * ONE's published wording → the FightMethod enum.
 *
 * The enum distinguishes decision TYPES (UD / SD / MD), which is exactly what
 * ONE publishes — so mapping "unanimous decision" to a generic DECISION would
 * throw away information the source gave us for free. Order matters: the
 * specific decisions are tested before the generic word.
 *
 * An unmapped method returns undefined and the column stays NULL rather than
 * being guessed. The published wording is not lost either way — it survives on
 * the bout's provenance.
 */
export function methodEnum(method: string | null): FightMethod | undefined {
  if (!method) return undefined;
  const m = method.toLowerCase();

  if (/\bno contest\b/.test(m)) return "NC";
  if (/\bdraw\b/.test(m)) return "DRAW";
  if (/disqualification|\bdq\b/.test(m)) return "DQ";
  if (/submission|choke|armbar|kimura|heel hook|guillotine/.test(m)) return "SUB";
  // Retirement and corner stoppage are RTD in this vocabulary, NOT TKO —
  // a fighter whose corner pulls them out did not get stopped by strikes.
  if (/retirement|retired|corner stoppage/.test(m)) return "RTD";
  if (/\btko\b|technical knockout|doctor stoppage/.test(m)) return "TKO";
  if (/knockout|\bko\b/.test(m)) return "KO";
  if (/technical decision/.test(m)) return "TD";
  if (/unanimous decision/.test(m)) return "UD";
  if (/split decision/.test(m)) return "SD";
  if (/majority decision/.test(m)) return "MD";
  return undefined;
}

export interface BackfillReport {
  articlesSeen: number;
  written: number;
  unchanged: number;
  skipped: number;
  failed: number;
  boutsAdded: number;
  fightersCreated: number;
  outcomes: IngestOutcome[];
}

/**
 * Walk the archive and fill every ONE event we can match.
 *
 * Resume-safe with no cursor: an article whose bouts already exist writes
 * nothing, so re-running after an interruption simply re-confirms what landed
 * and continues. `limit` bounds a single run so a cron tick stays inside its
 * budget and a backfill is many small runs rather than one long one.
 */
export async function backfillOne(opts: { pages?: number; limit?: number; fromPage?: number } = {}): Promise<BackfillReport> {
  const startPage = Math.max(1, opts.fromPage ?? 1);
  const articles = await discoverOneArticles(opts.pages ?? 1, startPage);
  const limit = Math.max(1, opts.limit ?? 10);

  const report: BackfillReport = {
    articlesSeen: articles.length,
    written: 0, unchanged: 0, skipped: 0, failed: 0,
    boutsAdded: 0, fightersCreated: 0, outcomes: [],
  };

  for (const article of articles.slice(0, limit)) {
    const outcome = await ingestOneArticle(article);
    report.outcomes.push(outcome);
    report[outcome.status] += 1;
    report.boutsAdded += outcome.boutsWritten ?? 0;
    report.fightersCreated += outcome.fightersCreated ?? 0;

    // STOP on a 429 rather than grinding through the rest collecting failures.
    // Continuing after being rate-limited is both rude and pointless: every
    // subsequent request returns 429 and the run reports a wall of red that
    // hides whatever real problem might be underneath. The backfill is resumable
    // by design, so stopping costs nothing but the next run's start.
    if (outcome.status === "failed" && /rate-limited/i.test(outcome.reason ?? "")) {
      log.warn({ after: report.outcomes.length }, "one:backfill:rate-limited-stopping");
      break;
    }
  }

  log.info(
    {
      seen: report.articlesSeen, written: report.written, unchanged: report.unchanged,
      skipped: report.skipped, failed: report.failed,
      bouts: report.boutsAdded, fighters: report.fightersCreated,
    },
    "one:backfill:done",
  );
  return report;
}

// ─── The resumable archive crawl ────────────────────────────────────────────

/** Scope under which ONE's archive position is remembered. */
const ARCHIVE_SCOPE = "archive";

export interface CrawlState {
  /** Index page this run started at. */
  fromPage: number;
  /** Index page the NEXT run should start at. */
  nextPage: number;
  /** True once the crawl has reached the end of the archive. */
  exhausted: boolean;
  report: BackfillReport;
}

/**
 * One nightly slice of the archive, continuing where the last run stopped.
 *
 * ── Why a stored cursor rather than a bigger `--pages` ───────────────────
 * Without one, every run restarts at page 1 and re-reads everything shallower
 * before reaching anything new — so "go deeper" meant passing a larger number
 * by hand and paying for the whole prefix again, against a third party that
 * rate-limits. With it, each run costs a fixed few pages and the archive is
 * consumed steadily by a cron nobody has to think about.
 *
 * ── Two modes, one function ─────────────────────────────────────────────
 * DEEP     — walking backwards through history. Advances the cursor.
 * INCREMENTAL — the archive is exhausted, so only page 1 matters: new
 *               publications appear at the front. The cursor stays put.
 *
 * The switch is automatic: a slice that discovers no articles is the end of the
 * archive, and there is nothing deeper to find.
 */
export async function crawlOneArchive(opts: { pages?: number; limit?: number } = {}): Promise<CrawlState> {
  const pages = Math.max(1, opts.pages ?? 3);
  const started = Date.now();

  const checkpoint = await prisma.providerCheckpoint
    .findUnique({ where: { provider_scope: { provider: PROVIDER, scope: ARCHIVE_SCOPE } } })
    .catch(() => null);

  const exhausted = checkpoint?.exhausted ?? false;
  // Incremental runs always look at page 1; deep runs continue from the cursor.
  const fromPage = exhausted ? 1 : Math.max(1, Number(checkpoint?.cursor ?? "1"));

  const report = await backfillOne({ pages, limit: opts.limit, fromPage });

  // No articles at all in this slice means we have walked off the end.
  const reachedEnd = !exhausted && report.articlesSeen === 0;
  const nextPage = exhausted || reachedEnd ? 1 : fromPage + pages;

  await prisma.providerCheckpoint
    .upsert({
      where: { provider_scope: { provider: PROVIDER, scope: ARCHIVE_SCOPE } },
      create: {
        provider: PROVIDER,
        scope: ARCHIVE_SCOPE,
        cursor: String(nextPage),
        exhausted: exhausted || reachedEnd,
        lastCheckedAt: new Date(),
        // Only a run that actually WROTE something changed anything. Advancing
        // lastChangedAt on every tick would make a dead provider look healthy —
        // the distinction the freshness dashboard depends on.
        ...(report.boutsAdded > 0 ? { lastChangedAt: new Date() } : {}),
        failureStreak: report.failed > 0 && report.written === 0 ? 1 : 0,
        stats: crawlStats(report, fromPage, Date.now() - started),
      },
      update: {
        cursor: String(nextPage),
        exhausted: exhausted || reachedEnd,
        lastCheckedAt: new Date(),
        ...(report.boutsAdded > 0 ? { lastChangedAt: new Date() } : {}),
        failureStreak: report.failed > 0 && report.written === 0 ? { increment: 1 } : 0,
        lastError: report.failed > 0 ? report.outcomes.find((o) => o.status === "failed")?.reason ?? null : null,
        stats: crawlStats(report, fromPage, Date.now() - started),
      },
    })
    .catch(() => {});

  log.info(
    { fromPage, nextPage, exhausted: exhausted || reachedEnd, bouts: report.boutsAdded },
    "one:archive-crawl",
  );

  return { fromPage, nextPage, exhausted: exhausted || reachedEnd, report };
}

function crawlStats(report: BackfillReport, fromPage: number, durationMs: number) {
  return {
    fromPage,
    durationMs,
    articlesSeen: report.articlesSeen,
    rowsInserted: report.boutsAdded,
    rowsSkipped: report.skipped,
    rowsUnchanged: report.unchanged,
    failed: report.failed,
    fightersCreated: report.fightersCreated,
  };
}
