# GlobalFight

A mobile-first, **event-centric** platform for global combat sports — MMA, Boxing,
Muay Thai, Kickboxing, Bare-knuckle, BJJ, Wrestling, Judo, Taekwondo and Sambo.

This is a **functional skeleton** with realistic mock data. It demonstrates the
full product model, not a production backend. There are no payments, gambling,
real-time infrastructure or CMS — those are stubbed behind clean interfaces.

## The core idea

The **event** is the central object. Users follow an event, and every related
content type attaches to it:

```
Sport → Promotion → Event → Fight card → Bout
                       ├─ Coverage      (attached by eventId / optional fightId)
                       ├─ Predictions   (one market per bout)
                       ├─ Discussion    (one thread per event, bout filters)
                       └─ Results
```

An event is a self-contained destination containing everything a user needs
before, during and after it happens. There are **no** disconnected top-level
Schedule / News / Predictions / Community pages.

## Routes

| Route | Purpose |
| --- | --- |
| `/sports/[sportSlug]` | Event discovery for a sport (grouped by time) |
| `/sports/[sportSlug]/events/[eventSlug]` | The canonical event destination |
| `/sports/[sportSlug]/events/[eventSlug]/fights/[fightSlug]` | Optional bout detail |

`/` redirects to `/sports/mma`. The sport is a route param, so selecting a sport
in the top `SportSwitcher` just changes the param — one shared page system, no
per-sport duplication.

## Architecture

```
src/
  app/                      # Next.js App Router routes (server components)
  components/               # Reusable, sport-agnostic UI
    ui/                     # Primitives (Badge, Countdown, EmptyState, …)
    sport/ events/ event/   # Navigation, discovery, event destination
    fightcard/ coverage/    # Card + coverage
    predictions/ discussion/ results/
  lib/
    domain/                 # Types, sport rules, formatting, selectors (pure)
    services/               # Prediction + discussion service INTERFACES + stubs
    data/                   # Single typed fixture layer + read accessors (store)
```

Key principles applied:

- **One typed fixture layer** (`lib/data/fixtures.ts`). Components never inline
  mock arrays — they read through `lib/data/store.ts`, the only data surface.
  Swap `store.ts` for real (async) service calls and the UI is unchanged.
- **Domain logic separated from presentation** (`lib/domain/*` is pure and
  testable — grouping, bucketing, prediction summaries).
- **Configurable per-sport rules** (`lib/domain/sportRules.ts`): terminology
  (fighter/athlete/grappler, bout/match/fight, round/period), result methods,
  team-event flags. Adding a sport is a data change, not new components.
- **Stable IDs + slugs** for every relationship — never text matching.
- Mobile-first, no horizontal page overflow, large touch targets, keyboard-
  navigable tabs, and loading / empty / unavailable states throughout.

## Placeholder services

`lib/services/predictions.ts` and `lib/services/discussion.ts` define the
contracts the UI codes against with in-memory stubs. `createPost` and real vote
persistence intentionally throw / no-op — connect a backend there. **No odds or
wagering**: a prediction is a single free community pick per bout.

## Demo data covers

Multiple sports · two MMA promotions (Apex FC, Vanguard) plus Boxing / Muay Thai
/ Kickboxing / Bare-knuckle / BJJ · one **upcoming**, one **live** and one
**completed** event, each with a full multi-bout card, coverage, prediction
percentages, discussion prompts + posts, and completed results.

Fixture timestamps are relative to load time (see `lib/data/clock.ts`) so
lifecycle states stay realistic during a demo.

## Develop

```bash
npm install
npm run dev        # http://localhost:3000
npm run typecheck
npm run lint
```
