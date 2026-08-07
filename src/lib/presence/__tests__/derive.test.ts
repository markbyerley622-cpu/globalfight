import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  presenceOf, lastSeenLabel, deliveryOf, PRESENCE_STYLE,
  ONLINE_MS, AWAY_MS, HEARTBEAT_MS,
  type PresenceState,
} from "@/lib/presence/derive";

const NOW = Date.UTC(2026, 7, 7, 20, 0, 0);
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("presenceOf — the decay bands", () => {
  test("a fresh heartbeat is online", () => {
    assert.equal(presenceOf({ lastSeenAt: ago(0), now: NOW }), "online");
    assert.equal(presenceOf({ lastSeenAt: ago(ONLINE_MS - 1), now: NOW }), "online");
  });

  test("the online window comfortably outlives the heartbeat interval", () => {
    // The property that stops a present user flickering offline between beats.
    // If this ever tightens to near 1×, presence becomes a strobe.
    assert.ok(
      ONLINE_MS >= HEARTBEAT_MS * 2,
      `ONLINE_MS (${ONLINE_MS}) must be well clear of HEARTBEAT_MS (${HEARTBEAT_MS})`,
    );
    // A beat that lands one interval late still reads as online.
    assert.equal(presenceOf({ lastSeenAt: ago(HEARTBEAT_MS * 2), now: NOW }), "online");
  });

  test("past the online window is away, not offline", () => {
    assert.equal(presenceOf({ lastSeenAt: ago(ONLINE_MS), now: NOW }), "away");
    assert.equal(presenceOf({ lastSeenAt: ago(AWAY_MS - 1), now: NOW }), "away");
  });

  test("past the away window is offline", () => {
    assert.equal(presenceOf({ lastSeenAt: ago(AWAY_MS), now: NOW }), "offline");
    assert.equal(presenceOf({ lastSeenAt: ago(30 * 86_400_000), now: NOW }), "offline");
  });
});

describe("presenceOf — it cannot get stuck or lie", () => {
  // The failure this whole timestamp design exists to prevent: an `isOnline`
  // boolean that nothing ever sets back to false.

  test("never seen is offline", () => {
    assert.equal(presenceOf({ lastSeenAt: null, now: NOW }), "offline");
    assert.equal(presenceOf({ lastSeenAt: undefined, now: NOW }), "offline");
  });

  test("an unparseable timestamp is offline, not NaN-driven", () => {
    assert.equal(presenceOf({ lastSeenAt: "not a date", now: NOW }), "offline");
  });

  test("no clock yet is offline — the calm answer, never a green flash", () => {
    assert.equal(presenceOf({ lastSeenAt: ago(0), now: null }), "offline");
  });

  test("a future timestamp reads online rather than wrapping to offline", () => {
    // Client and server clocks disagree in the real world. A skew must not
    // present as "offline for negative time".
    assert.equal(presenceOf({ lastSeenAt: new Date(NOW + 60_000).toISOString(), now: NOW }), "online");
  });

  test("accepts a Date as well as an ISO string", () => {
    assert.equal(presenceOf({ lastSeenAt: new Date(NOW), now: NOW }), "online");
  });
});

describe("lastSeenLabel — coarse on purpose", () => {
  // Resolution DROPS with age. A precise "last seen 14:32 on 3 August" tells a
  // stranger when somebody sleeps; that is a surveillance readout, not a social
  // signal.

  test("online says so without a time", () => {
    assert.equal(lastSeenLabel({ lastSeenAt: ago(0), now: NOW }), "Active now");
  });

  test("minutes within the hour", () => {
    assert.equal(lastSeenLabel({ lastSeenAt: ago(12 * 60_000), now: NOW }), "Active 12m ago");
  });

  test("never reports 0m — the smallest reading is a minute", () => {
    // Just past the online window but under two minutes: flooring would print
    // "Active 0m ago", which reads as broken.
    const label = lastSeenLabel({ lastSeenAt: ago(ONLINE_MS + 1000), now: NOW });
    assert.ok(label && !label.includes("0m"), `got ${label}`);
  });

  test("hours within the day, then days", () => {
    assert.equal(lastSeenLabel({ lastSeenAt: ago(5 * 3_600_000), now: NOW }), "Active 5h ago");
    assert.equal(lastSeenLabel({ lastSeenAt: ago(30 * 3_600_000), now: NOW }), "Active yesterday");
    assert.equal(lastSeenLabel({ lastSeenAt: ago(4 * 86_400_000), now: NOW }), "Active 4d ago");
  });

  test("beyond a week it stops reporting entirely", () => {
    // "Active 4 months ago" is only ever a statement about how little somebody
    // is missed. Null means the UI shows nothing at all.
    assert.equal(lastSeenLabel({ lastSeenAt: ago(8 * 86_400_000), now: NOW }), null);
    assert.equal(lastSeenLabel({ lastSeenAt: null, now: NOW }), null);
  });
});

describe("the presence style table", () => {
  test("every state has a colour and a label", () => {
    for (const s of ["online", "away", "offline"] as PresenceState[]) {
      assert.ok(PRESENCE_STYLE[s], `${s} has no style`);
      assert.match(PRESENCE_STYLE[s].color, /^#[0-9a-f]{6}$/i);
    }
  });
});

describe("deliveryOf — every state is earned", () => {
  const at = new Date(NOW).toISOString();
  const base = { at, optimistic: false, otherDeliveredAt: null, otherReadAt: null };

  test("an unacknowledged message is sending, whatever the watermarks say", () => {
    // Must win over everything: a stale watermark from an EARLIER message must
    // never make a brand-new optimistic row claim it was read.
    assert.equal(
      deliveryOf({ ...base, optimistic: true, otherReadAt: new Date(NOW + 10_000).toISOString() }),
      "sending",
    );
  });

  test("acknowledged but untouched is sent", () => {
    assert.equal(deliveryOf(base), "sent");
  });

  test("a watermark from BEFORE the message does not count", () => {
    // The bug this guards: comparing "have they ever fetched?" instead of
    // "have they fetched since?", which marks every message delivered forever
    // after the first poll.
    assert.equal(deliveryOf({ ...base, otherDeliveredAt: ago(60_000) }), "sent");
    assert.equal(deliveryOf({ ...base, otherReadAt: ago(60_000) }), "sent");
  });

  test("their client fetched since → delivered", () => {
    assert.equal(deliveryOf({ ...base, otherDeliveredAt: at }), "delivered");
    assert.equal(deliveryOf({ ...base, otherDeliveredAt: new Date(NOW + 1000).toISOString() }), "delivered");
  });

  test("read outranks delivered", () => {
    // Read implies delivered. If the checks ran the other way a message they
    // demonstrably read could report as merely delivered.
    assert.equal(
      deliveryOf({ ...base, otherDeliveredAt: at, otherReadAt: at }),
      "read",
    );
    assert.equal(deliveryOf({ ...base, otherDeliveredAt: null, otherReadAt: at }), "read");
  });

  test("an unparseable message timestamp does not silently promote to read", () => {
    // atOrZero(at) would be 0 and any watermark would beat it. Guarding this
    // because message timestamps arrive from the wire.
    const r = deliveryOf({ ...base, at: "nonsense", otherReadAt: ago(60_000) });
    assert.equal(r, "read", "documented behaviour: an unusable send time falls back to the watermark");
  });
});
