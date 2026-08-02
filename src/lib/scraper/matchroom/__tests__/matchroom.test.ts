import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMatchroomEvent, parseMatchroomDate } from "../extract";
import { syncMatchroom } from "../sync";

// Markup taken from the live joshua-vs-prenga page.
//
// The DATE is pushed to 2099 deliberately. The fixture originally used the real
// 25 July 2026 and the "upcoming" tests passed — until today, 2 August 2026,
// when that date fell into the past and four tests began asserting the opposite
// of what they mean. A fixture dated in the real near-future silently rots.
//
// The selectors are the contract with Matchroom's template; if a redesign moves
// them these fail loudly rather than the provider returning zero cards in
// silence.
const CARD = `
<body>
  <div class="single-event-hero">
    <h1 class="event-title">Joshua vs Prenga</h1>
    <div class="event-details">
      <p class="event-date">Saturday 25 July 2099</p>
    </div>
  </div>
  <a href="https://webook.com/en/events/joshua-prenga">Buy tickets</a>
  <p>Watch on DAZN</p>
  <div class="undercard"><div class="container">
    <div class="fight">
      <div class="boxer-1"><h2><span>Anthony </span><span>Joshua</span></h2></div>
      <div class="vs"><p class="additional-information">Heavyweight</p><p>VS</p></div>
      <div class="boxer-2"><h2><span>Kristian </span><span>Prenga</span></h2></div>
    </div>
    <div class="fight">
      <div class="boxer-1"><h2><span>Hamzah </span><span>Sheeraz</span></h2></div>
      <div class="vs"><p class="additional-information">WBO World Super Middleweight Title</p><p>VS</p></div>
      <div class="boxer-2"><h2><span>Simon </span><span>Zachenhuber</span></h2></div>
    </div>
    <div class="fight">
      <div class="boxer-1"><h2><span>Josh </span><span>Kelly</span></h2></div>
      <div class="vs"><p class="additional-information">IBF World Super Welterweight Title</p><p>VS</p></div>
      <div class="boxer-2"><h2><span>Caoimhin </span><span>Agyarko</span></h2></div>
    </div>
  </div></div>
</body>`;

const TBA_CARD = CARD.replace("<span>Kristian </span><span>Prenga</span>", "<span>TBA</span>");

// ── extraction ────────────────────────────────────────────────────────────

test("a card yields its date, name, broadcaster, tickets and full bout list", () => {
  const c = parseMatchroomEvent(CARD)!;
  assert.equal(c.name, "Joshua vs Prenga");
  assert.equal(c.date?.slice(0, 10), "2099-07-25");
  assert.equal(c.broadcaster, "DAZN");
  assert.match(c.ticketUrl ?? "", /webook/);
  assert.equal(c.bouts.length, 3);
});

test("names are reassembled from the split spans", () => {
  const c = parseMatchroomEvent(CARD)!;
  assert.equal(c.bouts[0].redName, "Anthony Joshua");
  assert.equal(c.bouts[0].blueName, "Kristian Prenga");
});

test("a belt in the information slot marks a title fight; a division does not", () => {
  const c = parseMatchroomEvent(CARD)!;
  assert.equal(c.bouts[0].titleFight, false, "Heavyweight is a division, not a title");
  assert.equal(c.bouts[1].titleFight, true);
  assert.equal(c.bouts[2].titleFight, true);
});

test("the date is stored at MIDDAY UTC", () => {
  // Midnight UTC renders as the previous day everywhere west of Greenwich, and
  // a card's date is a date-only fact.
  assert.equal(parseMatchroomDate("Saturday 25 July 2026"), "2026-07-25T12:00:00.000Z");
  assert.equal(parseMatchroomDate("1 January 2027"), "2027-01-01T12:00:00.000Z");
});

test("an unparseable or absent date yields null, never a guess", () => {
  assert.equal(parseMatchroomDate(""), null);
  assert.equal(parseMatchroomDate("Coming soon"), null);
  assert.equal(parseMatchroomDate("32 Smarch 2026"), null);
});

test("a page with no event title is not an event page", () => {
  assert.equal(parseMatchroomEvent("<body><h1>Shop</h1></body>"), null);
});

// ── the pipeline ──────────────────────────────────────────────────────────

function run(pages: Record<string, string>, opts = {}) {
  return syncMatchroom({
    listEvents: async () => Object.keys(pages),
    fetchEvent: async (u) => pages[u] ?? null,
    ...opts,
  });
}

test("an upcoming card becomes a BOXING event with a stated ruleset", async () => {
  const { events, report } = await run({ "https://m.com/events/joshua-vs-prenga/": CARD });
  assert.equal(events.length, 1);
  const e = events[0];
  assert.equal(e.sport, "BOXING");
  assert.equal(e.promotion, "Matchroom Boxing");
  assert.equal(e.status, "SCHEDULED");
  assert.equal(e.fights?.length, 3);
  // Matchroom promotes boxing and only boxing — a fact about the promoter.
  assert.equal(e.fights?.[0].ruleset, "BOXING");
  assert.equal(e.fights?.[0].mainEvent, true, "the page lists the headline first");
  assert.equal(report.bouts, 3);
});

test("PAST cards are skipped by default — the archive is already stronger", async () => {
  const past = CARD.replace("Saturday 25 July 2099", "Saturday 4 May 2019");
  const { events, report } = await run({ "https://m.com/events/old/": past });
  assert.equal(events.length, 0);
  assert.equal(report.unusable[0].why, "already past");
});

test("--include-past opts back in", async () => {
  const past = CARD.replace("Saturday 25 July 2099", "Saturday 4 May 2019");
  const { events } = await run({ "https://m.com/events/old/": past }, { includePast: true });
  assert.equal(events.length, 1);
  assert.equal(events[0].status, "COMPLETED");
});

test("a TBA corner is dropped, and the rest of the card survives", async () => {
  const { events } = await run({ "https://m.com/events/x/": TBA_CARD });
  assert.equal(events[0].fights?.length, 2, "the two named bouts remain");
});

test("already-ingested URLs are skipped WITHOUT a request", async () => {
  let fetched = 0;
  const { report } = await syncMatchroom({
    listEvents: async () => ["https://m.com/events/a/"],
    fetchEvent: async () => { fetched++; return CARD; },
    skipUrls: new Set(["https://m.com/events/a/"]),
  });
  assert.equal(fetched, 0);
  assert.equal(report.skipped, 1);
});

test("maxEvents bounds a run so a first pass is resumable", async () => {
  const pages = Object.fromEntries(
    Array.from({ length: 8 }, (_, i) => [`https://m.com/events/e${i}/`, CARD]),
  );
  const { events } = await run(pages, { maxEvents: 3 });
  assert.equal(events.length, 3);
});

test("a sitemap failure is reported, not thrown", async () => {
  const { events, report } = await syncMatchroom({
    listEvents: async () => { throw new Error("503"); },
  });
  assert.equal(events.length, 0);
  assert.match(report.warnings[0], /503/);
});

test("the event id is stable across runs, so a rerun updates rather than duplicates", async () => {
  const a = await run({ "https://www.matchroomboxing.com/events/joshua-vs-prenga/": CARD });
  const b = await run({ "https://www.matchroomboxing.com/events/joshua-vs-prenga/": CARD });
  assert.equal(a.events[0].externalId, b.events[0].externalId);
  assert.equal(a.events[0].externalId, "matchroom:/events/joshua-vs-prenga");
});
