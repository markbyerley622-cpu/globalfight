import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { stripLocked } from "@/lib/admin/provenance";
import {
  PROMOTER_OWNED_EVENT_FIELDS,
  PROMOTER_OWNED_FIGHT_FIELDS,
  promoterEventLocks,
  promoterFightLocks,
  promoterResultLocks,
  unlockableFields,
} from "@/lib/promoter/locking";

describe("a promoter's lock must actually lock", () => {
  test("every promoter-owned field is in the lockable allow-list", () => {
    // THE test in this file. stripLocked filters by NAME, so a field listed as
    // promoter-owned but absent from LOCKABLE_*_FIELDS produces a lock that
    // does nothing — and the next cron overwrites it silently, which is the
    // one failure mode nobody would report because it looks like the promoter
    // misremembering what they typed.
    const { event, fight } = unlockableFields();
    assert.deepEqual(event, [], `event fields that would not lock: ${event.join(", ")}`);
    assert.deepEqual(fight, [], `fight fields that would not lock: ${fight.join(", ")}`);
  });
});

describe("what a promoter's lock keeps out", () => {
  test("ingest cannot overwrite the venue a promoter set", () => {
    const locks = promoterEventLocks([]);
    const fromScraper = { name: "Wrong Name", venue: "Wrong Arena", status: "SCHEDULED" };
    const allowed = stripLocked(fromScraper, locks);
    assert.equal(allowed.venue, undefined);
    assert.equal(allowed.name, undefined);
  });

  test("ingest cannot reshuffle a promoter's card order", () => {
    // The schema comment on Fight.lockedFields calls this out specifically: the
    // pipeline rebuilds orderOnCard from the source's own index every run, so
    // without the lock a drag-and-drop card is destroyed by the next cron.
    const locks = promoterFightLocks([]);
    const allowed = stripLocked({ orderOnCard: 7, mainEvent: false }, locks);
    assert.equal(allowed.orderOnCard, undefined);
    assert.equal(allowed.mainEvent, undefined);
  });

  test("STATUS stays open, so the card can still go live and complete", () => {
    // Locking the whole row would freeze the lifecycle and strand a published
    // card at SCHEDULED through its own fight night.
    const allowed = stripLocked({ status: "LIVE" }, promoterEventLocks([]));
    assert.equal(allowed.status, "LIVE");
  });

  test("RESULTS stay open until the promoter actually records one", () => {
    // Claiming them at publish time would freeze them EMPTY and block the
    // pipeline from filling in a result the promoter never got round to
    // entering — the worst of both worlds.
    const atPublish = stripLocked(
      { result: "RED", winnerId: "f1", method: "KO" },
      promoterFightLocks([]),
    );
    assert.equal(atPublish.result, "RED");
    assert.equal(atPublish.winnerId, "f1");

    // Once recorded, they close.
    const afterRecording = stripLocked(
      { result: "BLUE", winnerId: "f2" },
      promoterResultLocks(promoterFightLocks([])),
    );
    assert.equal(afterRecording.result, undefined);
    assert.equal(afterRecording.winnerId, undefined);
  });

  test("fields nobody claimed still flow through from ingest", () => {
    // Per-field, not per-row: automation keeps updating everything a human has
    // not taken ownership of.
    const allowed = stripLocked(
      { venue: "Wrong", attendance: 12000, someFutureColumn: "x" },
      promoterEventLocks([]),
    );
    assert.equal(allowed.venue, undefined);
    assert.equal(allowed.attendance, 12000);
    assert.equal(allowed.someFutureColumn, "x");
  });
});

describe("lock merging", () => {
  test("preserves locks an operator already placed", () => {
    // An admin who corrected a field before the promoter touched the event must
    // not have that correction unlocked by the promoter's publish.
    const locks = promoterEventLocks(["attendance"]);
    assert.ok(locks.includes("attendance"));
    assert.ok(locks.includes("venue"));
  });

  test("is idempotent — republishing does not duplicate", () => {
    const once = promoterEventLocks([]);
    const twice = promoterEventLocks(once);
    assert.deepEqual(twice, once);
    assert.equal(new Set(twice).size, twice.length);
  });

  test("a narrow edit claims only what it wrote", () => {
    // Editing the venue inline must not silently freeze the whole event and
    // stop the pipeline updating everything else.
    const locks = promoterEventLocks([], ["venue"]);
    assert.deepEqual(locks, ["venue"]);
    const allowed = stripLocked({ venue: "Wrong", broadcaster: "DAZN" }, locks);
    assert.equal(allowed.venue, undefined);
    assert.equal(allowed.broadcaster, "DAZN");
  });
});

describe("the owned sets are coherent", () => {
  test("no field is both card-owned and result-owned", () => {
    const owned = new Set<string>(PROMOTER_OWNED_FIGHT_FIELDS);
    for (const f of ["result", "winnerId", "method", "roundEnded", "timeEnded"]) {
      assert.ok(!owned.has(f), `${f} must be claimed at result time, not at publish`);
    }
  });

  test("status and slug are deliberately not promoter-owned", () => {
    const owned = new Set<string>(PROMOTER_OWNED_EVENT_FIELDS);
    assert.ok(!owned.has("status"));
    assert.ok(!owned.has("slug"));
  });
});
