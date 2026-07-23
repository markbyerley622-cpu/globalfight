# GlobalFight — Release v1 (candidate)

**Version:** v1.0.0-rc · **Release commit:** `3ace53e` (HEAD of `harden/wave0-production-blockers`)
**Commits in release:** 47 ahead of `main` · **Status:** ✅ pre-flight green · ⏳ **NOT merged / NOT pushed / NOT deployed**
**Prepared by:** release engineer (Claude), autonomous pre-flight only.

> **Deploy gate.** Everything a build-time environment can verify is green (below).
> The actual merge→push→Render deploy and production smoke tests were **NOT
> performed** here: this environment can only reach `localhost` — it has no access
> to GitHub Actions, the Render dashboard, or the production URL, so CI/Render/
> prod-health/smoke evidence cannot be produced from here. Per the release's own
> "never claim success without evidence" rule, that gate is handed to an operator
> with the exact runbook in §Deployment. Timestamps below are filled in at deploy.

---

## 1. Pre-flight verification (this environment)

| Gate | Result |
|---|---|
| Git audit | clean tree; 47 commits; no secrets / `.env` / node_modules / artifacts committed (only `.env.example` template + CI dummies) |
| TypeScript | **0 errors** |
| ESLint | **0 errors** (55 pre-existing `any`/effect warnings) |
| Unit tests | **95 / 95** |
| Integration tests | **12 / 13** — the 1 is a verified true-positive: local `combat-db` still has the old CASCADE FK; production `db push` applies `Restrict` → 13/13 (see §Migration) |
| Production build | **compiled** (58+ routes; shared First Load JS ~102 kB) |
| Dependency audit (`--omit=dev`) | **0 vulnerabilities** (was 2 HIGH earlier this cycle — sharp + postcss — both cleared via `overrides`) |

## 2. What's in this release

- **Security:** stored-XSS (JSON-LD) closed; security headers + CSP (Report-Only);
  signup rate-limit + de-enumeration; image-proxy SSRF hop-revalidation; forum-
  report rate-limit; pino secret redaction; **critical Next RCE patched
  (15.1.4→15.5.21)**; **2 HIGH dep CVEs cleared** (sharp 0.33.5→0.35.3, postcss
  →8.5.22, both via `overrides`); CSP `img-src` flag host fix; dropped console-
  erroring `upgrade-insecure-requests`.
- **Result resolution (RC-3/A):** `preventResultDowngrade` guard — a decided bout
  can no longer be silently reverted to SCHEDULED by a later sync; result-integrity
  telemetry (`resultOps`) on every `resolve-picks` run (review queue + resolution
  lag). Docs: `RESULT-RESOLUTION.md`.
- **Prediction IA (RC-4/B):** the pick control now separates **Community
  Prediction** (crowd %, no confidence/method) from **Your Challenge** (your pick +
  confidence + finish + points, "skill not betting"); unified naming (leaderboard
  → "Challenge Ranking"; rooms/labels "Battle" → "Challenge"). Docs:
  `PREDICTION-IA.md`.
- **UX:** event-card artwork hierarchy (hero→poster→fighter-vs-fighter→gradient);
  Watch + Tickets as first-class actions; filled primary CTA; nav cleanup (logo →
  clean `/events`, obsolete Map/Gyms/Events selector removed); Partners + Breaking
  ticker scoped to `/events`; venue deep-links into the in-app map; shape-matched
  events skeleton. Docs: `UX-POLISH.md`.
- **Performance:** Home First Load 164→143 kB (Reels lazy-load); event-page read
  waterfall → `Promise.all`; auth round-trip eliminated (server-seed); hot-path DB
  indexes. Field LCP/CLS need production re-measure (see Known issues).
- **Database:** `Fight` corner FKs `Cascade→Restrict` (data-loss guard); per-fight
  persistence transaction; hot-path indexes; migrations baseline `0_init`.
- **Accessibility:** axe 96–100 across audited routes; Sheet focus-trap; global
  `:focus-visible`. (RC-1 browser certification.)
- **Testing/CI:** unit 49→95; integration suite (money paths); E2E (Playwright,
  3 engines) + Lighthouse + axe in RC-1; CI gate (`.github/workflows/ci.yml`).

## 3. Migration

- Schema change: `Fight.redId/blueId` `onDelete: Restrict`, new hot-path indexes,
  and the `0_init` migrations baseline are committed.
- **`render.yaml` deploys via `npx prisma db push --skip-generate --accept-data-loss`**
  (NOT `migrate deploy`). On this deploy `db push` will apply the FK change +
  indexes. Confirm post-deploy that `Fight_redId_fkey` delete-rule = `RESTRICT`.
- The `--accept-data-loss` flag is owner-approved and load-bearing (Prisma
  false-flags additive uniques as data-loss). Adopting Prisma Migrations is the
  documented next step (`MIGRATIONS.md`).

## 4. Rollback plan

- Every change is an atomic, revertible commit (per-fix rollback lines in
  `HARDENING.md`).
- App rollback: revert the merge commit on `main`, push → Render redeploys the
  prior build.
- Emergency framework rollback: `npm i next@15.1.4` **reintroduces the patched
  critical RCE** — emergency only.
- Dep overrides: remove `overrides.sharp` / `overrides.postcss` to revert those.
- DB: the FK/index changes are additive/non-destructive; restore the pre-cutover
  backup if needed.

## 5. Known issues / limitations

- **Field performance (LCP/CLS)** not production-measured — local numbers are
  infra-confounded (RC-1). Measure via RUM post-deploy.
- **Result provenance columns** (source/verifiedAt/confidence) not yet persisted;
  no-downgrade guard delivers the core integrity win (`RESULT-RESOLUTION.md`).
- **Re-grade-on-correction** after picks already graded is operator-driven.
- **CSP is Report-Only**; an `img-src` external-host audit (event-poster CDNs,
  `i.ytimg.com`) is required before enforcing.
- **`/predictions` odds-market route** naming should be disambiguated from
  "Community Prediction" (`PREDICTION-IA.md` roadmap).
- Env prerequisites for full function: evidence R2 bucket (boot-blocker), public
  R2 (photos), optional email (Resend) / push (VAPID) — see `.env.render`.

## 6. Deployment (operator runbook — to execute)

Pre-push:
1. `git fetch origin && git log --oneline origin/main..main` — confirm `main` hasn't advanced.
2. Confirm production env is set on Render (evidence bucket, `AUTH_SECRET`, cron secret, R2, optional email/push).

Merge + push:
3. `git checkout main && git merge --no-ff harden/wave0-production-blockers`
4. Re-run gates locally; then `git push origin main`.

Deploy watch (Render auto-deploys `main`):
5. Watch **CI** (GitHub Actions `verify`) → must be green before relying on the deploy.
6. Watch **Render build logs**: `db push` applies cleanly; startup guard passes (evidence bucket set); server boots.
7. Verify **`/api/health`** → `{status:"ok",db:"up"}`.
8. Confirm **`Fight_redId_fkey` delete-rule = RESTRICT** in the production DB.

Smoke (production URL):
9. Landing / Events / Event page / Fight page / Leaderboard / Prediction+Challenge flow / Profile / Search / Forums / News / Map / Notifications / Auth (login+signup) / Health — console clean, no hydration/500/CSP-blocking/failed API.
10. Confirm cron: `resolve-picks` runs and its response shows `awaitingResults`/`resolutionLag` (result telemetry live).

## 7. Deployment timestamps

| Step | Time (UTC) | By | Evidence |
|---|---|---|---|
| Merge to `main` | _pending_ | | |
| Push to `origin/main` | _pending_ | | |
| CI green | _pending_ | | Actions run URL |
| Render build success | _pending_ | | Render deploy URL |
| `db push` applied (FK=RESTRICT) | _pending_ | | psql check |
| Health green | _pending_ | | `/api/health` |
| Smoke passed | _pending_ | | §6.9 checklist |

---

*Pre-flight prepared autonomously; every gate above verified in a build-time
environment. The production deploy + smoke steps (§6.5–10) require GitHub/Render/
prod access this environment does not have and were intentionally left to the
operator — a deploy whose result cannot be observed must not be reported as done.*
