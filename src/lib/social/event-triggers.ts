import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { log } from "@/lib/scraper/logger";
import { fanOut } from "./triggers";
import { eventTargets, type EventRef } from "./audience";
import { isHistorical } from "./event-timing";

// ════════════════════════════════════════════════════════════════════════════
//  Event + card lifecycle → notifications, driven by DIFFS.
//
//  Every write path into Event/Fight is an UPSERT — the adapter ingest, the
//  provider sync, the admin editor. An upsert knows the row's new value and
//  nothing about its old one, so "the card was published" and "the main event
//  changed" are not observable from inside it. That is why these notifications
//  did not exist: there was no moment at which the change was a fact.
//
//  So the writer takes a SNAPSHOT first, writes, then calls notifyEventChanges().
//  Two lines at each call site, one place that knows what a change means, and the
//  diff decides which facts occurred — rather than each ingest path growing its own
//  opinion about what counts as news.
//
//  Every fact carries a dedupeKey describing the FACT, not the run that noticed it,
//  so a cron that re-reads the same page every ten minutes announces nothing twice.
//  Nothing here throws: an event is the fact, the notification is a consequence.
// ════════════════════════════════════════════════════════════════════════════

/** Everything a diff needs. Deliberately small — this is read on every ingest tick. */
export interface EventSnapshot {
  id: string;
  name: string;
  date: Date;
  status: string;
  promotion: string | null;
  venue: string | null;
  city: string | null;
  country: string | null;
  bouts: number;
  /** The main event's corner pair, order-independent. Null when the card has none. */
  mainEvent: string | null;
}

const SNAPSHOT_SELECT = {
  id: true, name: true, date: true, status: true,
  promotion: true, venue: true, city: true, country: true,
} as const;

/**
 * The state of an event BEFORE a write. Returns null when the event does not exist
 * yet, which is itself the signal for "announced".
 *
 * Takes a slug OR an id because the two write paths differ: the adapter ingest only
 * knows the slug it is about to upsert on, while the admin editor holds the row id.
 */
export async function snapshotEvent(where: { id: string } | { slug: string }): Promise<EventSnapshot | null> {
  const row = await prisma.event.findUnique({ where, select: SNAPSHOT_SELECT });
  if (!row) return null;
  return snapshotFromRow(row);
}

/**
 * The same snapshot from a row the caller ALREADY read.
 *
 * The admin editor loads the full event to diff the patch and detect a lost update,
 * so making it re-read the row just to snapshot it would be a second query for data
 * already in hand. Only the card shape is fetched.
 */
export async function snapshotFromRow(row: {
  id: string; name: string; date: Date; status: string;
  promotion: string | null; venue: string | null; city: string | null; country: string | null;
}): Promise<EventSnapshot> {
  return {
    id: row.id, name: row.name, date: row.date, status: row.status,
    promotion: row.promotion, venue: row.venue, city: row.city, country: row.country,
    ...(await cardShape(row.id)),
  };
}

/** Bout count + main-event identity, the two card-level facts worth notifying about. */
async function cardShape(eventId: string): Promise<{ bouts: number; mainEvent: string | null }> {
  const fights = await prisma.fight.findMany({
    where: { eventId, cancelled: false },
    orderBy: { orderOnCard: "asc" },
    select: { redId: true, blueId: true, mainEvent: true },
  });
  // Prefer the explicit flag; fall back to the top of the card. A source that never
  // sets mainEvent still has a headline bout, and "the main event changed" should
  // mean the same thing either way.
  const head = fights.find((f) => f.mainEvent) ?? fights[0];
  return {
    bouts: fights.length,
    mainEvent: head ? [head.redId, head.blueId].sort().join("|") : null,
  };
}

const eventUrl = (slug: string) => `/events/${slug}`;

/**
 * The card section, which is ALSO where results render.
 *
 * There is no `#results` anchor on the event page and this deliberately does not
 * link to one — the card section shows each bout with its outcome once the event is
 * complete (see enrichment-derive: `card`, `card-talk`, `coverage` are the only
 * sections that exist). A deep link to an anchor that isn't in the document does
 * not error, it just silently lands at the top of the page, which is precisely the
 * dead end these notifications exist to avoid.
 */
const resultsUrl = (slug: string) => `/events/${slug}#card`;

/**
 * Field separator for the change hash. A NUL is used deliberately: it cannot occur
 * in an event name or a venue, so ["a b", "c"] and ["a", "b c"] cannot hash to the
 * same key and report a change that never happened.
 *
 * Written as an ESCAPE rather than embedded raw. A literal NUL byte makes the whole
 * file "binary" to git, grep and every diff tool - this module stopped appearing in
 * content searches at all, which is a bad way to hide a hash function.
 */
const SEP = "\u0000";

/** A stable short key for "these values changed", so one edit is one notification. */
const changeKey = (parts: (string | null)[]) =>
  createHash("sha1").update(parts.map((p) => p ?? "").join(SEP)).digest("hex").slice(0, 10);

/** A reschedule of under an hour is a clock correction, not news. */
const RESCHEDULE_TOLERANCE_MS = 60 * 60 * 1000;

const dateLabel = (d: Date) =>
  d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * Diff an event against its pre-write snapshot and tell its followers what changed.
 *
 * `before === null` means the event is new. Statuses are compared as strings rather
 * than the enum so a snapshot can be taken by a caller that never imported it.
 */
export async function notifyEventChanges(
  before: EventSnapshot | null,
  eventId: string,
): Promise<{ facts: string[] }> {
  const facts: string[] = [];
  try {
    const after = await snapshotEvent({ id: eventId });
    if (!after) return { facts };

    // DRAFT is admin-only and never appears on a public surface, so it must never
    // notify anybody — announcing a card an operator is still building is the one
    // notification that cannot be taken back.
    if (after.status === "DRAFT") return { facts };

    // A card that already happened must never send an ANNOUNCEMENT.
    //
    // Every notification below is written in the future tense — "X announced",
    // "card updated" — and is meant to bring someone back for a fight that has not
    // happened. A backfill writing results to a 2025 event is not news; it is
    // bookkeeping. The results sweep fired ~10 of these bursts per run across cards
    // up to a year old, each one telling followers about a fight that finished
    // months ago.
    //
    // The guard belongs here, at the entry point, rather than on each of the nine
    // emit sites — a tenth would be added later and would miss it.
    //
    // NOT applied to result/settlement notifications: those live in the settlement
    // path (lib/intelligence), are past-tense by nature ("you called it"), and are
    // exactly what a user wants when an old pick finally grades.
    if (isHistorical(after.date)) {
      log.info(
        { op: "social.event.skipHistorical", eventId: after.id, date: after.date.toISOString() },
        "past event — announcement notifications suppressed",
      );
      return { facts };
    }

    const ref: EventRef = { id: after.id, slug: await slugOf(after.id), name: after.name, promotion: after.promotion };
    const targets = eventTargets(ref);
    const emit = async (fact: string, payload: Parameters<typeof fanOut>[1]) => {
      const sent = await fanOut(targets, payload);
      if (sent) facts.push(fact);
    };

    // ── announced ────────────────────────────────────────────────────────────
    // A brand-new card, OR a DRAFT an operator has just published.
    //
    // The draft case is not a status change like the others: a DRAFT appears on no
    // public surface, in no search and in no sitemap, so as far as every reader is
    // concerned the card did not exist until this write. Treating it as a mere
    // transition would have sent nothing at all — an operator hand-building a card
    // and pressing publish is the most deliberate announcement in the app, and it
    // would have been the one that stayed silent.
    //
    // The audience can only be the PROMOTION's followers — nobody follows an event
    // that was invisible a second ago — which is exactly the "Event announced"
    // trigger the promotion side of the spec asks for, served by the same code
    // rather than a parallel one.
    if (!before || before.status === "DRAFT") {
      if (after.status !== "CANCELLED") {
        await emit("announced", {
          type: "FIGHT_ANNOUNCED",
          title: `${after.name} announced`,
          body: [dateLabel(after.date), after.venue ?? after.city].filter(Boolean).join(" · "),
          url: eventUrl(ref.slug),
          icon: "scheduled",
          dedupeKey: `event_announced:${after.id}`,
          tag: `event:${after.id}`,
        });
      }
      // A card that arrives WITH its bouts already attached has also just been
      // published, but saying both to the same people is the same news twice. The
      // announcement covers it.
      return { facts };
    }

    // ── status transitions ───────────────────────────────────────────────────
    if (before.status !== after.status) {
      if (after.status === "CANCELLED") {
        await emit("cancelled", {
          type: "FIGHT_ANNOUNCED",
          title: `${after.name} is cancelled`,
          body: "The card has been called off.",
          url: eventUrl(ref.slug),
          icon: "cancelled",
          dedupeKey: `event_cancelled:${after.id}`,
          tag: `event:${after.id}`,
        });
      } else if (after.status === "POSTPONED") {
        await emit("postponed", {
          type: "FIGHT_ANNOUNCED",
          title: `${after.name} is postponed`,
          body: "A new date has not been confirmed yet.",
          url: eventUrl(ref.slug),
          icon: "cancelled",
          dedupeKey: `event_postponed:${after.id}`,
          tag: `event:${after.id}`,
        });
      } else if (after.status === "LIVE") {
        // The SAME dedupeKey the Return Engine uses for its cron-driven "is LIVE"
        // notification. Whichever observes the transition first wins and the other
        // is a no-op — an operator flipping the status and the next cron tick are
        // two observations of ONE fact, and the reader must be told once.
        await emit("live", {
          type: "EVENT_LIVE",
          title: `${after.name} is LIVE`,
          body: "Picks are locked — jump into the live discussion.",
          url: eventUrl(ref.slug),
          icon: "live",
          dedupeKey: `event_live:${after.id}`,
          tag: `event:${after.id}`,
        });
      } else if (after.status === "COMPLETED") {
        // "The card is over" and "the official results are in" are the SAME news to
        // a reader, and sending both — which is what a separate event_completed key
        // did — was the same sentence twice, three seconds apart, both linking to
        // the same anchor.
        //
        // So this transition is routed into notifyOfficialResults, which owns the
        // one key. Whichever observation arrives first delivers it: an operator
        // flipping the status, or the write that decides the last bout. And because
        // that function guards on the card actually being decided, a card marked
        // COMPLETED before any result has landed stays quiet instead of announcing
        // results that do not exist yet — the results ingest will fire it.
        if (await notifyOfficialResults(after.id)) facts.push("completed");
      }
    }

    // ── rescheduled ──────────────────────────────────────────────────────────
    // Keyed by the NEW date: a card moved twice is two facts, and a reader who was
    // told about the first move must hear about the second.
    if (Math.abs(+after.date - +before.date) > RESCHEDULE_TOLERANCE_MS && after.status !== "CANCELLED") {
      await emit("rescheduled", {
        type: "FIGHT_ANNOUNCED",
        title: `${after.name} has moved`,
        body: `Now ${dateLabel(after.date)}.`,
        url: eventUrl(ref.slug),
        icon: "rescheduled",
        dedupeKey: `event_rescheduled:${after.id}:${after.date.toISOString().slice(0, 10)}`,
        tag: `event:${after.id}`,
      });
    }

    // ── the card ─────────────────────────────────────────────────────────────
    if (before.bouts === 0 && after.bouts > 0) {
      await emit("card_published", {
        type: "FIGHT_ANNOUNCED",
        title: `${after.name} card is live`,
        body: `${after.bouts} bout${after.bouts === 1 ? "" : "s"} announced.`,
        url: `${eventUrl(ref.slug)}#card`,
        icon: "fight",
        dedupeKey: `card_published:${after.id}`,
        tag: `event:${after.id}`,
      });
    } else if (after.bouts > before.bouts) {
      // Keyed by the new SIZE, so a card filling out over six weeks sends one
      // notification per genuine addition and nothing at all on the ticks in
      // between. Additions only: a bout leaving the card is a scratch, which the
      // fight triggers announce with the reason attached.
      await emit("card_updated", {
        type: "FIGHT_ANNOUNCED",
        title: `${after.name} card updated`,
        body: `${after.bouts - before.bouts} bout${after.bouts - before.bouts === 1 ? "" : "s"} added — ${after.bouts} in total.`,
        url: `${eventUrl(ref.slug)}#card`,
        icon: "fight",
        dedupeKey: `card_updated:${after.id}:${after.bouts}`,
        tag: `event:${after.id}`,
      });
    }

    // ── the headline bout ────────────────────────────────────────────────────
    // Only once the card already HAD a main event: going from nothing to a headline
    // is the card being published, which is already covered above.
    if (before.mainEvent && after.mainEvent && before.mainEvent !== after.mainEvent) {
      const head = await headlineNames(after.id);
      await emit("main_event", {
        type: "FIGHT_ANNOUNCED",
        title: `New main event for ${after.name}`,
        body: head ?? "The headline bout has changed.",
        url: `${eventUrl(ref.slug)}#card`,
        icon: "promotion",
        dedupeKey: `main_event:${after.id}:${after.mainEvent}`,
        tag: `event:${after.id}`,
      });
    }

    // ── details ──────────────────────────────────────────────────────────────
    // Name and venue only. Every other column on this row (poster art, broadcaster,
    // timezone, description, segment times) changes on ingest without being news,
    // and a notification for each is how the "fights" category gets muted.
    const detailsBefore = [before.name, before.venue, before.city, before.country];
    const detailsAfter = [after.name, after.venue, after.city, after.country];
    if (changeKey(detailsBefore) !== changeKey(detailsAfter) && after.status !== "CANCELLED") {
      const renamed = before.name !== after.name;
      const moved = changeKey([before.venue, before.city, before.country]) !== changeKey([after.venue, after.city, after.country]);
      // A rename alone is usually a source correcting itself ("UFC Fight Night" →
      // "UFC Fight Night 250"), so it is only worth sending when the VENUE moved
      // too, or when the rename is substantial rather than an added suffix.
      if (moved || (renamed && !isRefinement(before.name, after.name))) {
        await emit("updated", {
          type: "FIGHT_ANNOUNCED",
          title: `${after.name} details changed`,
          body: moved
            ? `Now at ${[after.venue, after.city].filter(Boolean).join(", ") || "a new venue"}.`
            : `Previously "${before.name}".`,
          url: eventUrl(ref.slug),
          icon: "edit",
          dedupeKey: `event_updated:${after.id}:${changeKey(detailsAfter)}`,
          tag: `event:${after.id}`,
        });
      }
    }

    if (facts.length) log.info({ op: "social.event", eventId, facts }, "event changes notified");
    return { facts };
  } catch (e) {
    log.error({ op: "social.event", eventId, err: (e as Error).message }, "event change fan-out FAILED");
    return { facts };
  }
}

/** Is `after` just `before` with more detail? "UFC 300" → "UFC 300: Pereira vs Hill". */
function isRefinement(before: string, after: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const [b, a] = [norm(before), norm(after)];
  return a.startsWith(b) || b.startsWith(a);
}

async function slugOf(eventId: string): Promise<string> {
  const row = await prisma.event.findUnique({ where: { id: eventId }, select: { slug: true } });
  return row?.slug ?? "";
}

async function headlineNames(eventId: string): Promise<string | null> {
  const f = await prisma.fight.findFirst({
    where: { eventId, cancelled: false },
    orderBy: [{ mainEvent: "desc" }, { orderOnCard: "asc" }],
    select: { red: { select: { name: true } }, blue: { select: { name: true } } },
  });
  return f ? `${f.red.name} vs ${f.blue.name}` : null;
}

/**
 * Every bout on the card now has a result — "official results confirmed".
 *
 * Distinct from the per-bout result notifications, which are the live drip during
 * the night, and from the card SUMMARY in the resolution engine, which scores the
 * reader's own picks. This is the card-level fact for someone who follows the event
 * or the promotion and predicted nothing.
 *
 * Guarded on the card being genuinely complete, so it fires exactly once — on the
 * write that decides the last bout, whichever bout that turns out to be.
 */
export async function notifyOfficialResults(eventId: string): Promise<boolean> {
  try {
    const [pending, decided] = await Promise.all([
      prisma.fight.count({ where: { eventId, cancelled: false, result: "SCHEDULED" } }),
      prisma.fight.count({ where: { eventId, cancelled: false, result: { not: "SCHEDULED" } } }),
    ]);
    // An empty card is not a completed one, and one ungraded bout means the night
    // is still running.
    if (pending > 0 || decided === 0) return false;

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, slug: true, name: true, promotion: true },
    });
    if (!event) return false;

    const sent = await fanOut(eventTargets(event), {
      type: "FIGHT_ANNOUNCED",
      title: `Official results — ${event.name}`,
      body: `All ${decided} bout${decided === 1 ? "" : "s"} are in.`,
      url: resultsUrl(event.slug),
      icon: "results",
      dedupeKey: `event_results:${event.id}`,
      tag: `event:${event.id}`,
    });
    return sent > 0;
  } catch (e) {
    log.error({ op: "social.officialResults", eventId, err: (e as Error).message }, "official results fan-out FAILED");
    return false;
  }
}
