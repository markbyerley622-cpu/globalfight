import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { prisma } from "@/lib/db";
import { resetDb, makeUser, pick } from "./helpers";

// ════════════════════════════════════════════════════════════════════════════
//  Results repair, end-to-end against a REAL Postgres and a STUBBED Wikipedia.
//
//  A local HTTP server stands in for the Wikipedia API, so the whole chain runs for
//  real: search ladder → candidate fetch → card extraction → content verification →
//  corner-pair identity → persist → settlement → payouts. Nothing is mocked inside
//  our own code.
//
//  The production shape under test: boxing/MMA bouts live on SYNTHETIC daily cards
//  ("Boxing — 26 Jul 2026", promotion "Various") that no external source has heard
//  of. Searching by event name — what the code used to do — cannot find them, and
//  1,754 bouts sat behind that.
// ════════════════════════════════════════════════════════════════════════════

const pages = new Map<string, string>();
const searchIndex = new Map<string, string[]>();
let queries: string[] = [];

/** A Wikipedia-shaped results table the real extractor can parse. */
function cardHtml(rows: { red: string; blue: string; method?: string; round?: number; decided?: boolean }[]): string {
  const tr = rows
    .map((r) => {
      const sep = r.decided === false ? "vs." : "def.";
      return `<tr><td>Heavyweight</td><td>${r.red}</td><td>${sep}</td><td>${r.blue}</td>` +
        `<td>${r.method ?? "TKO"}</td><td>${r.round ?? 9}</td><td>1:53</td><td></td></tr>`;
    })
    .join("");
  return `<table class="toccolours"><tbody>${tr}</tbody></table>`;
}

/** A fighter's career-record table, as their Wikipedia biography carries it. */
function recordHtml(_owner: string, rows: { outcome: string; opponent: string; type: string; roundTime: string; date: string }[]): string {
  const tr = rows
    .map((r, i) => `<tr><td>${rows.length - i}</td><td>${r.outcome}</td><td>20-2</td><td>${r.opponent}</td>` +
      `<td>${r.type}</td><td>${r.roundTime}</td><td>${r.date}</td><td>Venue</td></tr>`)
    .join("");
  return `<table class="wikitable"><tr><th>No.</th><th>Result</th><th>Record</th><th>Opponent</th>` +
    `<th>Type</th><th>Round, time</th><th>Date</th><th>Location</th></tr>${tr}</table>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const action = url.searchParams.get("action");
  res.setHeader("content-type", "application/json");

  if (action === "query") {
    const q = url.searchParams.get("srsearch") ?? "";
    queries.push(q);
    const titles = searchIndex.get(q.toLowerCase()) ?? [];
    res.end(JSON.stringify({ query: { search: titles.map((title) => ({ title })) } }));
    return;
  }
  if (action === "parse") {
    const page = url.searchParams.get("page") ?? "";
    const html = pages.get(page);
    if (!html) { res.end(JSON.stringify({ error: { info: "missingtitle" } })); return; }
    res.end(JSON.stringify({ parse: { title: page, text: { "*": html } } }));
    return;
  }
  res.end("{}");
});

// tsx compiles these tests as CJS, so no top-level await: the stub is started and
// the provider imported inside before(). The dynamic import is the point either way —
// the Wikipedia client captures WIKIPEDIA_API_URL at module load, so it must not be
// loaded until the stub is listening.
type Harvest = typeof import("@/lib/scraper/runner")["harvestWikiTargets"];
type FindTargets = typeof import("@/lib/scraper/wikicard")["findWikiTargets"];
type ResultOps = typeof import("@/lib/intelligence/result-ops")["resultOps"];
type PickStatus = typeof import("@/lib/intelligence/pick-status")["pickStatus"];

let harvestWikiTargets: Harvest;
let findWikiTargets: FindTargets;
let resultOps: ResultOps;
let pickStatus: PickStatus;

before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as AddressInfo;
  process.env.WIKIPEDIA_API_URL = `http://127.0.0.1:${port}/w/api.php`;
  process.env.ENABLE_SCRAPER = "true";       // the stub IS the server we're allowed to hit
  process.env.SCRAPER_RATE_LIMIT_MS = "0";   // no throttle against localhost
  process.env.WIKICARD_CONCURRENCY = "1";    // deterministic query order for assertions

  ({ harvestWikiTargets } = await import("@/lib/scraper/runner"));
  ({ findWikiTargets } = await import("@/lib/scraper/wikicard"));
  ({ resultOps } = await import("@/lib/intelligence/result-ops"));
  ({ pickStatus } = await import("@/lib/intelligence/pick-status"));

  await resetDb();
});
beforeEach(async () => {
  await resetDb();
  pages.clear();
  searchIndex.clear();
  queries = [];
});
after(async () => { server.close(); await prisma.$disconnect(); });

// ── fixtures ────────────────────────────────────────────────────────────────

const DAYS_AGO = (n: number) => new Date(Date.now() - n * 86_400_000);

/** A bout on a SYNTHETIC daily card, exactly as the odds pipeline creates it. */
async function syntheticCard(opts: { daysAgo?: number } = {}) {
  const date = DAYS_AGO(opts.daysAgo ?? 2);
  const [red, blue] = await Promise.all([
    prisma.fighter.create({ data: { slug: "errol-spence-jr", name: "Errol Spence Jr", sport: "BOXING" } }),
    prisma.fighter.create({ data: { slug: "tim-tszyu", name: "Tim Tszyu", sport: "BOXING" } }),
  ]);
  const event = await prisma.event.create({
    data: {
      slug: `boxing-${date.toISOString().slice(0, 10)}`,
      name: `Boxing — ${date.getUTCDate()} Jul 2026`,
      sport: "BOXING", promotion: "Various", date, status: "SCHEDULED",
    },
  });
  const fight = await prisma.fight.create({
    data: {
      slug: "errol-spence-jr-vs-tim-tszyu",
      eventId: event.id, redId: red.id, blueId: blue.id, date, scheduledRounds: 12,
    },
  });
  return { red, blue, event, fight };
}

/** A real promotion card. */
async function realCard() {
  const date = DAYS_AGO(3);
  const [red, blue] = await Promise.all([
    prisma.fighter.create({ data: { slug: "mike-perry", name: "Mike Perry", sport: "BARE_KNUCKLE" } }),
    prisma.fighter.create({ data: { slug: "eddie-alvarez", name: "Eddie Alvarez", sport: "BARE_KNUCKLE" } }),
  ]);
  const event = await prisma.event.create({
    data: { slug: "bkfc-91", name: "BKFC 91", sport: "BARE_KNUCKLE", promotion: "BKFC", date, status: "SCHEDULED" },
  });
  const fight = await prisma.fight.create({
    data: { slug: "mike-perry-vs-eddie-alvarez", eventId: event.id, redId: red.id, blueId: blue.id, date, scheduledRounds: 5 },
  });
  return { red, blue, event, fight };
}

const index = (query: string, titles: string[]) => searchIndex.set(query.toLowerCase(), titles);

// ── 1. synthetic event resolved by BOUT search ──────────────────────────────

test("a SYNTHETIC card resolves via the bout search — the 1,754-bout fix", async () => {
  const { event, fight, red } = await syntheticCard();

  // Wikipedia knows the BOUT, not our container.
  index("Errol Spence Jr vs Tim Tszyu", ["Errol Spence Jr. vs. Tim Tszyu"]);
  pages.set("Errol Spence Jr. vs. Tim Tszyu", cardHtml([{ red: "Errol Spence Jr", blue: "Tim Tszyu" }]));

  const line = await harvestWikiTargets({ gap: "missing_result", limit: 10, mode: "historical" });
  assert.match(line, /verified=1/, line);
  assert.match(line, /via\[main_bout=1\]/, "the winning strategy must be reported");

  // The result landed on the EXISTING bout, under the ORIGINAL event.
  const fights = await prisma.fight.findMany({ where: { eventId: event.id } });
  assert.equal(fights.length, 1, "no duplicate bout");
  assert.equal(fights[0].id, fight.id);
  assert.equal(fights[0].result, "WIN");
  assert.equal(fights[0].winnerId, red.id, "\"def.\" means the left fighter won");
  assert.equal(await prisma.event.count(), 1, "no duplicate event");

  // Our container name was never sent upstream.
  assert.ok(!queries.some((q) => /Boxing —/.test(q)), `synthetic name was searched: ${queries.join(" | ")}`);
});

// ── 2. real event resolved by EVENT search, in one query ────────────────────

test("a REAL card resolves on its own title, first try", async () => {
  const { event, fight } = await realCard();
  index("BKFC 91", ["BKFC 91"]);
  pages.set("BKFC 91", cardHtml([{ red: "Mike Perry", blue: "Eddie Alvarez", method: "KO", round: 2 }]));

  const line = await harvestWikiTargets({ gap: "missing_result", limit: 10, mode: "historical" });
  assert.match(line, /verified=1/);
  assert.match(line, /via\[event_title=1\]/);
  assert.equal(queries[0], "BKFC 91", "the event title is tried first");

  const fresh = await prisma.fight.findUniqueOrThrow({ where: { id: fight.id } });
  assert.equal(fresh.result, "WIN");
  assert.equal(fresh.method, "KO");
  assert.equal(fresh.roundEnded, 2);
  assert.equal((await prisma.fight.findMany({ where: { eventId: event.id } })).length, 1);
});

// ── 3. alias-based lookup ──────────────────────────────────────────────────

test("a bout reachable only under a registry ALIAS still resolves", async () => {
  const date = DAYS_AGO(2);
  const [red, blue] = await Promise.all([
    prisma.fighter.create({ data: { slug: "tyson-fury", name: "Tyson Fury", nickname: "The Gypsy King", sport: "BOXING" } }),
    prisma.fighter.create({ data: { slug: "mariusz-wach", name: "Mariusz Wach", sport: "BOXING" } }),
  ]);
  const event = await prisma.event.create({
    data: { slug: "boxing-alias", name: "Boxing — 24 Jul 2026", sport: "BOXING", promotion: "Various", date, status: "SCHEDULED" },
  });
  const fight = await prisma.fight.create({
    data: { slug: "tyson-fury-vs-mariusz-wach", eventId: event.id, redId: red.id, blueId: blue.id, date, scheduledRounds: 12 },
  });

  // The plain bout query finds nothing; only the NICKNAME query hits.
  index("the gypsy king vs Mariusz Wach", ["Tyson Fury vs Mariusz Wach"]);
  pages.set("Tyson Fury vs Mariusz Wach", cardHtml([{ red: "Tyson Fury", blue: "Mariusz Wach", method: "KO", round: 4 }]));

  const line = await harvestWikiTargets({ gap: "missing_result", limit: 10, mode: "historical" });
  assert.match(line, /verified=1/, line);
  assert.match(line, /via\[alias_bout=1\]/, "the alias strategy must be credited");
  const fresh = await prisma.fight.findUniqueOrThrow({ where: { id: fight.id } });
  assert.equal(fresh.result, "WIN");
  assert.equal(fresh.roundEnded, 4);
});

// ── 4. a wrong page is REJECTED — loose query, strict acceptance ────────────

test("a page about OTHER fighters is refused, and the bout stays honestly unresolved", async () => {
  const { fight } = await syntheticCard();
  // Search hits, but the article is a different fight entirely.
  index("Errol Spence Jr vs Tim Tszyu", ["Terence Crawford vs. Israil Madrimov"]);
  index("Errol Spence Jr Tim Tszyu", ["Terence Crawford vs. Israil Madrimov"]);
  pages.set("Terence Crawford vs. Israil Madrimov", cardHtml([{ red: "Terence Crawford", blue: "Israil Madrimov" }]));

  const line = await harvestWikiTargets({ gap: "missing_result", limit: 10, mode: "historical" });
  assert.match(line, /verified=0/, line);
  // Refused at scoring, BEFORE any fetch — so the honest reason is "all_rejected"
  // (the search found junk), not "unverified" (we read a card that wasn't ours).
  assert.match(line, /allRejected=1/, "the failure must be named, not silent");
  assert.match(line, /parses=0/, "and it must not have cost a page fetch");

  const fresh = await prisma.fight.findUniqueOrThrow({ where: { id: fight.id } });
  assert.equal(fresh.result, "SCHEDULED", "nothing may be written from an unverified page");
  assert.equal(await prisma.fight.count(), 1, "and no fighters/bouts invented from it");
});

// ── 5. settlement fires from the repair, with no cron ───────────────────────

test("a repaired result SETTLES its predictions in the same pass", async () => {
  const { fight } = await syntheticCard();
  const [hit, miss] = await Promise.all([makeUser(), makeUser()]);
  await pick(hit.id, fight.id, "RED", 5);
  await pick(miss.id, fight.id, "BLUE", 3);

  index("Errol Spence Jr vs Tim Tszyu", ["Errol Spence Jr. vs. Tim Tszyu"]);
  pages.set("Errol Spence Jr. vs. Tim Tszyu", cardHtml([{ red: "Errol Spence Jr", blue: "Tim Tszyu" }]));

  await harvestWikiTargets({ gap: "missing_result", limit: 10, mode: "historical" });

  const f = await prisma.fight.findUniqueOrThrow({ where: { id: fight.id } });
  const graded = await prisma.fightPick.findMany({ where: { fightId: fight.id } });
  assert.equal(graded.length, 2);
  for (const g of graded) assert.notEqual(g.correct, null, "every pick must be graded");
  assert.equal(pickStatus(graded.find((g) => g.userId === hit.id)!, f), "SETTLED_CORRECT");
  assert.equal(pickStatus(graded.find((g) => g.userId === miss.id)!, f), "SETTLED_INCORRECT");

  const winner = await prisma.user.findUniqueOrThrow({ where: { id: hit.id } });
  assert.equal(winner.picksCorrect, 1);
  assert.ok(winner.reputation > 0, "the payout reached the reader who called it");
  assert.ok(f.picksResolvedAt, "the bout is stamped settled");
  assert.equal((await resultOps()).unsettledPicks, 0, "no drift left behind");

  // And the reader was told.
  assert.ok((await prisma.notification.count({ where: { userId: hit.id, type: "PICK_RESULT" } })) >= 1);
});

// ── 6. idempotent replay ───────────────────────────────────────────────────

test("running the repair TWICE produces an identical end state", async () => {
  const { fight } = await syntheticCard();
  const user = await makeUser();
  await pick(user.id, fight.id, "RED", 4);

  index("Errol Spence Jr vs Tim Tszyu", ["Errol Spence Jr. vs. Tim Tszyu"]);
  pages.set("Errol Spence Jr. vs. Tim Tszyu", cardHtml([{ red: "Errol Spence Jr", blue: "Tim Tszyu" }]));

  await harvestWikiTargets({ gap: "missing_result", limit: 10, mode: "historical" });
  const snap = async () => ({
    fights: await prisma.fight.count(),
    events: await prisma.event.count(),
    fighters: await prisma.fighter.count(),
    rep: (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).reputation,
    ledger: await prisma.reputationEvent.count({ where: { userId: user.id } }),
    correct: (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).picksCorrect,
    cards: await prisma.cardAward.count(),
  });
  const first = await snap();

  // Second and third passes: the bout is now decided, so it is no longer a target —
  // and even if it were, identity and the settlement claim make the write a no-op.
  await harvestWikiTargets({ gap: "missing_result", limit: 10, mode: "historical" });
  await harvestWikiTargets({ gap: "missing_result", limit: 10, mode: "historical" });

  assert.deepEqual(await snap(), first, "replay must change nothing");
  assert.equal(first.ledger, 1, "reputation awarded exactly once");
});

// ── 7. the window: incremental vs historical ────────────────────────────────

test("historical mode reaches an OLD bout that incremental deliberately skips", async () => {
  // 400 days old — far outside the incremental window, which exists for lag.
  const { fight } = await syntheticCard({ daysAgo: 400 });
  index("Errol Spence Jr vs Tim Tszyu", ["Errol Spence Jr. vs. Tim Tszyu"]);
  pages.set("Errol Spence Jr. vs. Tim Tszyu", cardHtml([{ red: "Errol Spence Jr", blue: "Tim Tszyu" }]));

  // Incremental: not a target at all.
  const incremental = await findWikiTargets({ gap: "missing_result", mode: "incremental", limit: 10 });
  assert.equal(incremental.length, 0, "an old bout is historical debt, not lag");

  // Historical: reached and repaired.
  const line = await harvestWikiTargets({ gap: "missing_result", limit: 10, mode: "historical" });
  assert.match(line, /verified=1/, line);
  assert.equal((await prisma.fight.findUniqueOrThrow({ where: { id: fight.id } })).result, "WIN");
});

test("the window is configurable rather than hard-coded", async () => {
  await syntheticCard({ daysAgo: 30 });
  assert.equal(
    (await findWikiTargets({ gap: "missing_result", mode: "incremental", windowDays: 7, limit: 10 })).length,
    0,
    "a 30-day-old bout is outside a 7-day window",
  );
  assert.equal(
    (await findWikiTargets({ gap: "missing_result", mode: "incremental", windowDays: 60, limit: 10 })).length,
    1,
    "and inside a 60-day one",
  );
});

// ── 8. batch walking ───────────────────────────────────────────────────────

test("skip walks the backlog instead of re-attempting the same head", async () => {
  // Two unresolvable events; the second is only reachable with skip.
  for (const n of [2, 3]) {
    const date = DAYS_AGO(n);
    const [r, b] = await Promise.all([
      prisma.fighter.create({ data: { slug: `red-${n}`, name: `Red ${n}`, sport: "BOXING" } }),
      prisma.fighter.create({ data: { slug: `blue-${n}`, name: `Blue ${n}`, sport: "BOXING" } }),
    ]);
    const ev = await prisma.event.create({
      data: { slug: `boxing-b${n}`, name: `Boxing — ${n} Jul 2026`, sport: "BOXING", promotion: "Various", date, status: "SCHEDULED" },
    });
    await prisma.fight.create({ data: { slug: `red-${n}-vs-blue-${n}`, eventId: ev.id, redId: r.id, blueId: b.id, date } });
  }

  const first = await findWikiTargets({ gap: "missing_result", mode: "historical", limit: 1 });
  const second = await findWikiTargets({ gap: "missing_result", mode: "historical", limit: 1, skip: 1 });
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.notEqual(first[0].eventIdentity.name, second[0].eventIdentity.name, "skip must advance");
});

// ── retrieval v2: precision, and what may be written ────────────────────────

test("a SEASON page attaches only OUR bout, not every card of the year", async () => {
  // The bug: "2026 in Bare Knuckle Fighting Championship" carries every BKFC card of
  // the year. It verifies correctly (our bout really is on it) and, when the whole
  // parsed table was persisted, dumped ~190 bouts onto a 1-bout event. A real run
  // reported 3,803 bouts across 20 events. That is fabricated card data.
  const { event, fight } = await realCard();

  index("BKFC 91", ["2026 in Bare Knuckle Fighting Championship"]);
  pages.set(
    "2026 in Bare Knuckle Fighting Championship",
    cardHtml([
      { red: "Mike Perry", blue: "Eddie Alvarez", method: "KO", round: 2 }, // ours
      { red: "Someone Else", blue: "Another Person" },
      { red: "Third Fighter", blue: "Fourth Fighter" },
      { red: "Fifth Fighter", blue: "Sixth Fighter" },
    ]),
  );

  const line = await harvestWikiTargets({ gap: "missing_result", limit: 10, mode: "historical" });
  assert.match(line, /verified=1/, line);

  const fights = await prisma.fight.findMany({ where: { eventId: event.id } });
  assert.equal(fights.length, 1, `only our bout may be attached, got ${fights.length}`);
  assert.equal(fights[0].id, fight.id);
  assert.equal(fights[0].result, "WIN");
  // And no stray fighters were invented from the other cards on that page.
  const names = (await prisma.fighter.findMany({ select: { name: true } })).map((f) => f.name);
  assert.ok(!names.includes("Third Fighter"), `strangers were created: ${names.join(", ")}`);
});

test("unrelated candidates are REFUSED BEFORE any page fetch", async () => {
  const { fight } = await syntheticCard();
  // Exactly the junk a real search returned for this bout.
  index("Errol Spence Jr vs Tim Tszyu", ["Kansas City Chiefs", "List of documentary films", "Dept. Q"]);
  index("Errol Spence Jr Tim Tszyu", ["Heart of Midlothian F.C."]);
  for (const t of ["Kansas City Chiefs", "List of documentary films", "Dept. Q", "Heart of Midlothian F.C."]) {
    pages.set(t, cardHtml([{ red: "Nobody Here", blue: "Nor Here" }]));
  }

  const line = await harvestWikiTargets({ gap: "missing_result", limit: 10, mode: "historical" });
  assert.match(line, /verified=0/, line);
  assert.match(line, /parses=0/, "not one of those pages may be fetched");
  assert.ok(line.includes("rejected="), line);
  assert.equal((await prisma.fight.findUniqueOrThrow({ where: { id: fight.id } })).result, "SCHEDULED");
});

test("OUR fighter's biography IS read, and its career record yields the result", async () => {
  // The real search for this bout returns the two fighters' own pages and no fight
  // article — which is true for most of the backlog. The bio carries the record table,
  // and its row for this bout is the only published result that exists.
  const { fight, red } = await syntheticCard();
  const eventDate = (await prisma.event.findFirstOrThrow({ where: { id: fight.eventId! } })).date;
  const d = `${eventDate.getUTCDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][eventDate.getUTCMonth()]} ${eventDate.getUTCFullYear()}`;

  index("Errol Spence Jr vs Tim Tszyu", ["Tim Tszyu"]);
  pages.set("Tim Tszyu", recordHtml("Tim Tszyu", [
    { outcome: "Loss", opponent: "Errol Spence Jr", type: "TKO", roundTime: "9 (12), 1:41", date: d },
    { outcome: "Win", opponent: "Somebody Else", type: "UD", roundTime: "12 (12)", date: "1 Jan 2025" },
  ]));

  const line = await harvestWikiTargets({ gap: "missing_result", limit: 10, mode: "historical" });
  assert.match(line, /verified=1/, line);

  const fresh = await prisma.fight.findUniqueOrThrow({ where: { id: fight.id } });
  assert.equal(fresh.result, "WIN");
  assert.equal(fresh.winnerId, red.id, "a LOSS on Tszyu's record means Spence won");
  assert.equal(fresh.method, "TKO");
  assert.equal(fresh.roundEnded, 9);
});

test("a record row for a DIFFERENT date is never used — rematches stay distinct", async () => {
  const { fight } = await syntheticCard();
  index("Errol Spence Jr vs Tim Tszyu", ["Tim Tszyu"]);
  // Right opponent, wrong year.
  pages.set("Tim Tszyu", recordHtml("Tim Tszyu", [
    { outcome: "Loss", opponent: "Errol Spence Jr", type: "TKO", roundTime: "9 (12), 1:41", date: "1 Jan 2020" },
  ]));

  const line = await harvestWikiTargets({ gap: "missing_result", limit: 10, mode: "historical" });
  assert.match(line, /verified=0/, line);
  assert.equal((await prisma.fight.findUniqueOrThrow({ where: { id: fight.id } })).result, "SCHEDULED");
});

test("SOMEONE ELSE's biography is still refused before any fetch", async () => {
  const { fight } = await syntheticCard();
  index("Errol Spence Jr vs Tim Tszyu", ["Jermall Charlo", "Sebastian Fundora"]);
  for (const t of ["Jermall Charlo", "Sebastian Fundora"]) {
    pages.set(t, recordHtml(t, [{ outcome: "Win", opponent: "Errol Spence Jr", type: "KO", roundTime: "1 (12)", date: "1 Jan 2026" }]));
  }
  const line = await harvestWikiTargets({ gap: "missing_result", limit: 10, mode: "historical" });
  assert.match(line, /parses=0/, `an unrelated bio must not be fetched: ${line}`);
  assert.equal((await prisma.fight.findUniqueOrThrow({ where: { id: fight.id } })).result, "SCHEDULED");
});

test("the page cache fetches a shared season page ONCE across many targets", async () => {
  // Twelve BKFC events all resolving to the same 551 KB season page fetched it twelve
  // times, because the de-dup set was per-target.
  const date = DAYS_AGO(3);
  const created: string[] = [];
  for (let i = 0; i < 3; i++) {
    const [r, b] = await Promise.all([
      prisma.fighter.create({ data: { slug: `bk-red-${i}`, name: `BkRed ${i}`, sport: "BARE_KNUCKLE" } }),
      prisma.fighter.create({ data: { slug: `bk-blue-${i}`, name: `BkBlue ${i}`, sport: "BARE_KNUCKLE" } }),
    ]);
    const ev = await prisma.event.create({
      data: { slug: `bkfc-9${i}`, name: `BKFC 9${i}`, sport: "BARE_KNUCKLE", promotion: "BKFC", date, status: "SCHEDULED" },
    });
    await prisma.fight.create({ data: { slug: `bk-red-${i}-vs-bk-blue-${i}`, eventId: ev.id, redId: r.id, blueId: b.id, date } });
    index(`BKFC 9${i}`, ["2026 in Bare Knuckle Fighting Championship"]);
    created.push(`BkRed ${i}`);
  }
  pages.set(
    "2026 in Bare Knuckle Fighting Championship",
    cardHtml(created.map((_, i) => ({ red: `BkRed ${i}`, blue: `BkBlue ${i}` }))),
  );

  const line = await harvestWikiTargets({ gap: "missing_result", limit: 10, mode: "historical" });
  assert.match(line, /verified=3/, line);
  // Three targets, one page: two of the three reads must be cache hits.
  assert.match(line, /cacheHits=2/, line);

  // Each event got exactly its OWN bout, from the same shared page.
  for (let i = 0; i < 3; i++) {
    const ev = await prisma.event.findFirstOrThrow({ where: { slug: `bkfc-9${i}` }, include: { fights: true } });
    assert.equal(ev.fights.length, 1, `event ${i} got ${ev.fights.length} bouts`);
    assert.equal(ev.fights[0].result, "WIN");
  }
});

test("CARD backfill still works — accepted on its title, whole card attached", async () => {
  // An event with no bouts has nothing to verify against, so verifyCard can never
  // accept it. Content verification alone silently broke this entire gap.
  const date = DAYS_AGO(5);
  const event = await prisma.event.create({
    data: { slug: "one-fn-39", name: "ONE Fight Night 39", sport: "MUAY_THAI", promotion: "ONE Championship", date, status: "SCHEDULED" },
  });
  index("ONE Fight Night 39", ["ONE Fight Night 39: Superlek vs Takeru"]);
  pages.set(
    "ONE Fight Night 39: Superlek vs Takeru",
    cardHtml([
      { red: "Superlek Kiatmoo9", blue: "Takeru Segawa", method: "UD" },
      { red: "Nong-O Hama", blue: "Kulabdam Sor" },
    ]),
  );

  const line = await harvestWikiTargets({ gap: "missing_card", limit: 10, mode: "historical" });
  assert.match(line, /verified=1/, line);
  const fresh = await prisma.event.findUniqueOrThrow({ where: { id: event.id }, include: { fights: true } });
  assert.equal(fresh.fights.length, 2, "a card-gap event legitimately takes the whole card");
});

test("card backfill refuses a page whose title is a different event", async () => {
  const date = DAYS_AGO(5);
  const event = await prisma.event.create({
    data: { slug: "one-fn-40", name: "ONE Fight Night 40", sport: "MUAY_THAI", promotion: "ONE Championship", date, status: "SCHEDULED" },
  });
  index("ONE Fight Night 40", ["ONE Fight Night 39: Superlek vs Takeru"]);
  pages.set("ONE Fight Night 39: Superlek vs Takeru", cardHtml([{ red: "Superlek Kiatmoo9", blue: "Takeru Segawa" }]));

  await harvestWikiTargets({ gap: "missing_card", limit: 10, mode: "historical" });
  const fresh = await prisma.event.findUniqueOrThrow({ where: { id: event.id }, include: { fights: true } });
  assert.equal(fresh.fights.length, 0, "event 39's card must not be attached to event 40");
});

test("the CARD queue rotates — a second pass gets the events the first one missed", async () => {
  // The result queue has been a least-recently-attempted rotation for a while.
  // The card queue was still `orderBy: { date: "desc" }`, so it handed back the
  // same newest N on every single call and everything behind them was never
  // attempted ONCE — ONE Championship sat on 97 empty cards, all of them
  // reported by the audit as "never attempted", for exactly this reason.
  //
  // No page is indexed here on purpose. Every target MISSES, which is the case
  // that used to loop forever: a batch that resolves nothing must still hand the
  // next batch different work.
  const dates = [10, 11, 12, 13];
  for (const [i, d] of dates.entries()) {
    await prisma.event.create({
      data: {
        slug: `one-ff-${i + 1}`, name: `ONE Friday Fights ${i + 1}`, sport: "MUAY_THAI",
        promotion: "ONE Championship", date: DAYS_AGO(d), status: "SCHEDULED",
      },
    });
  }

  const namesOf = async () =>
    (await findWikiTargets({ gap: "missing_card", mode: "historical", limit: 2 }))
      .map((t) => t.eventIdentity.name);

  const first = await namesOf();
  assert.equal(first.length, 2);

  // Stamping the attempt is what the harvest does via recordResultAttempts. Do it
  // directly so this test covers the ORDERING and not the network mock.
  await prisma.event.updateMany({
    where: { name: { in: first } },
    data: { resultAttemptAt: new Date(), resultAttempts: 1, resultAttemptReason: "no_candidate" },
  });

  const second = await namesOf();
  assert.equal(second.length, 2);
  for (const name of second) {
    assert.ok(!first.includes(name), `pass 2 re-served "${name}" while 2 events had never been tried`);
  }

  // And the whole backlog is reachable, which is the property that actually
  // drains it — four events, two passes of two, no repeats.
  assert.deepEqual([...first, ...second].sort(), dates.map((_, i) => `ONE Friday Fights ${i + 1}`).sort());
});
