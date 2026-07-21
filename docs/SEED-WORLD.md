# Seed World — Render demo environment

A populated, believable community (personas, predictions, discussions everywhere,
cards, notifications, leaderboards) so testers / QA / investors can experience
CombatReviews as if it had months of organic growth — **without ever touching
production**.

Priority order, by design: **1) Safety · 2) Reversibility · 3) Tester experience · 4) Convenience.**

---

## How production is protected (the guarantee)

Four independent layers, any one of which stops a production seed:

1. **Prod never runs seed code.** The production Render service's start command is
   plain `npm start`. `boot.mts` (the only startup seeder) is wired **only** into
   the demo service. Seed code does not execute in the production process at all.
2. **Positive host allowlist (default-deny).** A remote database is refused unless
   its name/host appears in `SEED_WORLD_DEMO_HOSTS`. We set that to the demo DB
   name `globalfight_demo`. Production's DB is named `globalfight` — not listed —
   so it can never match, even if a mode env were mis-set.
3. **Remote opt-in.** Seeding a non-local host also requires
   `ALLOW_SEED_WORLD=true` (or `SEED_WORLD_ALLOW_REMOTE=true`). Absent that, any
   remote target is refused.
4. **Refuse-to-start.** If seeding is enabled but the config is unsafe/contradictory,
   `boot.mts` exits non-zero; the `&&` halts `next start`, so the demo service
   refuses to boot rather than seed the wrong database. (Production is unaffected —
   it never runs boot.)

Belt-and-braces: `SEED_WORLD_PROD_HOSTS` is an optional denylist tripwire.

---

## Environment variables

| Var | Demo service | Production | Meaning |
|---|---|---|---|
| `SEED_WORLD_MODE` | `demo` | *(unset = off)* | `off` \| `demo` \| `refresh` |
| `ALLOW_SEED_WORLD` | `true` | *(unset)* | permit remote seeding |
| `SEED_WORLD_ALLOW_REMOTE` | `true` | *(unset)* | alias of the above |
| `SEED_WORLD_DEMO_HOSTS` | `globalfight_demo` | *(unset)* | positive allowlist (DB name/host) |
| `SEED_WORLD_ADMIN_TOKEN` | generated | *(unset)* | Bearer for the refresh endpoint |
| `NEXT_PUBLIC_SEED_WORLD` | `demo` | *(unset)* | shows the demo pill + footer |
| `APP_ENV` | `demo` | *(unset)* | banner label |
| `DATABASE_URL` | `globalfight-demo-db` | `globalfight-db` | separate databases |

All of these are declared for the `combatreviews-demo` service in `render.yaml`.

---

## Modes

- **off** — never seeds. (Production.)
- **demo** — on startup, seeds once if the demo DB has no `@seed.local` users; else skips. Never duplicates, never auto-wipes.
- **refresh** — on startup, wipes + regenerates once per deploy (tracked by a tmp marker keyed on `RENDER_GIT_COMMIT`), then behaves as demo on subsequent restarts.

---

## Render setup (create the demo service)

The production service and DB are untouched by this — you're adding new ones.

1. **Merge/apply the blueprint:** on the `feature/render-demo-world` branch, Render → Blueprints → this repo → **Apply**. It creates `globalfight-demo-db` and the `combatreviews-demo` service.
2. **Fill the demo service's `sync: false` secrets** (same as prod: `NEXT_PUBLIC_SITE_URL` = the demo URL Render assigns, plus any `ODDS_API_KEY` / storage keys you want on demo).
3. **First deploy** builds, runs `prisma db push` against the demo DB, then `boot.mts` seeds it. Watch the logs for the banner + `[seed] …` lines.
4. **(Optional) ingest events first** — picks & discussion need events. Either let the demo DB start empty (users + topic/fighter threads still populate) or copy events in / run a one-off `sync`.

To turn the demo **off**: set `SEED_WORLD_MODE=off` on the demo service (or suspend it). To **regenerate**: set `SEED_WORLD_MODE=refresh` and redeploy, or call the admin endpoint.

---

## Admin controls

```bash
npm run seed:status     # mode + persona/prediction/comment/card/notif counts + last generated
npm run seed:demo       # wipe + regenerate (local or allowlisted host)
npm run seed:refresh    # alias of the above
npm run seed:wipe       # wipe only
```

HTTP (demo service): `POST /api/admin/seed-world/refresh` with `Authorization: Bearer <SEED_WORLD_ADMIN_TOKEN>` — wipes + regenerates and returns a log. 404 if no token configured; 403 if `SEED_WORLD_MODE=off`.

Sign in as any generated user: email `<handle>@seed.local`, password `demo-passw0rd`.

---

## Rollback

- **Disable instantly:** set `SEED_WORLD_MODE=off` on the demo service (no code change).
- **Remove the data:** `npm run seed:wipe` (or the refresh endpoint after setting mode off doesn't seed) — deletes all `@seed.local` users (cascades their picks/cards/posts/reactions/threads/notifs/activity) + their analytics, and repairs thread counters.
- **Remove the environment:** delete the `combatreviews-demo` service + `globalfight-demo-db` in Render; revert this branch. Production is unaffected throughout.
