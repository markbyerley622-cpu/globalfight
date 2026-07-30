// ════════════════════════════════════════════════════════════════════════════
//  Collapse a notification list into groups. PURE — no prisma, no server-only.
//
//  Two collapses, in order, because they answer different complaints:
//
//    SUBJECT   three things happened to ONE thing you follow
//              "John reviewed your gym / edited it / replied" → "John interacted
//              with your gym · 3 updates"
//
//    KIND      the same KIND of thing happened to several things you follow
//              five separate fight bookings → "5 fighters you follow have new
//              fights"
//
//  A group is a VIEW, never a row: nothing is written, nothing is deleted, and the
//  members travel with it. That is what keeps unread state, timestamps, deep links
//  and dedupe behaviour intact — the group's unread flag is "any member unread",
//  its timestamp is the newest member's, and marking it read marks its members
//  read. There is no second source of truth to fall out of step with the first.
//
//  Pure so it can be unit-tested against a hand-built list, and so the same
//  function could run on the client if the transport ever changes.
// ════════════════════════════════════════════════════════════════════════════

export interface GroupableNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  url: string | null;
  icon: string | null;
  dedupeKey: string | null;
  readAt: string | null;
  createdAt: string;
  /**
   * Who caused this, when that is a person and it matters. Only populated for
   * FOLLOW today, where it powers the follow-back action in the row — a new
   * follower is the one notification with an obvious reciprocal act, and making
   * the reader navigate to a profile to perform it loses most of them.
   *
   * `youFollow` is resolved on the server per request rather than guessed in the
   * UI, so the row cannot offer to "follow back" someone already followed.
   */
  actor?: { username: string; youFollow: boolean } | null;
}

export interface NotificationGroup {
  /** The newest member's id — stable enough to be a React key and to sort on. */
  id: string;
  type: string;
  title: string;
  body: string | null;
  /** The newest member's link: a group opens where its most recent news is. */
  url: string | null;
  icon: string | null;
  /** Unread if ANY member is unread. A group you have half-read is not read. */
  unread: boolean;
  /** The newest member's timestamp, so a group sorts by its latest activity. */
  createdAt: string;
  /** Every row this group stands for, newest first. One member = not a group. */
  members: GroupableNotification[];
  /** How many rows are collapsed here. 1 for an ungrouped notification. */
  count: number;
}

/**
 * The SUBJECT a notification is about, derived from its dedupeKey.
 *
 * Every key in the app is `<fact>:<entityId>[:…]` by convention — `gym_review:<gymId>
 * :<authorId>:created`, `fight_announced:<fightId>`, `event_live:<eventId>`. The first
 * two segments are therefore "this fact type, about this thing", which is exactly the
 * subject key.
 *
 * Falls back to the URL when there is no dedupeKey (a reply, a pick payout): those are
 * genuinely repeatable notifications, and the page they point at is the thing they are
 * about. Returns null when neither exists, which means "never group this".
 */
export function subjectKey(n: GroupableNotification): string | null {
  if (n.dedupeKey) {
    const parts = n.dedupeKey.split(":");
    if (parts.length < 2) return null;
    // Some keys are facts about the VIEWER, and their second segment is a threshold
    // or a date rather than an entity — "rep:1000", "streak_warn:2026-07-27".
    //
    // This has to be an explicit list because the shapes are indistinguishable:
    // "rep:1000" and "fight_result:f1000" are both two segments, and grouping the
    // first family by prefix would collapse "1,000 reputation" and "2,500 reputation"
    // into one row. That is not de-duplicating repetition — it is hiding one
    // achievement behind another. A new viewer-scoped fact adds one entry here.
    if (VIEWER_SCOPED.has(parts[0])) return null;
    return `${parts[0]}:${parts[1]}`;
  }
  if (n.url) return `url:${n.url.split("#")[0]}`;
  return null;
}

/**
 * dedupeKey prefixes whose subject is the reader themself. Never grouped.
 *
 * Note what is NOT here: `person_rep:<userId>:<threshold>` and
 * `person_streak:<userId>:<n>` are about somebody the reader FOLLOWS, so their
 * subject is that person and grouping them by person is exactly right.
 */
const VIEWER_SCOPED = new Set(["rep", "streak_warn", "streak_reminder"]);

/**
 * Types that may collapse across DIFFERENT subjects, with the copy for it.
 *
 * An explicit allow-list, not a default. "5 fighters you follow have new fights" is a
 * genuine improvement on five rows; "5 things happened" is not, and a generic
 * cross-subject collapse would eventually produce exactly that. A type absent from
 * this list is never kind-grouped, only subject-grouped.
 */
const KIND_GROUPS: Record<string, { icon: string; label: (n: number) => string; body: string }> = {
  FIGHT_ANNOUNCED: {
    icon: "fight",
    label: (n) => `${n} cards you follow have updates`,
    body: "New bouts, changes and announcements.",
  },
  GYM_REVIEW: {
    icon: "review",
    label: (n) => `${n} gyms you follow have new reviews`,
    body: "Tap to see what people are saying.",
  },
  PICK_RESULT: {
    icon: "victory",
    label: (n) => `${n} results are in`,
    body: "Bouts you were following have finished.",
  },
  COMMUNITY_REPLY: {
    icon: "reply",
    label: (n) => `${n} people you follow hit milestones`,
    body: "Streaks, cards and community milestones.",
  },
  FOLLOW: {
    icon: "person",
    label: (n) => `${n} new followers`,
    body: "Tap to see who.",
  },
};

/** Below this, showing the rows themselves is strictly better than summarising them. */
const MIN_KIND_GROUP = 3;

/** Kind-grouping only collapses things that happened around the same time. */
const KIND_WINDOW_MS = 24 * 60 * 60 * 1000;

const newestFirst = (a: GroupableNotification, b: GroupableNotification) =>
  b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);

function toGroup(members: GroupableNotification[], override?: { title: string; body: string; icon: string }): NotificationGroup {
  const head = members[0];
  return {
    id: head.id,
    type: head.type,
    title: override?.title ?? head.title,
    body: override?.body ?? head.body,
    // The NEWEST member's link, always — including for an overridden group title.
    // A summarised group still has to land somewhere real, and the most recent
    // thing in it is the one the reader is most likely to have come for.
    url: head.url,
    icon: override?.icon ?? head.icon,
    unread: members.some((m) => !m.readAt),
    createdAt: head.createdAt,
    members,
    count: members.length,
  };
}

/**
 * Group a page of notifications, newest first.
 *
 * Input is assumed to be one page of ONE user's notifications. Grouping is applied
 * within the page and never across pages: a group that grew as the reader scrolled
 * would renumber itself under them, and a "3 updates" row silently becoming "4
 * updates" on the next fetch is worse than two honest groups.
 */
export function groupNotifications(input: GroupableNotification[]): NotificationGroup[] {
  const sorted = [...input].sort(newestFirst);

  // ── pass 1: same subject ──────────────────────────────────────────────────
  const bySubject = new Map<string, GroupableNotification[]>();
  const ungroupable: GroupableNotification[] = [];
  for (const n of sorted) {
    const key = subjectKey(n);
    if (!key) { ungroupable.push(n); continue; }
    const list = bySubject.get(key) ?? [];
    list.push(n);
    bySubject.set(key, list);
  }

  const afterSubject: NotificationGroup[] = [];
  for (const members of bySubject.values()) {
    if (members.length === 1) { afterSubject.push(toGroup(members)); continue; }
    // The subject is shared, so the newest title already names the thing. What the
    // reader needs added is that there is MORE — hence the count in the body rather
    // than a rewritten title that would lose the specifics.
    afterSubject.push(
      toGroup(members, {
        title: members[0].title,
        body: `${members.length} updates`,
        icon: members[0].icon ?? "🔔",
      }),
    );
  }
  for (const n of ungroupable) afterSubject.push(toGroup([n]));
  afterSubject.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // ── pass 2: same kind, different subjects ─────────────────────────────────
  // Only SINGLE-member groups are eligible. A subject group already says "3 updates
  // about this one thing", and folding that into "5 cards have updates" would hide a
  // count behind a count.
  const byKind = new Map<string, NotificationGroup[]>();
  const out: NotificationGroup[] = [];
  for (const g of afterSubject) {
    if (g.count > 1 || !KIND_GROUPS[g.type]) { out.push(g); continue; }
    const list = byKind.get(g.type) ?? [];
    list.push(g);
    byKind.set(g.type, list);
  }

  for (const [type, groups] of byKind) {
    const spec = KIND_GROUPS[type];
    // Only the recent run collapses. Older ones stay as themselves rather than being
    // swept into a group whose timestamp would misrepresent them.
    const newest = +new Date(groups[0].createdAt);
    const recent = groups.filter((g) => newest - +new Date(g.createdAt) <= KIND_WINDOW_MS);
    const older = groups.filter((g) => !recent.includes(g));

    if (recent.length >= MIN_KIND_GROUP) {
      const members = recent.flatMap((g) => g.members).sort(newestFirst);
      out.push(toGroup(members, { title: spec.label(recent.length), body: spec.body, icon: spec.icon }));
    } else {
      out.push(...recent);
    }
    out.push(...older);
  }

  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
