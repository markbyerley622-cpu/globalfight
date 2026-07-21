# Seed World — populate a deployment for testers

Fills a deployment with a believable community (~70 marked users + predictions,
discussions, cards, notifications, activity, leaderboards) so testers experience a
fully populated product. **Single source of truth: `SEED_WORLD_MODE`.**

## The flag

| `SEED_WORLD_MODE` | Behaviour |
|---|---|
| `off` / unset | Never seeds. Any existing seed data is **left untouched**. Normal production. |
| `demo` | On startup, seeds **once** if the DB has no seed users (idempotent). Shows the transparent "Demo World" badge + footer. |
| `refresh` | Wipes + regenerates once per deploy, then behaves as `demo`. |

Optional: `SEED_WORLD_ADMIN_TOKEN` — Bearer secret for the reset endpoint.

## How it runs

The web service start command is `node --import tsx prisma/seed/boot.mts ; npm start`.
`boot.mts` reads `SEED_WORLD_MODE` and seeds the DB behind `DATABASE_URL`. It is
**non-fatal** (`;`, not `&&`) — a seeding hiccup logs and the app still starts.
Idempotent: once seeded, redeploys skip (it checks for existing `@seed.local` users).

## The four things you asked for

1. **Enable** — set `SEED_WORLD_MODE=demo` on the service (Render dashboard) and deploy/restart. It seeds once.
2. **Disable** — set `SEED_WORLD_MODE=off` (or remove it) and restart. Seeding stops; **existing seed data is intentionally left in place** (so a restart or an accidental env change never wipes your demo dataset).
3. **Reset** (remove all seed data) — `POST /api/admin/seed-world/reset` with `Authorization: Bearer <SEED_WORLD_ADMIN_TOKEN>`. Deletes every `@seed.local` user → cascades their picks/comments/cards/notifications/activity/reactions/threads, clears their analytics, repairs thread counters. **Never touches real accounts.** (Or run `npm run seed:wipe` against the DB.)
4. **Verify** — `npm run seed:status` (mode + counts + last generated), or just open the app: users, predictions, discussions, cards, notifications, leaderboards and profiles should all be populated, with the "Demo World" badge visible.

## Safety model

- **Marker + cascade:** seed users carry an `@seed.local` email; everything else is owned by a seed user and cascades on delete. Cleanup is therefore surgical — real users are never affected. (No per-row schema column needed.)
- **Idempotent:** never duplicates; only seeds when there are zero seed users.
- **No auto-delete:** turning the flag off leaves data; removal is explicit (reset endpoint / wipe).
- **Transparency:** while `demo` is on, a subtle "Demo World" pill + a "Simulated community activity" footer tell testers the data is simulated.

## Notes

- Predictions & discussions attach to **events** in the DB — a deployment with real ingested events (production) produces the richest world; a bare DB still gets users + forum/topic/fighter threads.
- Local: `SEED_WORLD_MODE=demo` in `.env`, then `npm run seed:demo` (or rely on the deployed service).
- Manual scripts: `npm run seed:demo` (wipe+regen), `npm run seed:wipe`, `npm run seed:status`.
