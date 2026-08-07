import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  eventMapState,
  EVENT_STATE_STYLE,
  isPastState,
  isLiveState,
  FIGHT_WEEK_MS,
  LIVE_GRACE_MS,
  type EventMapState,
} from "@/lib/geo/event-state";

const NOW = Date.UTC(2026, 7, 7, 20, 0, 0);
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

/** The common case: a SCHEDULED card whose state is decided by the clock. */
const scheduled = (offsetMs: number, now: number | null = NOW) =>
  eventMapState({ status: "SCHEDULED", date: at(offsetMs), now });

describe("eventMapState — the clock-driven bands", () => {
  // These bands drive marker colour, halo animation and the card's badge, so a
  // boundary that is off by one is visible on the map: a card exactly seven days
  // out would flip between a plain pin and a fight-week pin between renders.

  test("beyond fight week is upcoming", () => {
    assert.equal(scheduled(FIGHT_WEEK_MS + 1), "UPCOMING");
    assert.equal(scheduled(30 * 86_400_000), "UPCOMING");
  });

  test("exactly fight week is INSIDE fight week", () => {
    assert.equal(scheduled(FIGHT_WEEK_MS), "FIGHT_WEEK");
  });

  test("inside seven days is fight week", () => {
    assert.equal(scheduled(FIGHT_WEEK_MS - 1), "FIGHT_WEEK");
    assert.equal(scheduled(60_000), "FIGHT_WEEK");
  });

  test("the moment of the first bell is live", () => {
    assert.equal(scheduled(0), "LIVE");
  });
});

describe("eventMapState — the live grace window", () => {
  // The whole point of the grace window: scrapers write `status` on a cron, so
  // a card that started twenty minutes ago is usually still SCHEDULED in the
  // database. Without this the map shows nothing live during precisely the
  // hours somebody would open it looking for something live.

  test("a card that started an hour ago still reads live", () => {
    assert.equal(scheduled(-3_600_000), "LIVE");
  });

  test("the far edge of the window is still live", () => {
    assert.equal(scheduled(-LIVE_GRACE_MS), "LIVE");
  });

  test("past the window it becomes a result, not a permanent live pin", () => {
    assert.equal(scheduled(-LIVE_GRACE_MS - 1), "COMPLETED");
    assert.equal(scheduled(-3 * 86_400_000), "COMPLETED");
  });
});

describe("eventMapState — facts outrank the clock", () => {
  // The precedence that matters most. A cancelled card dated tonight must never
  // pulse like a live one, and the clock would say LIVE if asked first.

  test("cancelled tonight is cancelled, not live", () => {
    assert.equal(eventMapState({ status: "CANCELLED", date: at(0), now: NOW }), "CANCELLED");
    assert.equal(eventMapState({ status: "CANCELLED", date: at(-60_000), now: NOW }), "CANCELLED");
  });

  test("postponed reads as cancelled — it has no date anyone can attend", () => {
    assert.equal(eventMapState({ status: "POSTPONED", date: at(0), now: NOW }), "CANCELLED");
  });

  test("completed stays completed even inside the grace window", () => {
    assert.equal(eventMapState({ status: "COMPLETED", date: at(-60_000), now: NOW }), "COMPLETED");
  });

  test("an explicit LIVE status is believed even before the listed bell", () => {
    // Cards start early. The column is authoritative when it says LIVE.
    assert.equal(eventMapState({ status: "LIVE", date: at(2 * 3_600_000), now: NOW }), "LIVE");
  });
});

describe("eventMapState — the unmeasured cases fail calm", () => {
  // Returning UPCOMING (not LIVE) before hydration is deliberate: a pin that
  // flashed "Live" for one frame and then corrected itself is the map's version
  // of the documented "Live / Final" countdown bug.

  test("no clock yet is upcoming, never live", () => {
    assert.equal(scheduled(0, null), "UPCOMING");
    assert.equal(scheduled(-3_600_000, null), "UPCOMING");
  });

  test("a missing or unparseable date is upcoming, not NaN-driven", () => {
    assert.equal(eventMapState({ status: "SCHEDULED", date: null, now: NOW }), "UPCOMING");
    assert.equal(eventMapState({ status: "SCHEDULED", date: "not a date", now: NOW }), "UPCOMING");
    assert.equal(eventMapState({ status: undefined, date: undefined, now: NOW }), "UPCOMING");
  });

  test("status casing never changes the answer", () => {
    assert.equal(eventMapState({ status: "cancelled", date: at(0), now: NOW }), "CANCELLED");
    assert.equal(eventMapState({ status: "live", date: at(0), now: NOW }), "LIVE");
  });
});

describe("the style table", () => {
  const ALL: EventMapState[] = ["LIVE", "FIGHT_WEEK", "UPCOMING", "COMPLETED", "CANCELLED"];

  test("every state has a style — a missing entry renders an undefined class", () => {
    for (const s of ALL) {
      const style = EVENT_STATE_STYLE[s];
      assert.ok(style, `${s} has no style`);
      assert.match(style.accent, /^#[0-9a-f]{6}$/i, `${s} accent is not a colour`);
      assert.ok(style.pinClass.startsWith("is-"), `${s} pinClass is not a modifier`);
    }
  });

  test("ONLY live pulses", () => {
    // Scarcity is the whole mechanism. If fight week pulsed too, then on a
    // normal week most of the map would be animating and the one card actually
    // happening right now would stop standing out.
    const pulsing = ALL.filter((s) => EVENT_STATE_STYLE[s].pulse);
    assert.deepEqual(pulsing, ["LIVE"]);
  });

  test("weights order the map by urgency and are unique", () => {
    const weights = ALL.map((s) => EVENT_STATE_STYLE[s].weight);
    assert.deepEqual(new Set(weights).size, weights.length, "two states share a sort weight");
    assert.ok(EVENT_STATE_STYLE.LIVE.weight < EVENT_STATE_STYLE.FIGHT_WEEK.weight);
    assert.ok(EVENT_STATE_STYLE.FIGHT_WEEK.weight < EVENT_STATE_STYLE.UPCOMING.weight);
    assert.ok(EVENT_STATE_STYLE.UPCOMING.weight < EVENT_STATE_STYLE.COMPLETED.weight);
  });

  test("upcoming carries no badge — a badge on the default state is noise", () => {
    assert.equal(EVENT_STATE_STYLE.UPCOMING.badge, null);
    assert.equal(EVENT_STATE_STYLE.LIVE.badge, "Live");
    assert.equal(EVENT_STATE_STYLE.FIGHT_WEEK.badge, "Fight week");
  });
});

describe("the state predicates", () => {
  test("past states are exactly completed and cancelled", () => {
    // These gate Tickets and the prediction counts. A cancelled card offering
    // "Buy tickets" is the failure this groups against.
    assert.equal(isPastState("COMPLETED"), true);
    assert.equal(isPastState("CANCELLED"), true);
    assert.equal(isPastState("LIVE"), false);
    assert.equal(isPastState("FIGHT_WEEK"), false);
    assert.equal(isPastState("UPCOMING"), false);
  });

  test("only LIVE is live", () => {
    assert.equal(isLiveState("LIVE"), true);
    assert.equal(isLiveState("FIGHT_WEEK"), false);
  });
});
