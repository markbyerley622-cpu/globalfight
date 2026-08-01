# ESPN provider — full cards WITH results for the major MMA promotions

ESPN publishes a public JSON scoreboard per promotion that carries the **whole
card**: every bout, both corners with stable athlete ids, the weight class,
scheduled rounds, and the winner. It accepts an arbitrary date range, so a
promotion's back catalogue is **one request per league-year**.

That makes it the strongest results source in the project. For comparison:
bkfc.com and onefc.com render winners client-side and expose none in static HTML,
and Wikipedia needs a search-and-verify ladder per card. ESPN returned 146 UFC
cards and 1,511 bouts across three years in 3 requests.

## Leagues

`leagues.ts`. The slug is **not** guessable from the promotion name — ONE
Championship is `ofc` ("One Fighting Championship", their pre-2015 name) and the
slug `one` is an HTTP 400. That single fact is most of why the file exists.

Wired: UFC, PFL, Bellator, ONE, RIZIN, KSW, Cage Warriors, Invicta, LFA, K-1,
plus the defunct majors (Strikeforce, PRIDE, WEC). ESPN has **no** BKFC and no
Glory — BKFC has its own provider; Glory has no source yet.

Observed coverage depth varies a lot and is worth knowing before promising a
promotion: UFC ~10–14 bouts per card, PFL ~10, **ONE only 2–3** (ESPN lists their
cards but not the full card).

## What a bout is allowed to claim

- **Winner** from the `winner: true` flag, and only when the bout is
  `STATUS_FINAL`. A final bout with no winner flag is a draw or a no-contest and
  the scoreboard does not say which, so it stays `SCHEDULED` rather than becoming
  a WIN nobody won.
- **Round** from `status.period` — the round the bout was in when it ended.
- **Method and finish time are never set.** The scoreboard carries neither.
  `notes` is empty on every card sampled, and `displayClock` is a clock reading
  whose direction (elapsed vs remaining) the endpoint never states — writing it
  into `timeEnded`, which means elapsed, would be a coin flip presented as a fact.
  Both are available from ESPN's per-fight summary endpoint at the cost of one
  request per bout, if they turn out to be worth it.
- **Title fights are not flagged.** ESPN does not mark them here, so we do not
  claim them.

## Two traps, both regression-tested

**The athlete id is on the COMPETITOR, not in `athlete`.** In team sports the
competitor is the team and the athlete nests inside it; in MMA the competitor *is*
the athlete (`type: "athlete"`, `uid: "s:3301~a:3093653"`) and `athlete.id` is
usually absent. Reading `athlete.id` first looks more correct and produced no ids
at all — which silently turned a fully-decided UFC 297 into twelve pending bouts,
because a WIN needs a winner id.

**ESPN lists a card prelims-first, so the main event is LAST.** `persist.ts`
assigns `orderOnCard` from the array index and treats index 0 as the top of the
card, so the array is reversed on the way in. Unreversed, every card is upside
down and the opener is presented as the headliner.

## Running it

```bash
npm run espn:backfill                        # ufc, pfl, bellator, one, rizin — 3 years
npm run espn:backfill -- --years=10
npm run espn:backfill -- --league=ufc --years=15
npm run espn:backfill -- --league=all --years=5
npm run espn:backfill -- --dry-run
```

Prints the promotion table before and after. Re-running is safe: fight identity is
the corner pair on the event.

**Cron** (`/api/cron/refresh-espn`) fetches the **current year only** — it exists to
settle last night's card and pick up new announcements. A promotion's back
catalogue does not change, so history is the backfill script, run deliberately.

## Tests

`npm run test:espn` — over real captured scoreboard JSON in `__tests__/fixtures/`.
