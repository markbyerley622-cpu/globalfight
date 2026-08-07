import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  visiblePresence, typingAllowed, readReceiptsAllowed,
  PRESENCE_PREFS_DEFAULT, PRESENCE_COPY, type PresencePrefs,
} from "@/lib/presence/policy";
import { ONLINE_MS } from "@/lib/presence/derive";

const NOW = Date.UTC(2026, 7, 7, 20, 0, 0);
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const prefs = (over: Partial<PresencePrefs> = {}): PresencePrefs => ({
  ...PRESENCE_PREFS_DEFAULT,
  ...over,
});

const look = (
  subjectPrefs: PresencePrefs | null,
  lastSeenAt: string | null,
  viewerId: string | null = "viewer",
) => visiblePresence({
  subject: { prefs: subjectPrefs, lastSeenAt },
  viewerId,
  subjectId: "subject",
  now: NOW,
});

describe("visiblePresence — the master switch", () => {
  test("with everything on, presence is visible", () => {
    const r = look(prefs(), ago(0));
    assert.equal(r.visible, true);
    assert.equal(r.state, "online");
    assert.equal(r.label, "Active now");
  });

  test("showOnlineStatus off hides EVERYTHING", () => {
    const r = look(prefs({ showOnlineStatus: false }), ago(0));
    assert.equal(r.visible, false);
    assert.equal(r.state, "hidden");
    assert.equal(r.label, null);
  });

  test("hiding online status also hides LAST SEEN, even when that switch is on", () => {
    // The leak this guards: "last seen 1 minute ago", refreshed, is a live
    // presence indicator with extra steps. Leaving history readable would make
    // the master switch decorative.
    const r = look(prefs({ showOnlineStatus: false, showLastSeen: true }), ago(30 * 60_000));
    assert.equal(r.visible, false);
    assert.equal(r.label, null);
  });

  test("a hidden user is hidden whether they are online or offline", () => {
    // The state must not leak through the SHAPE of the answer either.
    const on = look(prefs({ showOnlineStatus: false }), ago(0));
    const off = look(prefs({ showOnlineStatus: false }), ago(30 * 86_400_000));
    assert.deepEqual(on, off);
  });
});

describe("visiblePresence — the middle ground", () => {
  test("showLastSeen off keeps the live state and drops the history", () => {
    const r = look(prefs({ showLastSeen: false }), ago(0));
    assert.equal(r.visible, true);
    assert.equal(r.state, "online");
    // "Active now" is not history — the dot is already saying it.
    assert.equal(r.label, "Active now");
  });

  test("showLastSeen off gives no label once they are away", () => {
    const r = look(prefs({ showLastSeen: false }), ago(ONLINE_MS + 60_000));
    assert.equal(r.visible, true);
    assert.equal(r.state, "away");
    assert.equal(r.label, null, "an away user's history must not leak through the label");
  });

  test("with showLastSeen ON the history is worded", () => {
    const r = look(prefs(), ago(2 * 3_600_000));
    assert.equal(r.label, "Active 2h ago");
  });
});

describe("visiblePresence — you always see yourself", () => {
  // Settings has to be able to show somebody their own status, and a person
  // hiding from others is not hiding from themselves.

  test("your own presence resolves even with everything switched off", () => {
    const r = visiblePresence({
      subject: { prefs: prefs({ showOnlineStatus: false, showLastSeen: false }), lastSeenAt: ago(0) },
      viewerId: "me",
      subjectId: "me",
      now: NOW,
    });
    assert.equal(r.visible, true);
    assert.equal(r.state, "online");
  });

  test("a signed-out viewer is never treated as self", () => {
    // viewerId null must not collide with a null subjectId or similar.
    const r = visiblePresence({
      subject: { prefs: prefs({ showOnlineStatus: false }), lastSeenAt: ago(0) },
      viewerId: null,
      subjectId: "subject",
      now: NOW,
    });
    assert.equal(r.visible, false);
  });
});

describe("visiblePresence — missing prefs fail OPEN, and that is deliberate", () => {
  test("a null prefs row is treated as default-on", () => {
    // Failing closed here would blank presence platform-wide the moment one
    // query forgot to select the columns — a silent, total feature outage.
    // Failing open is visible and matches the column defaults.
    const r = look(null, ago(0));
    assert.equal(r.visible, true);
  });

  test("the defaults really are all-on", () => {
    assert.deepEqual(PRESENCE_PREFS_DEFAULT, {
      showOnlineStatus: true, showLastSeen: true,
      allowTypingIndicator: true, allowReadReceipts: true,
    });
  });
});

describe("mutual privacy — typing", () => {
  test("both on → allowed", () => {
    assert.equal(typingAllowed(prefs(), prefs()), true);
  });

  test("EITHER side off → nobody sees it", () => {
    // The one-way-mirror failure: without this, switching your own typing off
    // would still let you watch everybody else type.
    assert.equal(typingAllowed(prefs({ allowTypingIndicator: false }), prefs()), false);
    assert.equal(typingAllowed(prefs(), prefs({ allowTypingIndicator: false })), false);
  });

  test("it is symmetric — argument order cannot change the answer", () => {
    const a = prefs({ allowTypingIndicator: false });
    const b = prefs();
    assert.equal(typingAllowed(a, b), typingAllowed(b, a));
  });

  test("null prefs default to on", () => {
    assert.equal(typingAllowed(null, null), true);
    assert.equal(typingAllowed(null, prefs({ allowTypingIndicator: false })), false);
  });
});

describe("mutual privacy — read receipts", () => {
  test("both on → allowed", () => {
    assert.equal(readReceiptsAllowed(prefs(), prefs()), true);
  });

  test("EITHER side off → nobody sees them", () => {
    assert.equal(readReceiptsAllowed(prefs({ allowReadReceipts: false }), prefs()), false);
    assert.equal(readReceiptsAllowed(prefs(), prefs({ allowReadReceipts: false })), false);
  });

  test("it is symmetric", () => {
    const a = prefs({ allowReadReceipts: false });
    const b = prefs();
    assert.equal(readReceiptsAllowed(a, b), readReceiptsAllowed(b, a));
  });

  test("the two switches are INDEPENDENT of each other", () => {
    // Turning off read receipts must not silently disable typing as well.
    const p = prefs({ allowReadReceipts: false });
    assert.equal(typingAllowed(p, prefs()), true);
    const q = prefs({ allowTypingIndicator: false });
    assert.equal(readReceiptsAllowed(q, prefs()), true);
  });
});

describe("the copy table", () => {
  test("every state including hidden has wording", () => {
    for (const k of ["online", "away", "offline", "hidden"] as const) {
      assert.ok(PRESENCE_COPY[k]?.length, `${k} has no copy`);
    }
    assert.equal(PRESENCE_COPY.hidden, "Presence hidden");
  });
});
