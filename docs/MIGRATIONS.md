# Adopting Prisma Migrations

Status: **baseline prepared locally, NOT deployed.** This document is the manual
plan to switch GlobalFight from `prisma db push --accept-data-loss` to a
reviewable, reversible migration history. Nothing here has been run against any
database. Execute it deliberately, with a backup, when you choose.

## Why

Today the schema reaches production via `render.yaml`:

```
npx prisma db push --skip-generate --accept-data-loss
```

`--accept-data-loss` silences Prisma's guard against dropping a **populated**
column, so a bad schema diff could destroy data with no migration to review and
no rollback path (Audit: Database §7, Code-Quality M1). Migrations give an
ordered, diff-reviewable, reversible history and restore the destructive-change
guard.

## What is already in the repo

- `prisma/migrations/0_init/migration.sql` — a baseline that creates the **entire
  current schema** (73 tables, 125 indexes), generated with
  `prisma migrate diff --from-empty --to-schema-datamodel`. It already reflects
  the Wave 0/1 schema changes (Fight corner FKs `ON DELETE RESTRICT`; the new
  hot-path indexes).
- `prisma/migrations/migration_lock.toml` — pins the provider to `postgresql`.

Its presence is **inert** until someone runs `prisma migrate deploy`: the current
build still uses `db push`, and CI only runs `prisma generate` + build.

## One-time adoption (manual, ~15 min, low-traffic window)

Your production DB was built by `db push`, so it already contains these tables —
you must **baseline** (mark 0_init as applied) rather than run it.

**Important:** production may still lag the current schema (the Wave 0/1 changes —
`Fight` FK → Restrict and the new indexes — only apply on a `db push`). Bring it
in line first, then baseline.

1. **Back up the production database.** (Render dashboard → your Postgres →
   backup, or `pg_dump`.) Do not skip this.

2. **Apply the pending schema one last time** so prod matches the baseline:
   ```
   DATABASE_URL=<prod-url> npx prisma db push --skip-generate
   ```
   (Note: no `--accept-data-loss` — if this reports real data loss, stop and
   inspect the diff before proceeding.)

3. **Baseline the history WITHOUT re-running it:**
   ```
   DATABASE_URL=<prod-url> npx prisma migrate resolve --applied 0_init
   ```
   This records 0_init as applied in `_prisma_migrations`; it does not execute the
   SQL. Prod and the migration history are now in sync.

4. **Switch the deploy** — in `render.yaml`, change the web service `buildCommand`:
   ```
   -  npm ci --include=dev && npx prisma db push --skip-generate --accept-data-loss && npm run build
   +  npm ci --include=dev && npx prisma migrate deploy && npm run build
   ```
   `migrate deploy` applies only pending, committed migrations and never prompts.

5. Commit the `render.yaml` change and deploy. From here, **stop using `db push`
   against prod.**

## Day-to-day workflow after adoption

Schema change → generate a migration locally (needs a local Postgres for the
shadow database; `docker-compose.yml` in the repo provides one):

```
docker compose up -d db          # local Postgres
npx prisma migrate dev --name add_x
git add prisma/migrations && git commit
```

CI validates it (typecheck/build); the Render build runs `migrate deploy`.

**Never** run `migrate dev` against production — it is a local/shadow-DB command.

## What this unblocks

Two deferred items need migrations because they cannot be expressed as a safe
`db push`:

- **`FighterAlias @@unique([fighterId, normalized])`** — a plain `db push` fails
  if duplicate alias rows already exist. A migration can de-dupe first:
  ```sql
  DELETE FROM "FighterAlias" a USING "FighterAlias" b
    WHERE a.id > b.id AND a."fighterId" = b."fighterId" AND a.normalized = b.normalized;
  ALTER TABLE "FighterAlias" ADD CONSTRAINT "FighterAlias_fighterId_normalized_key"
    UNIQUE ("fighterId", normalized);
  ```
  then switch `recordAliases` in `persist.ts` to a single `upsert`.
- **Fighter-name trigram index** (dedupe `contains` scans) — raw SQL in a migration:
  ```sql
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX "Fighter_name_trgm_idx" ON "Fighter" USING gin (name gin_trgm_ops);
  ```

## Rollback

- Before step 4: nothing has changed operationally; delete `prisma/migrations/` to
  abandon.
- After a bad future migration: restore the backup, or
  `prisma migrate resolve --rolled-back <name>` and revert the schema, or
  temporarily point `buildCommand` back at `db push` while you fix forward.
