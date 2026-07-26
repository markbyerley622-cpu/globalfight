# Identity — the Tuesday problem

## The thesis

The risk was never that people won't visit Combat Reviews. It is that they'll
visit **only when a fight is happening**. That is the difference between an
event product and a daily habit.

Everything the product does well today is organised around an **event**: the
card, the bout, the pick, the result, the discussion. Those are moments. A
product made only of moments is opened only at those moments — and every
counter that scores a user (`picksResolved`, `reputation`, `battleWins`) moves
only on fight night, so on a Tuesday there is genuinely nothing new.

The shift is from **event-centric to identity-centric**: events become moments
that update a person's long-term combat identity, rather than the thing the
product is made of.

**The test for any feature from here on:**

> Does this create another reason to open the app on a Tuesday when there are
> no fights?

If no, it probably isn't improving retention. If yes, it compounds.

## The loops

Consumer apps that get opened daily run on a handful of loops. Where we stand:

| Loop | Example | Combat Reviews |
| --- | --- | --- |
| Status | Chess.com rating | **Partial** — `reputation` + leaderboard exist, but only move on fight night |
| Progress | Duolingo streak | **Started** — day streak + collection ladders (this commit) |
| Identity | Reddit, Discord | **Partial** — public profile, registry role, gym membership |
| Relationships | WhatsApp | **Partial** — `UserFollow`, `Rivalry`, Prediction Battles |
| Money | — | Out of scope by design (see `/responsible-gambling`) |
| Utility | Maps | **Strong** — schedule, rankings, results, gym directory, map |
| Novelty | TikTok | **Partial** — clips/reels |

We were strong on Utility and Event information, thin on Status, Identity,
Progress and Relationships. That is the gap being closed.

## What shipped

### `/today` — the surface that exists on days with no fights

The first page in the product organised around a **person** rather than a card.

- **`src/lib/identity/streak-math.ts`** — pure day-streak rules (UTC day-keys,
  idempotent within a day, a gap restarts at 1, `activeDays` never decreases).
  IO-free so the rule is unit-tested without a database
  (`src/lib/identity/__tests__/streak-math.test.ts`).
- **`src/lib/identity/streak.ts`** — the DB wrapper. One read plus at most one
  write per user per day, guarded on `lastActiveOn` so concurrent first-visits
  cannot double-count.
- **`src/lib/identity/milestones.ts`** — twelve collection ladders across four
  groups (Predict / Connect / Train / Collect), every one **derived** from
  records the product already keeps. Nothing new is stored, so no milestone can
  disagree with the history that produced it and none of it needs backfilling —
  a user who joined last year already holds their real totals.
- **`src/lib/identity/today.ts`** — the daily briefing: what moved since your
  last visit (calls graded, fighters you follow getting booked, rankings
  shifting under them, what your corner has been doing, your gym filling up),
  plus what you can act on now. Every read is bounded and indexed, so the page
  costs the same for someone following 400 fighters as for someone following 4.

New columns on `User`: `lastActiveOn`, `dayStreak`, `bestDayStreak`,
`activeDays`. **This needs `prisma db push` on deploy** — the project has no
migration history, so a missed push shows up as an empty page rather than an
error (see `docs/MIGRATIONS.md`).

Entry points: `PRIMARY_NAV` (second item, under Home), the Profile pillar
matcher, and a dedicated card at the top of `/profile`.

## The roadmap, in the order it should be built

The eight ideas from the brief, mapped onto what the schema already supports.
Order is by *reason-to-return per unit of work*, not by ambition.

### 1. Career tracking → notification, not just a page  *(next)*

`/today` shows what changed **when you open it**. The Return Engine
(`Notification` + `dedupeKey` + the scheduler) already exists and already
delivers fight-week reminders. A once-daily digest push — "3 of your fighters
moved today" — turns a page you might visit into a reason to visit. Blocked on
the same provider decision as the rest of email/push.

### 2. Living fighter cards

Fighter pages are static profiles. `RankSnapshot` is already a time series, and
`FightPick` aggregates give crowd sentiment per bout. A fighter page that shows
*what changed this week* — rank, fan sentiment, prediction confidence,
followers, community activity — is the same data, re-read as motion. No schema
work.

### 3. Reputation, widened

One score, many sources — the `awardReputation()` ledger was built for exactly
this and currently has one real producer (correct picks). Gym reviews rated
helpful, forum contributions, verified corrections, and check-in consistency
should all feed the same number. **Never a parallel score.**

### 4. Local combat

`Gym`, `CheckIn`, `mapLat/mapLon`, `openToSpar`, `lookingForTraining` are all
in place and the map renders them. What's missing is the *daily* read: "near
you today — 3 gyms, 1 amateur event, 2 seminars, 15 fighters". Needs an
amateur-event/seminar entity, which is the first genuinely new model on this
list.

### 5. Personal journey

Fan → student → competitor → coach → gym owner → promoter → official. The
schema has `registryRole` (a single signup intent) and `GymMember.role`. A
journey needs role *history* with dates — an append-only `RoleEpisode` — so a
profile can say "coached here 2019–2023" instead of only what is true today.

### 6. Coach mode

Students, attendance, gradings, competition results. This is a real product
inside the product and should not be started until gyms are actually using the
gym pages. `GymMember` is the anchor.

### 7. Gym operating system

Announcements, leaderboards, seminars, payments, photos, records. The largest
item here by an order of magnitude, and the one most likely to be wrong if
built before coaches are on the platform. Payments bring compliance scope.

### 8. Collections, deepened

Ladders shipped. The richer version — "every heavyweight champion",
"every UFC main event since 2022" — needs completion sets defined against real
entity lists, not counts. Cheap to add once someone decides which sets matter.

## The long game

Someone joins at 18. Twenty years later the same profile holds their first gym,
every amateur fight, every pro fight, every prediction, every coach, every belt,
every seminar, every gym they trained at, every event attended, every student
coached. That is why the streak counts `activeDays` forever and why milestones
are derived rather than stored: the record has to still be true in 2046.

Why open LinkedIn? Your career is there. Why open Strava? Your history is there.
Combat Reviews should become: **my combat life is there.**
